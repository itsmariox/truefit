// The ChatGPT-plan token record and its renewal (phase 3): storage rules, a rotating refresh token, ONE refresh when many calls need it at once, and what is and is not erased.
import { startFakeOpenAI, httpError } from "./openai-fake-server.ts";
const { MemorySecretStore, SECRET_NAMES } = await import("../src/store/secrets.ts");
const { createPlanStore, createPlanAuth, parsePlanRecord, PLAN_SCOPE } = await import("../src/access/openai-plan.ts");
const { OpenAIAuthError } = await import("../src/agents/openai-provider.ts");
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const T0 = new Date("2026-11-19T12:00:00Z"); let clock = T0.getTime(); const now = () => new Date(clock);
const rec = (over: object = {}) => ({ version: 1 as const, issuer: "https://auth.openai.com", clientId: "oaiapp_issued", subject: "sub-1", idToken: "ID.TOKEN.ONE", accessToken: "ACCESS-1", refreshToken: "REFRESH-1", scopes: [PLAN_SCOPE, "openid", "offline_access"], expiresAt: new Date(T0.getTime() + 3600_000).toISOString(), savedAt: T0.toISOString(), ...over });
const setup = async (opts: { handler?: (b: URLSearchParams, n: number) => { status: number; body: object } } = {}) => {
  const secrets = new MemorySecretStore(), store = createPlanStore(secrets); let n = 0, validRefresh = "REFRESH-1"; const forms: URLSearchParams[] = [];
  const srv = await startFakeOpenAI({ "POST /api/accounts/oauth/token": (r, res) => {
    const f = new URLSearchParams(r.raw); forms.push(f); n++;
    if (opts.handler) { const h = opts.handler(f, n); return httpError(res, h.status, h.body); }
    if (f.get("refresh_token") !== validRefresh) return httpError(res, 400, { error: { code: "refresh_token_reused" } });
    validRefresh = `REFRESH-${n + 1}`; return httpError(res, 200, { access_token: `ACCESS-${n + 1}`, refresh_token: validRefresh, id_token: "ID.TOKEN.NEW", token_type: "Bearer", expires_in: 3600, scope: `${PLAN_SCOPE} openid offline_access` });
  } });
  let signedOut = 0; const auth = createPlanAuth({ store, authBase: srv.url, now, onSignedOut: () => signedOut++ });
  return { secrets, store, srv, auth, forms, signedOut: () => signedOut };
};

// ---- the record ----
{ const s = new MemorySecretStore(), st = createPlanStore(s);
  ok("record: nothing saved reads as null; a saved record round-trips", (await st.get()) === null && (await st.set(rec()), (await st.get())?.accessToken === "ACCESS-1"));
  ok("record: it lives under ONE secret name and holds no e-mail field", Object.keys(rec()).every((k) => k !== "email") && (await s.get(SECRET_NAMES.openaiPlan)) !== null);
  await s.set(SECRET_NAMES.openaiPlan, "{not json"); let threw = false; try { await st.get(); } catch { threw = true; }
  ok("record: a damaged saved record THROWS (it is not 'signed out' and is not erased)", threw && (await s.get(SECRET_NAMES.openaiPlan)) === "{not json");
  ok("record: parsePlanRecord refuses a record missing a token, with a wrong version or a bad date", parsePlanRecord(JSON.stringify({ ...rec(), refreshToken: "" })) === null && parsePlanRecord(JSON.stringify({ ...rec(), version: 2 })) === null && parsePlanRecord(JSON.stringify({ ...rec(), expiresAt: "soon" })) === null && parsePlanRecord(null) === null); }

// ---- using the token ----
{ const t = await setup(); await t.store.set(rec());
  ok("token: a token with time left is returned as it is, with no request", (await t.auth.getAccessToken()) === "ACCESS-1" && t.srv.seen.length === 0);
  clock = T0.getTime() + 3600_000 - 60_000; // 60 s left: inside the 2-minute margin
  const tok = await t.auth.getAccessToken(); const f = t.forms[0];
  ok("refresh: a token about to expire is renewed with the documented form (grant_type, the ISSUED client id, the saved refresh token, the resource, no scope)", tok === "ACCESS-2" && f.get("grant_type") === "refresh_token" && f.get("client_id") === "oaiapp_issued" && f.get("refresh_token") === "REFRESH-1" && f.get("resource") === "https://api.openai.com/v1" && !f.has("scope"));
  const saved = await t.store.get();
  ok("refresh: the replacement refresh token, new expiry and new ID token are saved, and the issued client id and subject are kept", saved?.refreshToken === "REFRESH-2" && saved.accessToken === "ACCESS-2" && saved.idToken === "ID.TOKEN.NEW" && saved.clientId === "oaiapp_issued" && saved.subject === "sub-1" && Date.parse(saved.expiresAt) > clock + 3000_000);
  clock = Date.parse(saved!.expiresAt) - 1000; const again = await t.auth.getAccessToken();
  ok("refresh: the next renewal uses the NEW refresh token (the old one would be refused as reused)", again === "ACCESS-3" && t.forms[1].get("refresh_token") === "REFRESH-2");
  await t.srv.close(); }
{ clock = T0.getTime(); const t = await setup(); await t.store.set(rec({ expiresAt: new Date(clock + 10_000).toISOString() }));
  const toks = await Promise.all(Array.from({ length: 8 }, () => t.auth.getAccessToken()));
  ok("single flight: eight calls that all need a renewal at once cause exactly ONE refresh request, and all get the same new token", t.srv.seen.length === 1 && toks.every((x) => x === "ACCESS-2"));
  ok("single flight: no call was handed an old token, and the saved refresh token is the replacement", (await t.store.get())?.refreshToken === "REFRESH-2");
  await t.srv.close(); }

// ---- what is and is not erased ----
{ clock = T0.getTime(); const t = await setup({ handler: () => ({ status: 400, body: { error: { code: "refresh_token_expired" } } }) }); await t.store.set(rec({ expiresAt: new Date(clock + 1000).toISOString() }));
  let err: unknown; try { await t.auth.getAccessToken(); } catch (e) { err = e; }
  ok("dead refresh token: the record is erased, the app is told, and the error asks to connect again", err instanceof OpenAIAuthError && (await t.store.get()) === null && t.signedOut() === 1 && /connect ChatGPT again/.test((err as Error).message)); await t.srv.close(); }
{ clock = T0.getTime(); const t = await setup({ handler: () => ({ status: 503, body: { error: { code: "server_error" } } }) }); await t.store.set(rec({ expiresAt: new Date(clock + 1000).toISOString() }));
  let err: unknown; try { await t.auth.getAccessToken(); } catch (e) { err = e; }
  ok("server error while renewing: a plain error (the call pauses as 'unavailable'), and the record is KEPT", err instanceof Error && !(err instanceof OpenAIAuthError) && (await t.store.get())?.refreshToken === "REFRESH-1"); await t.srv.close(); }
{ clock = T0.getTime(); const t = await setup(); await t.store.set(rec({ expiresAt: new Date(clock + 1000).toISOString() })); await t.srv.close();
  let err: unknown; try { await t.auth.getAccessToken(); } catch (e) { err = e; }
  ok("network down while renewing: a plain error and the record is KEPT (never erase because of a temporary failure)", err instanceof Error && !(err instanceof OpenAIAuthError) && (await t.store.get())?.refreshToken === "REFRESH-1"); }
{ const t = await setup({ handler: () => ({ status: 400, body: { error: { code: "invalid_client" } } }) }); await t.store.set(rec({ expiresAt: new Date(clock + 1000).toISOString() }));
  let err: unknown; try { await t.auth.getAccessToken(); } catch (e) { err = e; }
  ok("invalid_client is a client problem: asks to connect again but does NOT erase the record", err instanceof OpenAIAuthError && (await t.store.get()) !== null); await t.srv.close(); }
{ const t = await setup(); let e1: unknown, e2: unknown, e3: unknown;
  try { await t.auth.getAccessToken(); } catch (e) { e1 = e; }
  await t.store.set(rec({ scopes: ["openid"] })); try { await t.auth.getAccessToken(); } catch (e) { e2 = e; }
  await t.secrets.set(SECRET_NAMES.openaiPlan, "garbage"); try { await t.auth.getAccessToken(); } catch (e) { e3 = e; }
  ok("not connected / plan scope missing / unreadable record: each is a clear auth error, with no request sent and nothing erased", e1 instanceof OpenAIAuthError && e2 instanceof OpenAIAuthError && /not enabled/.test((e2 as Error).message) && e3 instanceof OpenAIAuthError && t.srv.seen.length === 0 && (await t.secrets.get(SECRET_NAMES.openaiPlan)) === "garbage"); await t.srv.close(); }

// ---- the registration survives a dead token; a refresh never overwrites a newer sign-in ----
{ clock = T0.getTime(); const t = await setup({ handler: () => ({ status: 400, body: { error: { code: "refresh_token_reused" } } }) }); await t.store.set(rec({ expiresAt: new Date(clock + 1000).toISOString() }));
  try { await t.auth.getAccessToken(); } catch { /* expected */ }
  const reg = await t.store.getRegistration();
  ok("dead refresh token: the tokens are erased but the REGISTRATION (issued client id, account) is kept for the next connect", (await t.store.get()) === null && reg?.clientId === "oaiapp_issued" && reg.subject === "sub-1"); await t.srv.close(); }
{ clock = T0.getTime(); const secrets = new MemorySecretStore(), store = createPlanStore(secrets); let release!: () => void; const gate = new Promise<void>((r) => (release = r)); let started!: () => void; const hit = new Promise<void>((r) => (started = r));
  const srv = await startFakeOpenAI({ "POST /api/accounts/oauth/token": async (_r, res) => { started(); await gate; httpError(res, 200, { access_token: "OLD-SESSION-ACCESS", refresh_token: "OLD-SESSION-REFRESH", expires_in: 3600, scope: `${PLAN_SCOPE} openid` }); } });
  await store.set(rec({ expiresAt: new Date(clock + 1000).toISOString() })); const auth = createPlanAuth({ store, authBase: srv.url, now });
  const pending = auth.getAccessToken().catch((e) => e); await hit;
  await store.set(rec({ refreshToken: "REFRESH-NEW-SIGNIN", accessToken: "ACCESS-NEW-SIGNIN" })); release(); const got = await pending;
  ok("a refresh that finishes AFTER a new sign-in does not overwrite it: the caller gets the newer record's token and the saved record is the new sign-in's", got === "ACCESS-NEW-SIGNIN" && (await store.get())?.refreshToken === "REFRESH-NEW-SIGNIN");
  const t2 = await setup(); await t2.store.set(rec({ expiresAt: new Date(clock + 1000).toISOString() }));
  await srv.close(); await t2.srv.close(); }
console.log(failures === 0 ? "\nall openai-plan tests passed" : `\n${failures} openai-plan test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
