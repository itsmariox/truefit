// OpenAI access end to end (phase 5): the access service, the runtime, the REAL pipeline and runner, the usage ledger and the spend cap, on a pretend OpenAI service on localhost. The
// ChatGPT-plan path and the API-key path, the pauses and what the access state says, and that this Mac's choice of service is never exported.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeOpenAI, sse, completed, httpError } from "./openai-fake-server.ts";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { openDb } = await import("../src/store/db.ts");
const { migrate } = await import("../src/store/migrate.ts");
const { MIGRATIONS } = await import("../src/store/schema.ts");
const { setSettings, getSettings } = await import("../src/store/settings-store.ts");
const { MemorySecretStore, SECRET_NAMES } = await import("../src/store/secrets.ts");
const { createAccessRuntime } = await import("../src/access/runtime.ts");
const { PLAN_SCOPE } = await import("../src/access/openai-plan.ts");
const { testOpenAIConnection, connectWithOpenAIKey } = await import("../src/access/openai-connect.ts");
const M = await import("../src/access/messages-openai.ts");
const { ACTION_LABELS } = await import("../src/access/messages.ts");
const { EXIT } = await import("../src/agents/errors.ts");
const PL = await import("../src/pipeline.ts");
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const priya = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8"));
const T0 = new Date(2026, 10, 19, 10, 0, 0).getTime();
const { profileToPersona } = await import("../src/profile.ts"); const ctx = profileToPersona(priya, new Date());
const analysis = { company: "Acme Retail", role: "Marketing Executive", location: "Leeds", work_mode: "hybrid", salary_text: null, salary_min_gbp: null, seniority: "mid", years_required: 2, experience: { years: 8, basis: "d" }, requirements: [{ text: "r", priority: "must", rating: "strong", evidence_quote: ctx.bullets[1].text.slice(0, 60), note: "" }], constraint_checks: [], focus_id: 1, focus_note: "", fit_percent: 70, fit_note: "", verdict: "apply", strengths: [], gaps: [], unverified_needed: [], injection_suspected: false, summary: "" };

type Script = (n: number, body: any) => { status?: number; body?: object; events?: object[] } | "ok";
async function rig(o: { script?: Script; plan?: object | null; cap?: number | null } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-oai-rt-")), db = openDb(":memory:"); migrate(db, MIGRATIONS); const secrets = new MemorySecretStore(); let clock = T0; const now = () => new Date(clock);
  let n = 0, refreshes = 0; const auths: (string | undefined)[] = [];
  const srv = await startFakeOpenAI({
    "POST /v1/responses": (r, res) => { auths.push(r.headers.authorization); const i = n++, out = o.script?.(i, r.body) ?? "ok";
      if (out === "ok") return sse(res, completed(/Fit analysis/.test(r.body.instructions) ? analysis : { message: "ok" }, { input_tokens: 2000, output_tokens: 300, input_tokens_details: { cached_tokens: 0 } }));
      if (out.events) return sse(res, out.events); return httpError(res, out.status ?? 500, out.body ?? {}); },
    "POST /api/accounts/oauth/token": (_r, res) => { refreshes++; httpError(res, 200, { access_token: "ACCESS-RENEWED", refresh_token: "REFRESH-RENEWED", expires_in: 3600, scope: `${PLAN_SCOPE} openid offline_access` }); },
  });
  const cfg = { models: { analyst: "claude-x", writer: "claude-x", checker: "claude-x", coach: "claude-x" }, agentTimeoutSeconds: 5, researchTimeoutSeconds: 5, maxAdChars: 30000 };
  const rt = createAccessRuntime({ db, secrets, statusRunner: async () => { throw new Error("the Claude program must not be asked when OpenAI is chosen"); }, query: (() => { throw new Error("Claude must not be called when OpenAI is chosen"); }) as never, now,
    openai: { baseUrl: srv.url + "/v1", authBase: srv.url }, base: { tone: "friendly", config: cfg, skillsDir: path.join(dir, "..", "skills"), tmpRoot: root, env: { PATH: "/usr/bin" }, now } });
  if (o.cap !== undefined) setSettings(db, { "spend.monthlyCapUsd": o.cap }, now());
  const jobsDir = path.join(root, "jobs"); mkdirSync(jobsDir);
  const pl = PL.createPipeline({ jobsDir, profile: priya, runnerFor: rt.runnerFor, renderer: {} as never, fonts: {} as never, config: { accent: "oxford", showRightToWork: true, resumeProfile: "snapshot" }, now });
  const analyse = async () => { const j = await pl.createJob("An ad about marketing. ".repeat(10), "text"); try { const r = await pl.analyse(j); return { job: r.job, err: null as any }; } catch (e: any) { return { job: e.job ?? j, err: e }; } };
  const rows = () => db.all<{ role: string; ok: number; error_code: number | null; mode: string; model: string; cost_usd: number }>("SELECT role, ok, error_code, mode, model, cost_usd FROM usage ORDER BY id");
  const record = (over: object = {}) => ({ version: 1, issuer: srv.url, clientId: "oaiapp_x", subject: "sub", idToken: "ID.T.1", accessToken: "ACCESS-1", refreshToken: "REFRESH-1", scopes: [PLAN_SCOPE, "openid"], expiresAt: new Date(clock + 3600_000).toISOString(), savedAt: new Date(clock).toISOString(), ...over });
  return { root, db, secrets, srv, rt, pl, analyse, rows, auths, refreshes: () => refreshes, record, advance: (ms: number) => { clock += ms; }, cleanup: async () => { await srv.close(); rmSync(root, { recursive: true, force: true }); } };
}

// ---------- the choice of service ----------
{ const r = await rig(); const a = r.rt.access;
  ok("provider: Claude is the default, and the default state is 'not chosen'", a.provider() === "claude" && (await a.state()).kind === "not_chosen");
  a.chooseMode("subscription"); a.chooseProvider("openai");
  ok("provider: choosing OpenAI forgets the chosen way to connect (a Claude subscription is not a ChatGPT plan) and says 'not chosen' again, without ever asking the Claude program", a.provider() === "openai" && getSettings(r.db).settings["claude.mode"] === null && (await a.state()).kind === "not_chosen");
  ok("provider: the setting refuses anything but claude or openai", !setSettings(r.db, { "ai.provider": "gemini" as never }, new Date()).ok);
  a.chooseMode("apiKey"); await a.saveApiKey("sk-test-0123456789abcdefghij");
  ok("provider: an OpenAI key is saved under its own secret name, not the Claude one", (await r.secrets.get(SECRET_NAMES.openaiApiKey)) !== null && (await r.secrets.get(SECRET_NAMES.claudeApiKey)) === null && (await a.state()).kind === "key_saved");
  a.chooseProvider("claude"); a.chooseMode("apiKey");
  ok("provider: switching back to Claude does not see the OpenAI key (still 'no key')", (await a.state()).kind === "not_connected");
  await r.cleanup(); }

// ---------- API-key path through the real pipeline ----------
{ const r = await rig(); const a = r.rt.access; a.chooseProvider("openai"); a.chooseMode("apiKey"); await a.saveApiKey("sk-test-0123456789abcdefghij");
  const res = await r.analyse(); const row = r.rows()[0];
  ok("key path: an analysis runs through the OpenAI provider with the key as bearer, and the job is analysed", res.job.status === "analysed" && r.auths[0] === "Bearer sk-test-0123456789abcdefghij");
  ok("key path: the OpenAI model from the config (not the Claude name) was used, and the ledger has the call in API-key mode with a cost from tokens", row.model === "gpt-6.2-sol" && row.mode === "apiKey" && row.ok === 1 && Math.abs(row.cost_usd - (2000 * 2 + 300 * 10) / 1e6) < 1e-9);
  ok("key path: a success clears any remembered error and the state is 'key saved'", (await a.state()).kind === "key_saved");
  await r.cleanup(); }
{ const r = await rig({ cap: 0.000001 }); const a = r.rt.access; a.chooseProvider("openai"); a.chooseMode("apiKey"); await a.saveApiKey("sk-test-0123456789abcdefghij"); await r.analyse(); const second = await r.analyse();
  ok("key path: the monthly spend cap applies to OpenAI API-key calls too: the next call is a PAUSE (cap), nothing is sent", second.err?.kind === "cap" && r.auths.length === 1 && r.rt.describePause("cap").title === "Your monthly spend limit has been reached"); await r.cleanup(); }
{ const r = await rig({ script: () => ({ status: 401, body: { error: { code: "invalid_api_key", message: "bad key" } } }) }); const a = r.rt.access; a.chooseProvider("openai"); a.chooseMode("apiKey"); await a.saveApiKey("sk-test-0123456789abcdefghij"); const res = await r.analyse();
  ok("key path: a refused key pauses the job (auth), the state becomes 'key invalid', and the pause words say OpenAI, not Claude", res.err?.kind === "auth" && (await a.state()).kind === "key_invalid" && /OpenAI/.test(r.rt.describePause("auth").title) && !/Claude/.test(JSON.stringify(r.rt.describePause("auth")))); await r.cleanup(); }
{ const r = await rig(); const a = r.rt.access; a.chooseProvider("openai"); a.chooseMode("apiKey"); const res = await r.analyse();
  ok("key path: no key saved is a PAUSE with the sign-in wording, nothing is sent", res.err?.kind === "auth" && r.auths.length === 0); await r.cleanup(); }

// ---------- ChatGPT-plan path ----------
{ const r = await rig(); const a = r.rt.access; a.chooseProvider("openai"); a.chooseMode("subscription");
  ok("plan: before the notice is ticked the state is 'notice needed'", (await a.state()).kind === "notice_needed");
  a.acceptNotice(); ok("plan: the OpenAI notice date is its own setting (the Claude one is untouched)", getSettings(r.db).settings["openai.noticeAcceptedAt"] !== null && getSettings(r.db).settings["claude.noticeAcceptedAt"] === null);
  ok("plan: with no sign-in saved the state is 'not connected' (from the sign-in record, never the Claude program)", (await a.state()).kind === "not_connected");
  const none = await r.analyse(); ok("plan: a job with no sign-in PAUSES (auth) and nothing is sent", none.err?.kind === "auth" && r.auths.length === 0);
  await r.secrets.set(SECRET_NAMES.openaiPlan, JSON.stringify(r.record())); a.signedIn();
  ok("plan: with a sign-in saved the state is 'connected'", (await a.state()).kind === "connected");
  const good = await r.analyse(); ok("plan: the call carries the plan token as bearer, the job is analysed, and the ledger row is in subscription mode (requests, not dollars billed)", good.job.status === "analysed" && r.auths.at(-1) === "Bearer ACCESS-1" && r.rows().at(-1)?.mode === "subscription");
  await r.cleanup(); }
{ const r = await rig(); const a = r.rt.access; a.chooseProvider("openai"); a.chooseMode("subscription"); a.acceptNotice(); await r.secrets.set(SECRET_NAMES.openaiPlan, JSON.stringify(r.record())); r.advance(3600_000 - 30_000);
  const res = await r.analyse();
  ok("plan: a token about to expire is renewed ONCE before the call, and the call uses the renewed token", res.job.status === "analysed" && r.refreshes() === 1 && r.auths.at(-1) === "Bearer ACCESS-RENEWED"); await r.cleanup(); }
{ const r = await rig({ script: () => ({ status: 429, body: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } } }) }); const a = r.rt.access; a.chooseProvider("openai"); a.chooseMode("subscription"); a.acceptNotice(); await r.secrets.set(SECRET_NAMES.openaiPlan, JSON.stringify(r.record()));
  const res = await r.analyse(); const st = await a.state(); const msg = M.describeOpenAIState(st, new Date(T0));
  ok("plan: a plan usage limit pauses the job (rate limit), the state is 'limited' with NO reset time, and the words point to ChatGPT Usage settings", res.err?.kind === "rate_limit" && st.kind === "limited" && (st as any).resetsAt === null && /ChatGPT/.test(msg.title) && msg.actions.includes("open_account")); await r.cleanup(); }
{ const r = await rig({ script: () => ({ status: 403, body: { error: { code: "subscription_sharing_user_not_eligible", message: "no" } } }) }); const a = r.rt.access; a.chooseProvider("openai"); a.chooseMode("subscription"); a.acceptNotice(); await r.secrets.set(SECRET_NAMES.openaiPlan, JSON.stringify(r.record())); await r.analyse();
  ok("plan: 'not eligible' becomes 'subscription refused' (switch to a key), not a retry loop", (await a.state()).kind === "subscription_refused"); await r.cleanup(); }
{ const r = await rig(); const a = r.rt.access; a.chooseProvider("openai"); a.chooseMode("subscription"); a.acceptNotice(); await r.secrets.set(SECRET_NAMES.openaiPlan, JSON.stringify(r.record({ scopes: ["openid"] }))); const before = (await a.state()).kind; const res = await r.analyse();
  ok("plan: signed in but the plan permission was not granted: before any attempt the state is 'not connected'", before === "not_connected");
  ok("plan: the job pauses (auth), no model call is made, and after that failed attempt the remembered error makes the state 'expired' (connect again)", res.err?.kind === "auth" && r.auths.length === 0 && (await a.state()).kind === "expired"); await r.cleanup(); }

// ---------- test connection and key connect ----------
{ const r = await rig(); const prov = r.rt.openaiKeyProvider("sk-test-0123456789abcdefghij"); const t = await testOpenAIConnection({ provider: prov, mode: "apiKey", db: r.db, now: () => new Date(T0) });
  ok("test connection: one tiny call on the cheapest model succeeds and is written to the ledger as role 'test'", t.ok === true && r.rows()[0].role === "test" && r.rows()[0].model === "gpt-6-luna" && r.srv.seen[0].body.model === "gpt-6-luna"); await r.cleanup(); }
{ const r = await rig({ script: () => ({ status: 401, body: { error: { code: "invalid_api_key", message: "bad" } } }) }); const saved: string[] = []; const access = { saveApiKey: async (k: string) => { saved.push(k); }, chooseMode: () => undefined, recordSuccess: () => undefined };
  const bad = await connectWithOpenAIKey("sk-test-0123456789abcdefghij", { makeProvider: r.rt.openaiKeyProvider, access, db: r.db });
  const short = await connectWithOpenAIKey("sk-short", { makeProvider: r.rt.openaiKeyProvider, access, db: r.db }); const sp = await connectWithOpenAIKey("sk-test 0123456789abcdefghij", { makeProvider: r.rt.openaiKeyProvider, access, db: r.db });
  ok("connect with key: a refused key is NOT saved (state says key invalid); a too-short key or one with spaces is 'malformed' and nothing is called", !bad.ok && (bad as any).state?.kind === "key_invalid" && saved.length === 0 && (short as any).kind === "malformed" && (sp as any).kind === "malformed" && r.srv.seen.length === 1); await r.cleanup(); }
{ const r = await rig(); const saved: string[] = []; const chosen: unknown[] = []; const access = { saveApiKey: async (k: string) => { saved.push(k); }, chooseMode: (m: unknown) => chosen.push(m), recordSuccess: () => undefined };
  const good = await connectWithOpenAIKey("  sk-test-0123456789abcdefghij  ", { makeProvider: r.rt.openaiKeyProvider, access, db: r.db });
  ok("connect with key: a proven key is saved trimmed and the way to connect becomes the API key", good.ok === true && saved[0] === "sk-test-0123456789abcdefghij" && chosen[0] === "apiKey" && r.srv.seen[0].headers.authorization === "Bearer sk-test-0123456789abcdefghij"); await r.cleanup(); }
{ const r = await rig({ script: () => ({ status: 403, body: { error: { code: "x" } } }) }); const prov = r.rt.openaiKeyProvider("sk-test-0123456789abcdefghij");
  const t = await testOpenAIConnection({ provider: { ...prov, run: async () => ({ type: "breach", problems: ["wrong kind"] }) }, mode: "apiKey" });
  ok("test connection: a credential of the wrong kind is reported as a mismatch", !t.ok && (t as any).kind === "mode_mismatch"); await r.cleanup(); }

// ---------- the words ----------
{ const states: any[] = [{ kind: "not_chosen" }, { kind: "notice_needed" }, { kind: "not_connected", mode: "subscription" }, { kind: "not_connected", mode: "apiKey" }, { kind: "connected", mode: "subscription", plan: null, expiresAt: null, daysLeft: null }, { kind: "expired", mode: "subscription" }, { kind: "key_saved", mode: "apiKey" }, { kind: "key_invalid", mode: "apiKey" }, { kind: "subscription_refused", mode: "subscription" }, { kind: "account_problem", mode: "apiKey", why: "billing" }, { kind: "limited", mode: "subscription", resetsAt: null }, { kind: "limited", mode: "apiKey", resetsAt: null }, { kind: "unknown", mode: "apiKey", reason: "keychain" }, { kind: "unknown", mode: "subscription", reason: "unreadable" }, { kind: "unknown", mode: "subscription", reason: "other" }];
  const msgs = states.map((s) => M.describeOpenAIState(s, new Date(T0))), all = JSON.stringify(msgs);
  ok("words: every state has a plain message with a title, a body and buttons that exist, and never says Claude or Anthropic", msgs.every((m) => m.title && m.body && m.actions.every((a) => a in ACTION_LABELS && a in M.OPENAI_ACTION_LABELS)) && !/Claude|Anthropic/.test(all));
  const pauses = (["auth", "rate_limit", "unavailable", "account", "timeout", "cap", "setup", "isolation", "other"] as const).flatMap((k) => [M.describeOpenAIPause(k, { now: new Date(T0), mode: "apiKey" }), M.describeOpenAIPause(k, { now: new Date(T0), mode: "subscription" })]);
  ok("words: every pause reason has a message, and none says Claude, Anthropic, a status code or a token", pauses.every((m) => m.title && m.body) && !/Claude|Anthropic|\b[45]\d\d\b|sk-|eyJ/.test(JSON.stringify(pauses)));
  const si = (["cancelled", "denied", "timeout", "plan_not_enabled", "invalid_identity", "registration_incomplete", "failed", "not_runnable", "already_running"] as const).map((reason) => M.describeOpenAISignInResult({ ok: false, reason })).concat(M.describeOpenAISignInResult({ ok: true }));
  ok("words: every sign-in outcome has a message, and the notice has four points and a checkbox", si.every((m) => m.title && m.body) && M.OPENAI_PLAN_NOTICE.points.length === 4 && M.OPENAI_PLAN_NOTICE.checkbox.length > 10);
  ok("words: the sign-in button says 'Continue with ChatGPT' as OpenAI's guidelines require", M.OPENAI_ACTION_LABELS.signin === "Continue with ChatGPT"); }


// ---------- a job stays with the service that started it ----------
{ const r = await rig(); const a = r.rt.access; a.chooseProvider("openai"); a.chooseMode("apiKey"); await a.saveApiKey("sk-test-0123456789abcdefghij"); const first = await r.analyse();
  a.chooseProvider("claude"); a.chooseMode("apiKey"); await a.saveApiKey("sk-ant-api03-0123456789abcdefghij"); const sent = r.auths.length;
  const run = await r.rt.runnerFor(priya)(first.job.dir, "coach", "verdict");
  ok("job service: a job started with OpenAI refuses a Claude call (a setup failure, nothing sent to either service), and its marker says openai", run.code === EXIT.setup && /started with openai/.test(run.log) && r.auths.length === sent && (await import("../src/access/job-service.ts")).readJobService(first.job.dir) === "openai"); await r.cleanup(); }
// ---------- this Mac's choice is not exported ----------
{ const { exportAll, importExport } = await import("../src/store/export.ts"); const { saveProfile } = await import("../src/store/profile-store.ts");
  const rt = mkdtempSync(path.join(os.tmpdir(), "cvapp-oai-imp-")), A = openDb(":memory:"), B = openDb(":memory:"); migrate(A, MIGRATIONS); migrate(B, MIGRATIONS); const NOW = new Date(T0);
  saveProfile(A, priya, NOW); setSettings(A, { "ai.provider": "openai", "openai.noticeAcceptedAt": NOW.toISOString(), tone: "concise" }, NOW); mkdirSync(path.join(rt, "ja")); mkdirSync(path.join(rt, "jb"));
  await exportAll(A, path.join(rt, "ja"), path.join(rt, "e.zip"), { now: NOW }); const imp = await importExport({ zipFile: path.join(rt, "e.zip"), db: B, jobsDir: path.join(rt, "jb"), backupsDir: path.join(rt, "bk"), now: NOW, confirmReplace: true });
  ok("export: the chosen service and the ChatGPT notice date stay on this Mac (an import does not bring them), ordinary settings do", imp.ok && getSettings(B).settings["ai.provider"] === "claude" && getSettings(B).settings["openai.noticeAcceptedAt"] === null && getSettings(B).settings.tone === "concise");
  A.close(); B.close(); rmSync(rt, { recursive: true, force: true }); }
console.log(failures === 0 ? "\nall openai-access tests passed" : `\n${failures} openai-access test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
