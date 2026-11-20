// "Connect ChatGPT" (phase 4): the whole sign-in flow against a pretend OpenAI sign-in service on localhost, with a stand-in for the browser. The real listener, PKCE, state, nonce,
// ID-token verification and storage all run for real; only OpenAI and the browser are pretend. Nothing here proves that OpenAI's real service behaves like the pretend one.
import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import { startFakeOpenAI, httpError } from "./openai-fake-server.ts";
const { MemorySecretStore, SECRET_NAMES } = await import("../src/store/secrets.ts");
const { createPlanStore, PLAN_SCOPE } = await import("../src/access/openai-plan.ts");
const { createOpenAISignIn, verifyIdToken } = await import("../src/access/openai-signin.ts");
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };

// ---- keys and tokens ----
const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }), other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }), ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwkOf = (k: crypto.KeyObject, kid: string, alg: string) => ({ ...(k.export({ format: "jwk" }) as object), kid, use: "sig", alg });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (payload: object, key: crypto.KeyObject, kid = "k1", alg: "RS256" | "ES256" | "none" = "RS256") => { const h = b64({ alg, typ: "JWT", kid }), p = b64(payload), data = `${h}.${p}`; if (alg === "none") return `${data}.`; const sig = alg === "RS256" ? crypto.sign("sha256", Buffer.from(data), key) : crypto.sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" }); return `${data}.${sig.toString("base64url")}`; };

type Mode = { subject?: string; scope?: string; omitClientId?: boolean; error?: string; badNonce?: boolean; badAud?: boolean; signWith?: crypto.KeyObject; alg?: "RS256" | "none"; revokeStatus?: number; noCode?: boolean };
async function world(mode: Mode = {}) {
  const pending: { redirect: string; state: string; nonce: string; challenge: string; clientId: string; q: URLSearchParams }[] = []; const tokenForms: URLSearchParams[] = []; const revokes: URLSearchParams[] = []; let issued = 0; let srvUrl = "";
  const srv = await startFakeOpenAI({
    "GET /.well-known/openid-configuration": (_r, res) => httpError(res, 200, { issuer: srvUrl, authorization_endpoint: `${srvUrl}/api/accounts/authorize`, token_endpoint: `${srvUrl}/api/accounts/oauth/token`, jwks_uri: `${srvUrl}/jwks`, revocation_endpoint: `${srvUrl}/revoke` }),
    "GET /jwks": (_r, res) => httpError(res, 200, { keys: [jwkOf(rsa.publicKey, "k1", "RS256")] }),
    "GET /api/accounts/authorize": (r, res) => { // the "browser" reaches this, the pretend service answers with the redirect back to the app's listener
      const q = new URL(r.url, srvUrl).searchParams; const clientId = q.get("client_id")!; pending.push({ redirect: q.get("redirect_uri")!, state: q.get("state")!, nonce: q.get("nonce")!, challenge: q.get("code_challenge")!, clientId, q });
      const back = new URL(q.get("redirect_uri")!); if (mode.error) back.searchParams.set("error", mode.error); else if (!mode.noCode) back.searchParams.set("code", "CODE-1");
      back.searchParams.set("state", q.get("state")!);
      if (!mode.omitClientId && !mode.error) back.searchParams.set("client_id", clientId === "dynamic_agent_client" ? `oaiapp_${++issued}` : clientId);
      res.statusCode = 302; res.setHeader("Location", back.toString()); res.end();
    },
    "POST /api/accounts/oauth/token": (r, res) => {
      const f = new URLSearchParams(r.raw); tokenForms.push(f); const p = pending[pending.length - 1];
      if (f.get("grant_type") !== "authorization_code" || f.get("code") !== "CODE-1" || f.get("redirect_uri") !== p.redirect || f.get("resource") !== "https://api.openai.com/v1" || crypto.createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url") !== p.challenge) return httpError(res, 400, { error: { code: "invalid_grant" } });
      const now = Math.floor(Date.now() / 1000), cid = f.get("client_id")!;
      const idt = sign({ iss: srvUrl, aud: mode.badAud ? "someone-else" : cid, sub: mode.subject ?? "subject-A", exp: now + 3600, iat: now, nonce: mode.badNonce ? "wrong" : p.nonce }, mode.signWith ?? rsa.privateKey, "k1", mode.alg ?? "RS256");
      httpError(res, 200, { access_token: "ACCESS-NEW", refresh_token: "REFRESH-NEW", id_token: idt, token_type: "Bearer", expires_in: 3600, scope: mode.scope ?? `${PLAN_SCOPE} email offline_access openid profile resource.invoke`, earliest_refresh_at: now + 3000 });
    },
    "POST /revoke": (r, res) => { revokes.push(new URLSearchParams(r.raw)); httpError(res, mode.revokeStatus ?? 200, ""); },
  });
  srvUrl = srv.url; const secrets = new MemorySecretStore(), store = createPlanStore(secrets); const opened: string[] = [];
  const browser = async (url: string) => { opened.push(url); const a = await fetch(url, { redirect: "manual" }); const loc = a.headers.get("location"); if (loc) await fetch(loc).catch(() => undefined); }; // the stand-in for the browser: follows the redirect to the listener
  let signedIn = 0;
  const flow = (over: object = {}) => createOpenAISignIn({ store, secrets, appName: "Truefit", openUrl: browser, authBase: srv.url, preferredPort: 0, onSignedIn: () => signedIn++, ...over });
  return { srv, secrets, store, pending, tokenForms, revokes, opened, flow, signedIn: () => signedIn };
}
const portOpen = (port: number) => new Promise<boolean>((r) => { const s = net.connect(port, "127.0.0.1"); s.once("connect", () => { s.destroy(); r(true); }); s.once("error", () => r(false)); });
const run = async (w: Awaited<ReturnType<typeof world>>, over: object = {}) => { const events: any[] = []; const h = w.flow(over).start((e) => events.push(e)); return { r: await h.done, events }; };

// ---- first sign-in (registration) ----
{ const w = await world(); const { r, events } = await run(w); const a = w.pending[0].q, rec = await w.store.get();
  ok("first sign-in: succeeds and saves the record under the ISSUED client id, with the verified subject and the plan scope", r.ok === true && rec?.clientId === "oaiapp_1" && rec.subject === "subject-A" && rec.scopes.includes(PLAN_SCOPE) && rec.refreshToken === "REFRESH-NEW" && w.signedIn() === 1);
  ok("authorize request: dynamic_agent_client, the app name, an ext_agent_host_id, code + S256, state, nonce, the resource and the full scope list, and NO id_token_hint", a.get("client_id") === "dynamic_agent_client" && a.get("agent_name_hint") === "Truefit" && /^urn:uuid:[0-9a-f-]{36}$/.test(a.get("ext_agent_host_id")!) && a.get("response_type") === "code" && a.get("code_challenge_method") === "S256" && a.get("state")!.length >= 24 && a.get("nonce")!.length >= 24 && a.get("resource") === "https://api.openai.com/v1" && a.get("scope")!.split(" ").includes(PLAN_SCOPE) && !a.has("id_token_hint"));
  ok("redirect: an HTTP loopback address on 127.0.0.1 (not localhost) with the exact path /auth/callback", /^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/.test(a.get("redirect_uri")!));
  const f = w.tokenForms[0]; ok("code exchange: the issued client id (never dynamic_agent_client), the code, the PKCE verifier, the same redirect and the resource; no secret", f.get("client_id") === "oaiapp_1" && f.get("code") === "CODE-1" && !f.has("client_secret") && f.get("redirect_uri") === a.get("redirect_uri"));
  ok("events: starting, link, waiting, confirming; and no event carries a token, the code or an ID-token hint", events.map((e) => e.type).join() === "starting,link,waiting_for_browser,confirming" && !/ACCESS|REFRESH|CODE-1|id_token_hint/.test(JSON.stringify(events)));
  ok("the listener is closed afterwards", !(await portOpen(Number(new URL(a.get("redirect_uri")!).port))));
  ok("the host id is saved as a secret", /^urn:uuid:/.test((await w.secrets.get(SECRET_NAMES.openaiHostId)) ?? ""));
  // returning sign-in, same account
  const hostBefore = a.get("ext_agent_host_id"); w.tokenForms.length = 0; const again = await run(w); const b = w.pending[1].q;
  ok("returning sign-in: the saved client id, the same host id, the retained ID token as id_token_hint, and no agent_name_hint", again.r.ok === true && b.get("client_id") === "oaiapp_1" && b.get("ext_agent_host_id") === hostBefore && b.get("id_token_hint") === rec!.idToken && !b.has("agent_name_hint"));
  ok("returning sign-in: the link shown to the user does NOT carry the ID-token hint (the browser is opened with it, the user is not shown it)", !again.events.find((e) => e.type === "link").url.includes("id_token_hint") && w.opened[1].includes("id_token_hint"));
  await w.srv.close(); }

// ---- a different account, denial, bad callbacks ----
{ const w = await world(); await run(w); const before = (await w.store.get())!; await w.srv.close();
  const w2 = await world({ subject: "subject-B" }); await w2.store.set(before); const r = await run(w2);
  ok("returning sign-in as a DIFFERENT ChatGPT account is refused and the saved credentials are untouched", r.r.ok === false && (r.r as any).reason === "invalid_identity" && (await w2.store.get())?.refreshToken === before.refreshToken); await w2.srv.close(); }
{ const w = await world({ error: "access_denied" }); const r = await run(w);
  ok("the user says no (access_denied): reported as denied, no code exchanged, nothing saved", (r.r as any).reason === "denied" && w.tokenForms.length === 0 && (await w.store.get()) === null); await w.srv.close(); }
{ const w = await world({ omitClientId: true }); const r = await run(w);
  ok("a new registration whose callback has no issued client id is incomplete, nothing saved", (r.r as any).reason === "registration_incomplete" && (await w.store.get()) === null); await w.srv.close(); }
{ const w = await world({ scope: "openid email offline_access" }); const r = await run(w); const rec = await w.store.get();
  ok("granted scopes without the plan permission: signed in but reported as plan_not_enabled (record kept, plan not usable)", (r.r as any).reason === "plan_not_enabled" && rec !== null && !rec.scopes.includes(PLAN_SCOPE)); await w.srv.close(); }
{ // forged callbacks must not end the attempt
  const w = await world(); let forged = 0, hostBad = 0; let port = 0;
  const hit = (path: string, headers: Record<string, string> = {}) => new Promise<number>((res) => { const rq = http.request({ host: "127.0.0.1", port, path, headers, method: "GET" }, (rs) => { rs.resume(); res(rs.statusCode ?? 0); }); rq.on("error", () => res(0)); rq.end(); });
  const browser = async (url: string) => { const p = new URL(new URL(url).searchParams.get("redirect_uri")!); port = Number(p.port); forged = await hit("/auth/callback?code=EVIL&state=wrong"); hostBad = await hit(`/auth/callback?code=CODE-1&state=${new URL(url).searchParams.get("state")}`, { Host: "evil.example" }); const a = await fetch(url, { redirect: "manual" }); await fetch(a.headers.get("location")!); };
  const r = await run(w, { openUrl: browser });
  ok("a callback with the wrong state gets 400, one addressed to another host name gets 404, neither ends the attempt, and the real callback then succeeds", forged === 400 && hostBad === 404 && r.r.ok === true && w.tokenForms.length === 1 && w.tokenForms[0].get("code") === "CODE-1"); await w.srv.close(); }

// ---- the ID token must be genuine ----
for (const [label, mode] of [["a wrong nonce", { badNonce: true }], ["the wrong audience", { badAud: true }], ["a signature from another key", { signWith: other.privateKey }], ["the 'none' algorithm", { alg: "none" as const }]] as [string, Mode][]) {
  const w = await world(mode); const r = await run(w);
  ok(`ID token with ${label} is refused (invalid_identity) and nothing is saved`, (r.r as any).reason === "invalid_identity" && (await w.store.get()) === null); await w.srv.close(); }
{ const now = new Date(), good = { iss: "I", aud: "C", sub: "s", exp: Math.floor(now.getTime() / 1000) + 600, nonce: "n" }, jw = { keys: [jwkOf(rsa.publicKey, "k1", "RS256"), jwkOf(ec.publicKey, "e1", "ES256")] }, exp = { issuer: "I", audience: "C", nonce: "n", now };
  ok("verifyIdToken: accepts a good RS256 token and a good ES256 token", verifyIdToken(sign(good, rsa.privateKey), jw, exp).ok && verifyIdToken(sign(good, ec.privateKey, "e1", "ES256" as never), jw, exp).ok);
  ok("verifyIdToken: refuses expired, wrong issuer, an audience list without ours, and a tampered payload", !verifyIdToken(sign({ ...good, exp: Math.floor(now.getTime() / 1000) - 600 }, rsa.privateKey), jw, exp).ok && !verifyIdToken(sign({ ...good, iss: "X" }, rsa.privateKey), jw, exp).ok && !verifyIdToken(sign({ ...good, aud: ["a", "b"] }, rsa.privateKey), jw, exp).ok && !verifyIdToken(sign(good, rsa.privateKey).replace(/\.[^.]+\./, "." + b64({ ...good, sub: "evil" }) + "."), jw, exp).ok);
  ok("verifyIdToken: accepts an audience list that includes ours", verifyIdToken(sign({ ...good, aud: ["a", "C"] }, rsa.privateKey), jw, exp).ok); }

// ---- timeout, cancel, one at a time, port fallback ----
{ const w = await world(); const t = await run(w, { openUrl: async () => undefined, timeoutMs: 150 });
  ok("no browser answer: times out, and the port is closed", (t.r as any).reason === "timeout" && (await w.store.get()) === null); await w.srv.close(); }
{ const w = await world(); let h: ReturnType<ReturnType<typeof w.flow>["start"]>; const flow = w.flow({ openUrl: async () => { setTimeout(() => h.cancel(), 20); } });
  h = flow.start(); const second = flow.start(); const r = await h.done;
  ok("cancel: the attempt ends as cancelled; a second start while one runs is refused as already_running", (r as any).reason === "cancelled" && (await second.done as any).reason === "already_running" && !flow.isActive()); await w.srv.close(); }
{ const blocker = net.createServer(); await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", r)); const busy = (blocker.address() as net.AddressInfo).port;
  const w = await world(); const r = await run(w, { preferredPort: busy });
  ok("the preferred port is busy: another free port is used instead and the sign-in still works", r.r.ok === true && new URL(w.pending[0].redirect).port !== String(busy)); blocker.close(); await w.srv.close(); }

// ---- sign out ----
{ const w = await world(); await run(w); const rec = (await w.store.get())!; const o = await w.flow().signOut();
  ok("sign out: tells OpenAI to revoke the refresh token (token, hint, client id), then clears the record", o.revoked === true && o.cleared === true && w.revokes[0].get("token") === rec.refreshToken && w.revokes[0].get("token_type_hint") === "refresh_token" && w.revokes[0].get("client_id") === rec.clientId && (await w.store.get()) === null);
  await w.srv.close(); }
{ const w = await world({ revokeStatus: 500 }); await run(w); const o = await w.flow().signOut();
  ok("sign out when OpenAI cannot be told: the record is STILL cleared and the result says revocation was not confirmed", o.cleared === true && o.revoked === false && (await w.store.get()) === null);
  const w2 = await world(); const o2 = await w2.flow().signOut(); ok("sign out with nothing saved is harmless", o2.revoked === false && o2.cleared === false); await w.srv.close(); await w2.srv.close(); }

// ---- a sign-out keeps the registration: reconnecting never creates a second app on the user's account ----
{ const mode: Mode = {}; const w = await world(mode); await run(w); const first = (await w.store.get())!;
  const o = await w.flow().signOut();
  ok("sign out removes the TOKENS but keeps the registration (issued client id and account)", o.cleared && o.revoked && o.hadSession && (await w.store.get()) === null && (await w.store.getRegistration())?.clientId === first.clientId && (await w.store.getRegistration())?.subject === "subject-A");
  const again = await run(w); const b = w.pending[1].q, rec2 = await w.store.get();
  ok("reconnecting after a sign-out reuses the SAVED client id: no dynamic_agent_client, no agent_name_hint, and no id_token_hint (OpenAI: omit it after signing out); the pretend service issued no second client", again.r.ok === true && b.get("client_id") === first.clientId && !b.has("agent_name_hint") && !b.has("id_token_hint") && w.tokenForms[1].get("client_id") === first.clientId && rec2?.clientId === first.clientId && w.pending.filter((p) => p.clientId === "dynamic_agent_client").length === 1);
  mode.subject = "subject-B"; await w.flow().signOut();
  const other = await run(w);
  ok("after a sign-out, a DIFFERENT ChatGPT account cannot ride on the saved client: refused (invalid_identity), nothing saved", (other.r as any).reason === "invalid_identity" && (await w.store.get()) === null);
  const f = await w.flow().signOut({ forget: true });
  ok("'use a different account' removes the registration too", f.cleared === true && (await w.store.getRegistration()) === null);
  const fresh = await run(w);
  ok("and the next connect registers anew (dynamic_agent_client, with the app name) and works for the other account", fresh.r.ok === true && w.pending.at(-1)!.q.get("client_id") === "dynamic_agent_client" && w.pending.at(-1)!.q.has("agent_name_hint") && (await w.store.get())?.subject === "subject-B" && (await w.store.getRegistration())?.clientId !== first.clientId);
  await w.srv.close(); }
console.log(failures === 0 ? "\nall openai-signin tests passed" : `\n${failures} openai-signin test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
