// Phase 3c: the access state model. One environment function, the status parser that drops account details, the state truth table, the error mapping, the mode check
// on every call, the access service with fakes, and the REAL bundled program's free status check in a throwaway settings folder (no login touched, no model call).
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const O = await import("../src/agents/options.ts");
const S = await import("../src/access/status.ts");
const T = await import("../src/access/state.ts");
const { createAccess, findBundledClaude } = await import("../src/access/access.ts");
const { createSdkRunner } = await import("../src/agents/runner.ts");
const { EXIT } = await import("../src/agents/errors.ts");
const { openDb } = await import("../src/store/db.ts");
const { migrate } = await import("../src/store/migrate.ts");
const { MIGRATIONS } = await import("../src/store/schema.ts");
const { getSettings, setSettings } = await import("../src/store/settings-store.ts");
const { MemorySecretStore, SECRET_NAMES } = await import("../src/store/secrets.ts");
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const NOW = new Date("2026-11-17T12:00:00Z"), day = (n: number) => new Date(NOW.getTime() + n * 86400_000).toISOString();
const me = os.userInfo().username;

// ---------- the one environment function ----------
{
  const bare = O.minimalEnv({ PATH: "/bin" }), wrong = O.minimalEnv({ PATH: "/bin", USER: "someoneelse", LOGNAME: "x" }), named = O.minimalEnv({}, { userName: "pat" });
  ok("USER is ALWAYS set from the operating system, never inherited: missing, or wrong in the inherited environment, it is still the real user name (step 3a: the login lookup needs exactly this)", bare.USER === me && wrong.USER === me && named.USER === "pat");
  ok("the settings-folder variable is set only when asked (tests and live checks), the API key only in key mode, and no other ANTHROPIC_ or CLAUDE_CODE_ variable leaks from the parent", !("CLAUDE_CONFIG_DIR" in O.minimalEnv({ CLAUDE_CONFIG_DIR: "/real" })) && O.minimalEnv({}, { configDir: "/tmp/c" }).CLAUDE_CONFIG_DIR === "/tmp/c" && !("ANTHROPIC_API_KEY" in O.minimalEnv({ ANTHROPIC_API_KEY: "sk-ant-parent" })) && O.minimalEnv({}, { apiKey: "k" }).ANTHROPIC_API_KEY === "k" && Object.keys(O.minimalEnv({ CLAUDE_CODE_OAUTH_TOKEN: "t", ANTHROPIC_BASE_URL: "u" })).every((k) => !/^(ANTHROPIC_|CLAUDE_CODE_)/.test(k)));
  ok("the status check, the sign-in and every call use the SAME function (claudeEnv is minimalEnv), so they cannot disagree about the login", O.claudeEnv === O.minimalEnv);
}

// ---------- the status parser ----------
const REAL_SHAPE = (o: object = {}) => JSON.stringify({ analyticsDisabled: false, apiProvider: "firstParty", authMethod: "claude.ai", configDirectory: "/Users/ACCOUNTCANARY/.claude", email: "canary.person@example.org", loggedIn: true, loginExpiresAt: day(20), orgId: "ORGIDCANARY", orgName: "OrgNameCanary Ltd", planTier: "pro", projectsDirectory: "/Users/ACCOUNTCANARY/.claude/projects", storedClaudeAiLogin: true, subscriptionType: "pro", ...o });
{
  const p = S.parseStatus(REAL_SHAPE())!, dumped = JSON.stringify(p);
  ok("the parser keeps only logged-in, method, plan and the end date; the e-mail address, organisation, folder paths and every other field are DROPPED at once", p.loggedIn && p.method === "claude.ai" && p.plan === "pro" && p.expiresAt === day(20) && Object.keys(p).sort().join() === "expiresAt,loggedIn,method,plan" && !/canary|ORGID|ACCOUNT|\/Users\//i.test(dumped));
  ok("a logged-out answer has no method and no plan; odd or missing values become null, not errors", (() => { const x = S.parseStatus(JSON.stringify({ loggedIn: false, authMethod: "none" }))!; const y = S.parseStatus(JSON.stringify({ loggedIn: true, loginExpiresAt: "not a date", subscriptionType: 5 }))!; return !x.loggedIn && x.method === null && x.plan === null && y.expiresAt === null && y.plan === null; })());
  ok("anything that is not a status answer (empty, not JSON, JSON without loggedIn, an array, a string) is unreadable (null), never a guess", ["", "nope", "{}", "[]", '"x"', "null", '{"loggedIn":"yes"}'].every((x) => S.parseStatus(x) === null));
}

// ---------- the state truth table ----------
{
  const st = (o: Partial<import("../src/access/status.ts").LoginStatus> = {}) => ({ ok: true as const, status: { loggedIn: true, method: "claude.ai", plan: "pro", expiresAt: day(20), ...o } });
  const C = (o: Partial<import("../src/access/state.ts").Inputs>) => T.computeAccessState({ mode: "subscription", noticeAccepted: true, now: NOW, status: st(), hasKey: false, ...o });
  ok("no way chosen yet: not_chosen; subscription chosen but the risk notice not accepted: notice_needed (nothing else is even asked)", C({ mode: null }).kind === "not_chosen" && C({ noticeAccepted: false, status: null }).kind === "notice_needed");
  const conn = C({}); ok("a healthy subscription login is 'connected' with the plan, the end date and whole days left", conn.kind === "connected" && conn.plan === "pro" && conn.daysLeft === 20);
  ok("under 3 days left: expiring_soon (with the days); 3 days: still connected; already past: expired", C({ status: st({ expiresAt: day(2.5) }) }).kind === "expiring_soon" && (C({ status: st({ expiresAt: day(2.5) }) }) as { daysLeft: number }).daysLeft === 2 && C({ status: st({ expiresAt: day(3.2) }) }).kind === "connected" && C({ status: st({ expiresAt: day(-1) }) }).kind === "expired");
  ok("logged out: not_connected, unless the end date had passed, which means the login ran out: expired (Reconnect)", C({ status: st({ loggedIn: false, method: null, plan: null, expiresAt: null }) }).kind === "not_connected" && C({ status: st({ loggedIn: false, expiresAt: day(-2) }) }).kind === "expired");
  ok("a login that is not a claude.ai subscription login (for example a console login) is NOT treated as a subscription: unknown", C({ status: st({ method: "console" }) }).kind === "unknown");
  ok("the status check itself failing (cannot run, timeout, unreadable) is unknown with the reason, never 'connected' and never 'not connected'", (["not_runnable", "timeout", "unreadable"] as const).every((r) => { const s = C({ status: { ok: false, reason: r } }); return s.kind === "unknown" && s.reason === r; }) && C({ status: null }).kind === "unknown");
  ok("API-key mode: no key is not_connected, a stored key is key_saved (proven only by a validation call), and the subscription status is never consulted", C({ mode: "apiKey", hasKey: false, status: null }).kind === "not_connected" && C({ mode: "apiKey", hasKey: true, status: null }).kind === "key_saved" && C({ mode: "apiKey", hasKey: true, status: st({ loggedIn: false }) }).kind === "key_saved");
  ok("the last failed call changes the state: a refused key is key_invalid; in subscription mode an authentication failure means expired even if the free check still says logged in", C({ mode: "apiKey", hasKey: true, lastError: { type: "authentication_failed", status: 401, message: "Invalid API key" } }).kind === "key_invalid" && C({ lastError: { type: "authentication_failed" } }).kind === "expired");
  ok("a usage limit is 'limited' with the reset time and the SAME mode (never a switch to the other mode); an organisation block is subscription_refused; hold, billing and verification are account problems with their reason", (() => { const l = C({ lastError: { type: "rate_limit", resetsAt: day(0.1) } }); const a = C({ lastError: { type: "account_on_hold" } }), b = C({ mode: "apiKey", hasKey: true, lastError: { type: "billing_error" } }), v = C({ lastError: { type: "verification_required" } }); return l.kind === "limited" && l.mode === "subscription" && l.resetsAt === day(0.1) && C({ lastError: { type: "oauth_org_not_allowed" } }).kind === "subscription_refused" && a.kind === "account_problem" && a.why === "on_hold" && b.kind === "account_problem" && b.why === "billing" && v.kind === "account_problem" && v.why === "verification"; })());
  ok("only 'connected', 'expiring_soon' and 'key_saved' let a job start; every other state blocks it", (() => { const all = [C({ mode: null }), C({ noticeAccepted: false }), C({}), C({ status: st({ expiresAt: day(1) }) }), C({ status: st({ loggedIn: false }) }), C({ mode: "apiKey", hasKey: true }), C({ mode: "apiKey" }), C({ lastError: { type: "rate_limit" } }), C({ status: null })]; return all.filter(T.usable).map((s) => s.kind).join() === "connected,expiring_soon,key_saved"; })());
  ok("error mapping from the real 3a shapes: 'Invalid API key' (401) is a key problem, 'Not logged in' is expired/not connected, a model-not-found error is NOT an access problem (unknown)", T.stateFromError({ type: "authentication_failed", status: 401, message: "Invalid API key · Fix external API key", apiKeySource: "ANTHROPIC_API_KEY" }, "apiKey").kind === "key_invalid" && T.stateFromError({ type: "authentication_failed", message: "Not logged in · Please run /login", apiKeySource: "none" }, "subscription").kind === "expired" && T.stateFromError({ type: "model_not_found", status: 404 }, "subscription").kind === "unknown" && T.stateFromError({ status: 429 }, "apiKey").kind === "limited");
}

// ---------- the mode check on every call ----------
ok("mode check: subscription needs apiKeySource 'none', an API key needs 'ANTHROPIC_API_KEY'; the wrong one, a missing one or an unknown value is a problem (a key call that quietly used the subscription is caught); no chosen mode checks nothing", T.modeProblems("none", "subscription").length === 0 && T.modeProblems("ANTHROPIC_API_KEY", "apiKey").length === 0 && T.modeProblems("ANTHROPIC_API_KEY", "subscription").length === 1 && T.modeProblems("none", "apiKey").length === 1 && T.modeProblems(undefined, "apiKey").length === 1 && T.modeProblems("something-new", "subscription").length === 1 && T.modeProblems("none", undefined).length === 0);
{
  const priya = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8")), root = mkdtempSync(path.join(os.tmpdir(), "cvapp-acc-"));
  const cfg = { models: { analyst: "m", writer: "m", checker: "m", coach: "m" }, agentTimeoutSeconds: 5, researchTimeoutSeconds: 5, maxAdChars: 30000 };
  const run = async (mode: "subscription" | "apiKey" | undefined, source: string | undefined, apiKey?: string) => {
    const job = mkdtempSync(path.join(root, "job-")); writeFileSync(path.join(job, "ad.md"), "An ad about marketing. ".repeat(10)); let afterInit = false, started = 0;
    const q = (a: { options: { cwd: string } }) => (started++, (async function* () { yield { type: "system", subtype: "init", tools: ["StructuredOutput"], mcp_servers: [], plugins: [], skills: [], cwd: a.options.cwd, permissionMode: "default", ...(source ? { apiKeySource: source } : {}) }; afterInit = true; yield { type: "result", subtype: "success", is_error: false, structured_output: { x: 1 }, total_cost_usd: 0, modelUsage: {}, errors: [] }; })());
    const r = await createSdkRunner({ profile: priya, tone: "friendly", config: cfg, skillsDir: path.join(dir, "..", "skills"), query: q as never, tmpRoot: root, env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-parent-must-be-dropped" }, mode, ...(apiKey ? { apiKey } : {}) })(job, "analyst");
    return { r, afterInit, started, wrote: existsSync(path.join(job, "analysis.json")) };
  };
  const a = await run("apiKey", "none", "sk-test-key"), b = await run("subscription", "none"), c = await run("subscription", "ANTHROPIC_API_KEY"), d2 = await run(undefined, undefined);
  ok("runner, second line: a key call whose session says it used the subscription is STOPPED at the session's first message (isolation exit code, a plain reason) and no answer is read or written (this does NOT stop the prompt being sent: see the phase 3 review and the preflight below)", a.r.code === EXIT.isolation && /ANTHROPIC_API_KEY/.test(a.r.log) && !a.afterInit && !a.wrote && a.started === 1);
  ok("runner: the right source for the chosen mode runs normally; a subscription call that used a key is stopped too; with no mode given and no key (tests) nothing is checked", b.r.code === EXIT.ok && b.wrote && c.r.code === EXIT.isolation && !c.wrote && d2.r.code === EXIT.ok);
  // PREFLIGHT: the program is never even started when the mode and the key disagree (the query function is never called)
  const p1 = await run("apiKey", "ANTHROPIC_API_KEY"), p2 = await run("subscription", "none", "sk-test-key"), p3 = await run("apiKey", "ANTHROPIC_API_KEY", "sk-test-key"), p4 = await run(undefined, "ANTHROPIC_API_KEY", "sk-test-key"), p5 = await run(undefined, "none");
  ok("PREFLIGHT: with mode 'apiKey' and no key, or mode 'subscription' and a key, the program is NEVER STARTED (the query function is not called once; nothing can be sent), with a plain reason and the isolation exit code", p1.r.code === EXIT.isolation && p1.started === 0 && /no key was given/.test(p1.r.log) && p2.r.code === EXIT.isolation && p2.started === 0 && /subscription but an API key/.test(p2.r.log) && !p1.wrote && !p2.wrote);
  ok("PREFLIGHT: matching mode and key starts normally; a key without a mode is taken to mean API-key mode (inferred), so the check cannot be skipped by forgetting to pass the mode; a parent's ANTHROPIC_API_KEY never counts (the environment function drops it)", p3.r.code === EXIT.ok && p3.started === 1 && p4.r.code === EXIT.ok && p5.r.code === EXIT.ok && (await run("subscription", "none")).started === 1);
  ok("the preflight rule itself: key mode needs a key in the environment, subscription mode needs none, no mode checks nothing", T.preflightProblems("apiKey", { ANTHROPIC_API_KEY: "k" }).length === 0 && T.preflightProblems("apiKey", {}).length === 1 && T.preflightProblems("subscription", {}).length === 0 && T.preflightProblems("subscription", { ANTHROPIC_API_KEY: "k" }).length === 1 && T.preflightProblems(undefined, { ANTHROPIC_API_KEY: "k" }).length === 0);
  rmSync(root, { recursive: true, force: true });
}

// ---------- the access service with fakes ----------
{
  const db = openDb(":memory:"); migrate(db, MIGRATIONS); const secrets = new MemorySecretStore();
  let status: unknown = REAL_SHAPE(), calls = 0, lastEnv: Record<string, string> = {}, lastArgs: string[] = [];
  const run: import("../src/access/status.ts").StatusRunner = async (args, env) => { calls++; lastArgs = args; lastEnv = env; return typeof status === "string" ? { code: 0, stdout: status, timedOut: false, failedToStart: false } : (status as never); };
  const acc = createAccess({ db, secrets, run, now: () => NOW });
  ok("service: a new app has no way chosen and asks nothing of Claude or the Keychain", (await acc.state()).kind === "not_chosen" && calls === 0);
  acc.chooseMode("subscription");
  ok("service: subscription chosen but not accepted: notice_needed, and the status check is NOT run before the notice is accepted", (await acc.state()).kind === "notice_needed" && calls === 0);
  acc.acceptNotice(); const s1 = await acc.state();
  ok("service: after the notice, the free status check runs (arguments: auth status --json; the one environment function: USER set, no API key) and the state is connected", s1.kind === "connected" && calls === 1 && lastArgs.join(" ") === "auth status --json" && lastEnv.USER === me && !("ANTHROPIC_API_KEY" in lastEnv) && getSettings(db).settings["claude.noticeAcceptedAt"] === NOW.toISOString());
  acc.recordError({ type: "authentication_failed", message: "Not logged in · Please run /login", apiKeySource: "none" });
  ok("service: a failed call is remembered: the state is 'expired' (Reconnect) EVEN THOUGH the free status check still says logged in (the check cannot know a login was revoked)", (await acc.state()).kind === "expired" && calls > 0);
  status = REAL_SHAPE(); acc.recordSuccess();
  ok("service: after a success the state is connected again", (await acc.state()).kind === "connected");
  status = { code: null, stdout: "", timedOut: true, failedToStart: false };
  ok("service: a status check that times out is unknown/timeout, never a wrong 'connected'", await (async () => { const s = await acc.state(); return s.kind === "unknown" && s.reason === "timeout"; })());
  status = { code: null, stdout: "", timedOut: false, failedToStart: true };
  ok("service: a program that cannot start is unknown/not_runnable", (await acc.state() as { reason?: string }).reason === "not_runnable");
  acc.chooseMode("apiKey");
  const c0 = calls; const k0 = await acc.state(); await secrets.set(SECRET_NAMES.claudeApiKey, "sk-ant-CANARY-ACCESS-KEY"); const k1 = await acc.state();
  ok("service: API-key mode reads only the secret store (no status check, so no quota and no call): not_connected without a key, key_saved with one", k0.kind === "not_connected" && k1.kind === "key_saved" && calls === c0);
  const ke = acc.recordError({ type: "authentication_failed", status: 401, message: "Invalid API key", apiKeySource: "ANTHROPIC_API_KEY" });
  ok("service: a refused key makes the state key_invalid, without ever returning the key", ke!.kind === "key_invalid" && !JSON.stringify(await acc.state()).includes("CANARY"));
  ok("service: choosing a mode is stored in the settings, and settings can be changed back to 'nothing chosen'", getSettings(db).settings["claude.mode"] === "apiKey" && acc.chooseMode(null).ok && (await acc.state()).kind === "not_chosen");
  ok("settings: the mode and the notice date refuse bad values", !setSettings(db, { "claude.mode": "free" as never }, NOW).ok && !setSettings(db, { "claude.noticeAcceptedAt": "yesterday" as never }, NOW).ok);
  db.close();
}

// ---------- the lifecycle of the remembered error (phase 3 review) ----------
{
  const db = openDb(":memory:"); migrate(db, MIGRATIONS); const secrets = new MemorySecretStore();
  let t = NOW; const loggedIn = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro", loginExpiresAt: day(20) });
  const acc = createAccess({ db, secrets, now: () => t, run: async () => ({ code: 0, stdout: loggedIn, timedOut: false, failedToStart: false }) });
  acc.chooseMode("subscription"); acc.acceptNotice();
  acc.recordError({ type: "authentication_failed", message: "Not logged in", apiKeySource: "none" });
  const before = (await acc.state()).kind; acc.chooseMode("apiKey"); await acc.saveApiKey("sk-ant-NEWKEY-NEVER-TRIED");
  ok("switching mode and saving a NEW key forgets the old error: a key that was never tried is key_saved, not key_invalid (it was, before the fix)", before === "expired" && (await acc.state()).kind === "key_saved");
  acc.chooseMode("subscription"); acc.recordError({ type: "authentication_failed", message: "Not logged in" }); await secrets.set(SECRET_NAMES.claudeApiKey, "sk-ant-ALREADY-STORED"); acc.chooseMode("apiKey");
  ok("changing the way to connect forgets the old error on its own (the key was stored earlier, not just now)", (await acc.state()).kind === "key_saved");
  acc.recordError({ type: "authentication_failed", status: 401, message: "Invalid API key", apiKeySource: "ANTHROPIC_API_KEY" });
  const refused = (await acc.state()).kind; await acc.saveApiKey("sk-ant-REPLACEMENT-KEY");
  ok("a refused key shows key_invalid until the user saves a different key, which clears it; removing the key goes back to not_connected", refused === "key_invalid" && (await acc.state()).kind === "key_saved" && (await acc.removeApiKey()) === true && (await acc.state()).kind === "not_connected");
  acc.chooseMode("subscription"); acc.recordError({ type: "authentication_failed", message: "Not logged in" }); acc.signedIn();
  ok("a finished sign-in clears the 'expired' error at once (no restart needed after the user reconnects, even outside the app)", (await acc.state()).kind === "connected");
  acc.recordError({ type: "rate_limit", resetsAt: new Date(NOW.getTime() + 30 * 60_000).toISOString() });
  const during = (await acc.state()) as { kind: string; resetsAt: string }; t = new Date(NOW.getTime() + 31 * 60_000);
  ok("a usage limit shows 'limited' with its reset time, and LAPSES at that time (the app is not stuck on it)", during.kind === "limited" && !!during.resetsAt && (await acc.state()).kind === "connected");
  t = NOW; acc.recordError({ type: "rate_limit" }); const noReset = (await acc.state()).kind; t = new Date(NOW.getTime() + 14 * 60_000); const at14 = (await acc.state()).kind; t = new Date(NOW.getTime() + 16 * 60_000);
  ok("a limit with no known reset time is forgotten after 15 minutes", noReset === "limited" && at14 === "limited" && (await acc.state()).kind === "connected");
  acc.recordSuccess(); t = NOW;
  const r1 = acc.recordError({ type: "server_error", message: "overloaded" }), r2 = acc.recordError({ type: "overloaded" }), r3 = acc.recordError({ type: "model_not_found", status: 404 }), r4 = acc.recordError({ type: "unknown", message: "boom" }), r5 = acc.recordError({ type: "max_output_tokens" });
  ok("errors that say nothing about ACCESS (outage, overloaded, wrong model, unknown, too long) are NOT remembered: the state stays connected, so one outage can never lock the app", [r1, r2, r3, r4, r5].every((r) => r === null) && (await acc.state()).kind === "connected" && T.usable(await acc.state()));
  ok("errors that DO say something about access are remembered: authentication, organisation block, hold, billing, verification, rate limit, HTTP 401 and 429", ["authentication_failed", "oauth_org_not_allowed", "account_on_hold", "billing_error", "verification_required", "rate_limit"].every((type) => T.isAccessError({ type })) && T.isAccessError({ status: 401 }) && T.isAccessError({ status: 429 }) && !T.isAccessError({ type: "server_error" }) && !T.isAccessError({ status: 500 }));
  ok("every state that comes from a remembered error (limited, expired, key_invalid, refused, account problem, unknown) allows the user to press Test connection or Resume, so a blocked state can clear itself; the states that need a user action first (not chosen, notice, no key or login) do not", (() => { const k = (s: unknown) => T.retryable(s as never); return k({ kind: "limited" }) && k({ kind: "expired" }) && k({ kind: "key_invalid" }) && k({ kind: "subscription_refused" }) && k({ kind: "account_problem" }) && k({ kind: "unknown" }) && !k({ kind: "not_chosen" }) && !k({ kind: "notice_needed" }) && !k({ kind: "not_connected" }) && !k({ kind: "connected" }) && !k({ kind: "key_saved" }); })());
  acc.chooseMode("apiKey"); await acc.saveApiKey("k");
  const locked = new MemorySecretStore(); locked.get = async () => { throw new Error("keychain locked"); };
  const acc2 = createAccess({ db, secrets: locked, now: () => NOW, run: async () => ({ code: 0, stdout: loggedIn, timedOut: false, failedToStart: false }) });
  const kc = (await acc2.state()) as { kind: string; reason?: string };
  ok("a Keychain that cannot be read is 'unknown' (reason keychain), NOT 'no key'", kc.kind === "unknown" && kc.reason === "keychain");
  db.close();
  // import leaves this Mac's way of connecting alone (review item)
  const { exportAll, importExport } = await import("../src/store/export.ts"); const { saveProfile } = await import("../src/store/profile-store.ts"); const { mkdirSync } = await import("node:fs");
  const priya = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8")), rt = mkdtempSync(path.join(os.tmpdir(), "cvapp-imp-")), A = openDb(":memory:"), Bd = openDb(":memory:"); migrate(A, MIGRATIONS); migrate(Bd, MIGRATIONS);
  saveProfile(A, priya, NOW); setSettings(A, { "claude.mode": "apiKey", "claude.noticeAcceptedAt": NOW.toISOString(), tone: "concise" }, NOW); mkdirSync(path.join(rt, "ja")); mkdirSync(path.join(rt, "jb"));
  setSettings(Bd, { "claude.mode": "subscription" }, NOW);
  await exportAll(A, path.join(rt, "ja"), path.join(rt, "e.zip"), { now: NOW }); const imp = await importExport({ zipFile: path.join(rt, "e.zip"), db: Bd, jobsDir: path.join(rt, "jb"), backupsDir: path.join(rt, "bk"), now: NOW, confirmReplace: true });
  ok("importing an export leaves THIS Mac's way of connecting (mode, notice) untouched, while the ordinary settings come across", imp.ok && getSettings(Bd).settings["claude.mode"] === "subscription" && getSettings(Bd).settings["claude.noticeAcceptedAt"] === null && getSettings(Bd).settings.tone === "concise");
  A.close(); Bd.close(); rmSync(rt, { recursive: true, force: true });
}

// ---------- the real status runner: timeouts, output cap, and the real program ----------
{
  const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-run-")), script = (n: string, body: string) => { const f = path.join(root, n); writeFileSync(f, "#!/bin/sh\n" + body); chmodSync(f, 0o755); return f; };
  const slow = await S.checkLoginStatus(S.spawnRunner(script("slow.sh", "sleep 5\n"), { timeoutMs: 300 }), {}), noExe = await S.checkLoginStatus(S.spawnRunner(path.join(root, "missing"), { timeoutMs: 1000 }), {});
  const big = await S.checkLoginStatus(S.spawnRunner(script("big.sh", "yes AAAAAAAAAAAAAAAAAAAAAAAAAAAA | head -c 3000000\n"), { maxBytes: 1000, timeoutMs: 5000 }), {});
  const good = await S.checkLoginStatus(S.spawnRunner(script("good.sh", `echo '${REAL_SHAPE()}'\n`), { timeoutMs: 5000 }), {});
  const envOut = S.spawnRunner(script("env.sh", 'echo "{\\"loggedIn\\":true,\\"authMethod\\":\\"claude.ai\\",\\"subscriptionType\\":\\"$ONLYTHIS\\"}"\n'), { timeoutMs: 5000 });
  const envRes = await S.checkLoginStatus(envOut, { ONLYTHIS: "visible" }), noInherit = await S.checkLoginStatus(S.spawnRunner(script("env2.sh", 'echo "{\\"loggedIn\\":true,\\"subscriptionType\\":\\"$HOME\\"}"\n'), { timeoutMs: 5000 }), {});
  ok("runner: a program that hangs is stopped at the timeout (timeout), a missing program is not_runnable, an endless output is cut at the cap and is unreadable, a good answer is parsed", !slow.ok && slow.reason === "timeout" && !noExe.ok && noExe.reason === "not_runnable" && !big.ok && big.reason === "unreadable" && good.ok && good.status.plan === "pro");
  ok("runner: the program gets ONLY the environment it is given (nothing inherited from the app)", envRes.ok && envRes.status.plan === "visible" && noInherit.ok && noInherit.status.plan === null);
  const bin = findBundledClaude();
  if (!bin) console.log("SKIP real bundled program: not installed here");
  else {
    const cfgDir = mkdtempSync(path.join(os.tmpdir(), "cvapp-nologin-")), before = readdirSync(cfgDir).length;
    const real = await S.checkLoginStatus(S.spawnRunner(bin, { timeoutMs: 20000 }), O.minimalEnv(process.env, { configDir: cfgDir }));
    const noUser = await S.checkLoginStatus(S.spawnRunner(bin, { timeoutMs: 20000 }), { PATH: process.env.PATH ?? "", CLAUDE_CONFIG_DIR: cfgDir });
    ok("REAL bundled program, empty settings folder (no login is read or changed, no model call): the free status check runs, parses, and says not logged in; the resulting state is not_connected", real.ok && !real.status.loggedIn && real.status.method === null && T.computeAccessState({ mode: "subscription", noticeAccepted: true, now: NOW, status: real, hasKey: false }).kind === "not_connected" && before === 0);
    ok("REAL bundled program through the access service end to end (real runner, real environment function, throwaway folder): not_connected", (await (async () => { const db = openDb(":memory:"); migrate(db, MIGRATIONS); const a = createAccess({ db, secrets: new MemorySecretStore(), run: S.spawnRunner(bin, { timeoutMs: 20000 }), now: () => NOW, configDir: cfgDir }); a.chooseMode("subscription"); a.acceptNotice(); const s = await a.state(); db.close(); return s.kind === "not_connected"; })()) && noUser.ok);
    rmSync(cfgDir, { recursive: true, force: true });
  }
  rmSync(root, { recursive: true, force: true });
}
console.log(failures === 0 ? "\nall access tests passed" : `\n${failures} access test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
