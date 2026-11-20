// Phase 3e: the durable usage ledger, the monthly spend cap with its pause, and "Test connection" / API-key validation. Fakes only: no Claude call, no real key.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { openDb } = await import("../src/store/db.ts");
const { migrate } = await import("../src/store/migrate.ts");
const { MIGRATIONS } = await import("../src/store/schema.ts");
const { getSettings, setSettings } = await import("../src/store/settings-store.ts");
const L = await import("../src/access/ledger.ts");
const C = await import("../src/access/connect.ts");
const { createAccess } = await import("../src/access/access.ts");
const { createSdkRunner } = await import("../src/agents/runner.ts");
const { EXIT, PAUSABLE } = await import("../src/agents/errors.ts");
const { MemorySecretStore, SECRET_NAMES } = await import("../src/store/secrets.ts");
const D = await import("../src/store/delete.ts");
const X = await import("../src/store/export.ts");
const { saveProfile } = await import("../src/store/profile-store.ts");
const { openStore, JOBS_DIR, BACKUPS_DIR } = await import("../src/store/open.ts");
const PL = await import("../src/pipeline.ts");
const { profileToPersona } = await import("../src/profile.ts");
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const priya = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8")), ctx = profileToPersona(priya, new Date());
const L0 = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0); // local time: "this month" is the Mac's calendar month
const NOW = L0(2026, 11, 17), db0 = () => { const d = openDb(":memory:"); migrate(d, MIGRATIONS); return d; };
const rec = (db: ReturnType<typeof db0>, at: Date, cost: number, mode: "apiKey" | "subscription" | null = "apiKey", extra: object = {}) => L.recordUsage(db, { at: at.toISOString(), role: "analyst", model: "m", mode, costUsd: cost, ok: true, ...extra });


// ---------- migration 5: which service made each call ----------
{
  const d = openDb(":memory:"); migrate(d, MIGRATIONS.slice(0, 4)); d.run("INSERT INTO usage(at, role, mode, cost_usd, ok) VALUES (?, 'analyst', 'apiKey', 1.5, 1)", NOW.toISOString());
  migrate(d, MIGRATIONS, { beforeMigrate: () => undefined });
  ok("migration 5: calls recorded before it are Claude calls (the only service there was) and stay in the totals", d.get<{ p: string }>("SELECT provider AS p FROM usage")!.p === "claude" && L.spent(d, NOW, "apiKey", "claude").usd === 1.5);
  L.recordUsage(d, { at: NOW.toISOString(), role: "analyst", mode: "apiKey", provider: "openai", costUsd: 0.25, ok: true }); L.recordUsage(d, { at: NOW.toISOString(), role: "analyst", mode: "subscription", provider: "openai", ok: true });
  const u = L.usageSummary(d, NOW);
  ok("usage by service: Claude and OpenAI are counted apart, the monthly API-key total and the ONE spend cap cover both", u.byService.claude.apiKey.usd === 1.5 && u.byService.openai.apiKey.usd === 0.25 && u.byService.openai.subscription.calls === 1 && u.thisMonth.apiKey.usd === 1.75 && u.cap.spentUsd === 1.75);
  const M = await import("../src/access/messages.ts");
  ok("usage lines: with OpenAI in use each service has its own lines (the plan is 'ChatGPT plan') and the limit line says it covers both; with only Claude the lines read as before", M.usageLines(u).join("|") === "Claude API key, this month: $1.50 (1 request)|OpenAI API key, this month: $0.25 (1 request)|ChatGPT plan, this month: 1 request (not billed per request)" && M.usageLines({ ...u, thisMonth: { ...u.thisMonth, subscription: { usd: 0, calls: 0 } }, byService: { ...u.byService, openai: { apiKey: { usd: 0, calls: 0 }, subscription: { usd: 0, calls: 0 } } } }).join("|") === "API key, this month: $1.75 (2 requests)");
  d.close();
}

// ---------- migration 4 ----------
{
  const d1 = openDb(":memory:"); migrate(d1, MIGRATIONS.slice(0, 3)); setSettings(d1, { tone: "concise" }, NOW); d1.run("INSERT INTO jobs(folder,status,source,created,updated) VALUES ('j','built','text','a','b')");
  const r = migrate(d1, MIGRATIONS, { beforeMigrate: () => undefined });
  const cols = d1.all<{ name: string }>("SELECT name FROM pragma_table_info('usage')").map((c) => c.name);
  ok("migration 4 on a version-3 database keeps everything and adds the usage table, which has no column that could hold text of an ad, a CV, a profile or a secret", r.from === 3 && getSettings(d1).settings.tone === "concise" && d1.all("SELECT * FROM jobs").length === 1 && cols.join() === "id,at,job,role,model,mode,input_tokens,output_tokens,cost_usd,ok,error_code,ms,provider" && !cols.some((c) => /text|prompt|secret|password|api_?key|cv_|ad_|profile|^name$/i.test(c)));
  ok("the database refuses a negative cost and an 'ok' flag that is not 0 or 1", (() => { let a = false, b = false; try { d1.run("INSERT INTO usage(at,role,cost_usd,ok) VALUES ('a','r',-1,1)"); } catch { a = true; } try { d1.run("INSERT INTO usage(at,role,cost_usd,ok) VALUES ('a','r',1,2)"); } catch { b = true; } return a && b; })());
  d1.close();
}

// ---------- recording ----------
{
  const db = db0();
  rec(db, NOW, 0.05); L.recordUsage(db, { at: NOW.toISOString(), role: "writer", costUsd: -5, inTokens: NaN, outTokens: 12.7, ok: false, errorCode: 3 }); L.recordUsage(db, { at: NOW.toISOString(), role: "x", costUsd: Number.NaN, ok: true });
  const rows = db.all<{ cost_usd: number; input_tokens: number; output_tokens: number; ok: number; error_code: number | null }>("SELECT * FROM usage ORDER BY id");
  ok("recording: failed calls are recorded too (ok 0 with their error code and cost 0); a negative or NaN cost becomes 0 and a bad token count becomes 0, never an error or a negative total", rows.length === 3 && rows[1].ok === 0 && rows[1].error_code === 3 && rows[1].cost_usd === 0 && rows[1].input_tokens === 0 && rows[1].output_tokens === 13 && rows[2].cost_usd === 0 && rows[0].ok === 1);
  db.close();
}

// ---------- the month and the totals ----------
{
  const db = db0();
  rec(db, L0(2026, 10, 31, 23), 100); rec(db, L0(2026, 11, 1, 0), 1.25); rec(db, L0(2026, 11, 17), 2.5); rec(db, L0(2026, 11, 30, 23), 0.25); rec(db, L0(2026, 12, 1, 0), 50); rec(db, L0(2026, 11, 17), 9, "subscription"); rec(db, L0(2026, 11, 17), 3, null);
  const s = L.spent(db, NOW);
  ok("'this month' is the calendar month of the Mac's own time zone: a call a minute before midnight at the month's end belongs to the old month, one at midnight to the new; the API-key total counts only API-key calls", s.usd === 4 && s.calls === 3 && L.spent(db, L0(2026, 10, 15)).usd === 100 && L.spent(db, L0(2026, 12, 15)).usd === 50);
  ok("the subscription calls are kept apart (their cost is an API-equivalent figure, not a bill) and calls with no mode are in neither total; the summary gives this month and all time per way of connecting", L.spent(db, NOW, "subscription").usd === 9 && (() => { const u = L.usageSummary(db, NOW); return u.thisMonth.apiKey.usd === 4 && u.thisMonth.subscription.usd === 9 && u.allTime.apiKey.usd === 154 && u.allTime.apiKey.calls === 5 && u.allTime.subscription.usd === 9; })());
  db.close();
}

// ---------- the cap ----------
{
  const db = db0(); rec(db, NOW, 9.99);
  ok("no cap set (the default): never reached, however much is spent", L.capStatus(db, NOW).capUsd === null && !L.capStatus(db, NOW).reached && L.capStatus(db, NOW).remainingUsd === null && L.capGate(db, NOW, "apiKey") === null);
  setSettings(db, { "spend.monthlyCapUsd": 10 }, NOW);
  const under = L.capStatus(db, NOW);
  ok("under the cap: not reached, the remaining amount is shown; the gate lets a call start", !under.reached && under.remainingUsd === 0.01 && L.capGate(db, NOW, "apiKey") === null);
  rec(db, NOW, 0.01); const at = L.capGate(db, NOW, "apiKey");
  ok("at the cap (spent equals the cap): reached, and the gate refuses with the PAUSE exit code and a plain reason (the amounts, no key, no text)", L.capStatus(db, NOW).reached && at !== null && at.code === EXIT.cap && /monthly spend cap of \$10\.00/.test(at.log) && PAUSABLE.includes(EXIT.cap));
  ok("only the API-key mode is stopped by the cap: a subscription call, or a call with no mode, is never refused", L.capGate(db, NOW, "subscription") === null && L.capGate(db, NOW, undefined) === null);
  setSettings(db, { "spend.monthlyCapUsd": 20 }, NOW);
  ok("raising the cap lifts the pause at once; next month starts at zero again", L.capGate(db, NOW, "apiKey") === null && !L.capStatus(db, L0(2026, 12, 2)).reached && L.capStatus(db, L0(2026, 12, 2)).spentUsd === 0);
  ok("the cap setting accepts nothing, or a positive amount; zero, negative, NaN, text and absurd values are refused; it is exported (a preference), unlike the connection mode", setSettings(db, { "spend.monthlyCapUsd": null }, NOW).ok && [0, -1, Number.NaN, 1e9, "10" as never, Infinity].every((v) => !setSettings(db, { "spend.monthlyCapUsd": v as number }, NOW).ok));
  db.close();
}

// ---------- the runner: records every started call, refuses before starting under the cap ----------
{
  const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-led-")), cfg = { models: { analyst: "model-a", writer: "m", checker: "m", coach: "m" }, agentTimeoutSeconds: 1, researchTimeoutSeconds: 1, maxAdChars: 30000 };
  const db = db0(); setSettings(db, { "spend.monthlyCapUsd": 1 }, NOW);
  let started = 0;
  const mkq = (kind: "ok" | "error" | "hang" | "throw", cost = 0.0123) => (a: { options: { cwd: string; abortController: AbortController } }) => (started++, (async function* () {
    yield { type: "system", subtype: "init", tools: ["StructuredOutput"], mcp_servers: [], plugins: [], skills: [], cwd: a.options.cwd, permissionMode: "default", apiKeySource: "ANTHROPIC_API_KEY" };
    if (kind === "hang") await new Promise((_, rej) => a.options.abortController.signal.addEventListener("abort", () => rej(new Error("aborted")))); // like the real SDK: an abort ends the stream
    if (kind === "throw") throw new Error("connection reset while talking to sk-ant-LEDGERCANARYKEY");
    if (kind === "error") { yield { type: "assistant", error: "authentication_failed" }; yield { type: "result", subtype: "success", is_error: true, api_error_status: 401, total_cost_usd: 0, modelUsage: {}, errors: [] }; throw new Error("Claude Code returned an error result: Invalid API key"); } // the REAL program throws after a failed result
    yield { type: "result", subtype: "success", is_error: false, structured_output: { x: 1 }, total_cost_usd: cost, modelUsage: { "model-a": { inputTokens: 1000, outputTokens: 200, cacheReadInputTokens: 300 } }, errors: [] };
  })());
  const job = () => { const j = mkdtempSync(path.join(root, "job-")); writeFileSync(path.join(j, "ad.md"), "An ad about marketing and a SECRETADTEXT canary. ".repeat(6)); return j; };
  const mkRunner = (q: unknown, key = "sk-ant-LEDGERCANARYKEY") => createSdkRunner({ profile: priya, tone: "friendly", config: cfg, skillsDir: path.join(dir, "..", "skills"), query: q as never, tmpRoot: root, env: { PATH: "/usr/bin" }, apiKey: key, now: () => NOW,
    beforeCall: () => L.capGate(db, NOW, "apiKey"), onUsage: (r) => L.recordUsage(db, r) });
  const okRes = await mkRunner(mkq("ok"))(job(), "analyst"), errRes = await mkRunner(mkq("error"))(job(), "analyst"), thrown = await mkRunner(mkq("throw"))(job(), "analyst"), hung = await mkRunner(mkq("hang"))(job(), "analyst");
  const rows = db.all<{ role: string; model: string; mode: string; input_tokens: number; output_tokens: number; cost_usd: number; ok: number; error_code: number | null; job: string }>("SELECT * FROM usage ORDER BY id");
  ok("the runner writes ONE ledger row per started call, whatever happened: the success (cost, input incl. cache reads, output, model, mode), the refused key (ok 0, auth code), the dropped connection and the timeout", okRes.code === EXIT.ok && rows.length === 4 && rows[0].cost_usd === 0.0123 && rows[0].input_tokens === 1300 && rows[0].output_tokens === 200 && rows[0].model === "model-a" && rows[0].mode === "apiKey" && rows[0].ok === 1 && rows[1].ok === 0 && rows[1].error_code === EXIT.auth && rows[2].ok === 0 && rows[3].ok === 0 && rows[3].error_code === EXIT.timeout && errRes.code === EXIT.auth && thrown.code !== EXIT.ok && hung.code === EXIT.timeout);
  ok("the ledger rows hold only numbers and names: no ad text, no key, no error text, whatever the call printed", !JSON.stringify(rows).includes("SECRETADT") && !JSON.stringify(rows).includes("CANARY") && !JSON.stringify(rows).includes("reset"));
  rec(db, NOW, 1); const before = started;
  const capped = await mkRunner(mkq("ok"))(job(), "analyst"), nowRows = db.all("SELECT * FROM usage").length;
  ok("at the cap the call is NOT STARTED (the query function is never called), the result is the pause code with the reason, and nothing is added to the ledger for a call that did not happen", capped.code === EXIT.cap && started === before && /monthly spend cap/.test(capped.log) && nowRows === 5);
  // a pipeline job paused by the cap, then resumed after the cap is raised
  const jobsDir = path.join(root, "pjobs"); mkdirSync(jobsDir);
  const analysis = { company: "Acme Retail", role: "Marketing Executive", location: "Leeds", work_mode: "hybrid", salary_text: null, salary_min_gbp: null, seniority: "mid", years_required: 2, experience: { years: 8, basis: "d" }, requirements: [{ text: "r", priority: "must", rating: "strong", evidence_quote: ctx.bullets[1].text.slice(0, 60), note: "" }], constraint_checks: [], focus_id: 1, focus_note: "", fit_percent: 70, fit_note: "", verdict: "apply", strengths: [], gaps: [], unverified_needed: [], injection_suspected: false, summary: "" };
  const gated = async (d: string, r: string) => { const g = L.capGate(db, NOW, "apiKey"); if (g) return g; writeFileSync(path.join(d, r === "analyst" ? "analysis.json" : "coach-verdict.json"), JSON.stringify(r === "analyst" ? analysis : { message: "ok" })); return { code: 0, log: "" }; };
  const pl = PL.createPipeline({ jobsDir, profile: priya, runnerFor: () => gated as never, renderer: {} as never, fonts: {} as never, config: { accent: "oxford", showRightToWork: true, resumeProfile: "snapshot" }, now: () => NOW });
  const j = await pl.createJob("An ad about marketing. ".repeat(10), "text"); let err: any = null; try { await pl.analyse(j); } catch (e) { err = e; }
  ok("a job whose call is refused by the cap PAUSES (not fails): kind 'cap', resumable, with a plain note about the spend limit and nothing lost", err?.kind === "cap" && err.pausable && err.job?.status === "paused" && /monthly spend limit/.test(err.job.note) && err.job.resumeAt === "analyse");
  setSettings(db, { "spend.monthlyCapUsd": 50 }, NOW); const moved = (await pl.listJobs())[0], res = await pl.resume(moved);
  ok("after the user raises the cap, Resume finishes the job (nothing was run twice)", res.job.status === "analysed");
  db.close(); rmSync(root, { recursive: true, force: true });
}

// ---------- Test connection and key validation ----------
{
  const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-tc-")), db = db0();
  let calls = 0, lastOptions: any = null;
  const mkq = (o: { source?: string; kind?: "ok" | "badkey" | "model" | "server" | "limit"; cost?: number } = {}) => (a: { options: any }) => (calls++, lastOptions = a.options, (async function* () {
    yield { type: "system", subtype: "init", tools: ["StructuredOutput"], mcp_servers: [], plugins: [], skills: [], cwd: a.options.cwd, permissionMode: "default", apiKeySource: o.source ?? "ANTHROPIC_API_KEY" };
    const k = o.kind ?? "ok";
    if (k === "ok") yield { type: "result", subtype: "success", is_error: false, structured_output: { message: "ok" }, total_cost_usd: o.cost ?? 0.0004, modelUsage: {}, errors: [] };
    else { const err = { badkey: "authentication_failed", model: "model_not_found", server: "server_error", limit: "rate_limit" }[k]; const text = { badkey: "Invalid API key · Fix external API key", model: "There's an issue with the selected model", server: "Internal error", limit: "limit reached" }[k]; yield { type: "assistant", error: err }; yield { type: "result", subtype: "success", is_error: true, api_error_status: { badkey: 401, model: 404, server: 500, limit: 429 }[k], result: text, total_cost_usd: 0, modelUsage: {}, errors: [] }; throw new Error("Claude Code returned an error result: " + text); } // the REAL program throws after a failed result
  })());
  const base = { env: { PATH: "/usr/bin" }, db, now: () => NOW, tmpRoot: root };
  const good = await C.testConnection({ ...base, query: mkq() as never, mode: "apiKey", apiKey: "sk-ant-TESTCANARYKEY-0000000000" });
  ok("Test connection: one tiny call on the cheapest model with the isolated options (no tools, no MCP); on success it returns the cost and time and writes ONE ledger row (mode apiKey)", good.ok && calls === 1 && lastOptions.model === C.VALIDATION_MODEL && lastOptions.tools.length === 0 && Object.keys(lastOptions.mcpServers).length === 0 && db.all("SELECT * FROM usage WHERE role='test' AND mode='apiKey' AND ok=1").length === 1);
  const bad = await C.testConnection({ ...base, query: mkq({ kind: "badkey" }) as never, mode: "apiKey", apiKey: "sk-ant-WRONGKEY-0000000000000" });
  ok("a refused key is an ACCESS failure with the state key_invalid (from the real 3a shapes) and a failed row in the ledger", !bad.ok && bad.kind === "access" && bad.state?.kind === "key_invalid" && db.all("SELECT * FROM usage WHERE role='test' AND ok=0").length === 1);
  const lim = await C.testConnection({ ...base, query: mkq({ kind: "limit" }) as never, mode: "apiKey", apiKey: "sk-ant-LIMITKEY-000000000000" }), srv = await C.testConnection({ ...base, query: mkq({ kind: "server" }) as never, mode: "apiKey", apiKey: "sk-ant-SERVERKEY-00000000000" }), mdl = await C.testConnection({ ...base, query: mkq({ kind: "model" }) as never, mode: "apiKey", apiKey: "sk-ant-MODELKEY-0000000000000" });
  ok("a usage limit is 'access/limited'; an outage is 'unreachable' (NOT an access problem, so the key is not blamed); a missing model is 'other'", !lim.ok && lim.state?.kind === "limited" && !srv.ok && srv.kind === "unreachable" && !srv.state && !mdl.ok && mdl.kind === "other" && !mdl.state);
  const c0 = calls, noKey = await C.testConnection({ ...base, query: mkq() as never, mode: "apiKey" }), sub = await C.testConnection({ ...base, query: mkq({ source: "none" }) as never, mode: "subscription", apiKey: "sk-ant-X-0000000000000000000" });
  ok("the preflight applies: key mode without a key, or subscription mode with a key, is refused with the query function never called", !noKey.ok && noKey.kind === "not_started" && !sub.ok && sub.kind === "not_started" && calls === c0);
  const mm = await C.testConnection({ ...base, query: mkq({ source: "none" }) as never, mode: "apiKey", apiKey: "sk-ant-MISMATCH-00000000000" });
  ok("the mode check applies at the first message: a key test whose session says it used the subscription is reported as mode_mismatch, not as a success", !mm.ok && mm.kind === "mismatch".replace("mismatch", "mode_mismatch"));
  const subOk = await C.testConnection({ ...base, query: mkq({ source: "none" }) as never, mode: "subscription" });
  ok("a subscription test needs no key and works when the session says 'none'", subOk.ok);
  setSettings(db, { "spend.monthlyCapUsd": 0.0001 }, NOW); const c1 = calls; const capped = await C.testConnection({ ...base, query: mkq() as never, mode: "apiKey", apiKey: "sk-ant-CAPPEDKEY-00000000000" });
  ok("a test is also stopped by the monthly cap (kind 'cap', no call made)", !capped.ok && capped.kind === "cap" && calls === c1);
  setSettings(db, { "spend.monthlyCapUsd": null }, NOW);
  // key validation: a key is proven BEFORE it is saved
  const secrets = new MemorySecretStore(), acc = createAccess({ db, secrets, now: () => NOW, run: async () => ({ code: 0, stdout: "{}", timedOut: false, failedToStart: false }) });
  const cdeps = (q: unknown) => ({ ...base, query: q as never, access: acc });
  const junk = await Promise.all(["", "short", "has a space in the middle of the key 0000", "x".repeat(501), "line\nbreak-0000000000000000"].map((k) => C.connectWithKey(k, cdeps(mkq()))));
  ok("a key that is obviously not a key (empty, short, with spaces or a line break, over-long) is refused before any call", junk.every((r) => !r.ok && r.kind === "malformed") && (await secrets.get(SECRET_NAMES.claudeApiKey)) === null);
  const c2 = calls, refused = await C.connectWithKey("sk-ant-REFUSEDKEY-0000000000000", cdeps(mkq({ kind: "badkey" })));
  ok("a refused key is NOT saved, the mode is not changed, and no error is remembered for a key that never existed", !refused.ok && refused.kind === "access" && calls === c2 + 1 && (await secrets.get(SECRET_NAMES.claudeApiKey)) === null && getSettings(db).settings["claude.mode"] === null && acc.lastError() === null);
  const down = await C.connectWithKey("sk-ant-OUTAGEKEY-00000000000000", cdeps(mkq({ kind: "server" })));
  ok("during an outage the key cannot be proven, so it is not saved (and the answer says 'unreachable', not 'invalid')", !down.ok && down.kind === "unreachable" && (await secrets.get(SECRET_NAMES.claudeApiKey)) === null);
  acc.chooseMode("subscription"); acc.acceptNotice(); acc.recordError({ type: "authentication_failed", message: "Not logged in" });
  const saved = await C.connectWithKey("  sk-ant-GOODKEY-LEDGERCANARY-0000  ", cdeps(mkq()));
  ok("a proven key is saved (trimmed) in the secret store ONLY, the mode becomes API key, the old subscription error is forgotten, and the state is key_saved", saved.ok && (await secrets.get(SECRET_NAMES.claudeApiKey)) === "sk-ant-GOODKEY-LEDGERCANARY-0000" && getSettings(db).settings["claude.mode"] === "apiKey" && (await acc.state()).kind === "key_saved");
  ok("no key appears in any result, in the ledger or in the settings; the database holds none of them", !JSON.stringify([good, bad, lim, srv, mdl, noKey, sub, mm, capped, junk, refused, down, saved]).match(/CANARY|WRONGKEY|REFUSEDKEY|GOODKEY/) && !JSON.stringify(db.all("SELECT * FROM usage")).includes("sk-ant") && !JSON.stringify(db.all("SELECT * FROM settings")).includes("sk-ant"));
  db.close(); rmSync(root, { recursive: true, force: true });
}

// ---------- the ledger survives deleting jobs and importing; it is not exported or backed up; delete-everything removes it ----------
{
  const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-lsv-")), dataDir = path.join(root, "x", "CVApp");
  const o = await openStore(dataDir, { now: NOW }); if (o.status !== "ok") throw new Error("setup"); const db = o.db, jobsDir = path.join(dataDir, JOBS_DIR); mkdirSync(jobsDir);
  saveProfile(db, priya, NOW); const jd = path.join(jobsDir, "job-1"); mkdirSync(jd); await PL.saveStateFile({ id: "i1", dir: jd, status: "built", created: NOW.toISOString(), updated: NOW.toISOString(), source: "text", company: "C" } as never, NOW);
  rec(db, NOW, 2.5, "apiKey", { job: "job-1" }); rec(db, NOW, 1, "subscription");
  const del = await D.deleteJobsAndCvs(db, jobsDir, { confirmed: true, tmpDir: path.join(root, "t") });
  ok("'Delete jobs and CVs' leaves the usage total alone (it is the user's spending record, not job data): the totals are unchanged", del.ok && L.spent(db, NOW).usd === 2.5 && L.spent(db, NOW, "subscription").usd === 1);
  const zip = path.join(root, "e.zip"), ex = await X.exportAll(db, jobsDir, zip, { now: NOW });
  const { unzipSync, strFromU8 } = await import("fflate"); const z = unzipSync(new Uint8Array(readFileSync(zip)));
  ok("the export carries no usage figures; the spend cap is exported as a preference", ex.ok && !Object.values(z).some((b) => /usage|cost_usd/i.test(strFromU8(b).slice(0, 5000))) && (setSettings(db, { "spend.monthlyCapUsd": 25 }, NOW), true));
  const ex2 = await X.exportAll(db, jobsDir, path.join(root, "e2.zip"), { now: NOW }), z2 = unzipSync(new Uint8Array(readFileSync(path.join(root, "e2.zip"))));
  ok("(cap in the export) settings.json holds spend.monthlyCapUsd but no claude.* entry", ex2.ok && JSON.parse(strFromU8(z2["settings.json"]))["spend.monthlyCapUsd"] === 25 && !/claude\./.test(strFromU8(z2["settings.json"])));
  const imp = await X.importExport({ zipFile: zip, db, jobsDir, backupsDir: path.join(dataDir, BACKUPS_DIR), now: NOW, confirmReplace: true });
  ok("importing an export does not reset or alter the usage total", imp.ok && L.spent(db, NOW).usd === 2.5);
  const { listBackups } = await import("../src/store/backup.ts"); const bl = await listBackups(path.join(dataDir, BACKUPS_DIR));
  ok("backups carry the profile and settings only, never the usage ledger", bl.length >= 1 && !readdirSync(path.join(dataDir, BACKUPS_DIR)).some((f) => /usage|cost_usd/.test(readFileSync(path.join(dataDir, BACKUPS_DIR, f), "utf8"))));
  const all = await D.deleteEverything({ dataDir, db, secrets: new MemorySecretStore(), confirmed: true, tmpDir: path.join(root, "t") });
  ok("'Delete everything' removes the database and with it the whole ledger", all.ok && !existsSync(dataDir));
  rmSync(root, { recursive: true, force: true });
}
console.log(failures === 0 ? "\nall ledger tests passed" : `\n${failures} ledger test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
