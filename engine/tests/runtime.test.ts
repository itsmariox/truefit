// Phase 3g: pause, reconnect and resume, as whole stories through the REAL pipeline, the REAL runner and the access runtime, on a fake Claude, a fake login status and a fake clock.
// Each story checks the three promises: nothing starts without a connection (it PAUSES), the watcher only says "you can resume" when that is really known, and nothing ever resumes by itself.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { openDb } = await import("../src/store/db.ts");
const { migrate } = await import("../src/store/migrate.ts");
const { MIGRATIONS } = await import("../src/store/schema.ts");
const { setSettings } = await import("../src/store/settings-store.ts");
const { MemorySecretStore, SECRET_NAMES } = await import("../src/store/secrets.ts");
const { createAccessRuntime } = await import("../src/access/runtime.ts");
const { parseResetsAt } = await import("../src/access/watch.ts");
const { recordUsage } = await import("../src/access/ledger.ts");
const { formatWhen } = await import("../src/access/messages.ts");
const { testConnection } = await import("../src/access/connect.ts");
const { EXIT } = await import("../src/agents/errors.ts");
const PL = await import("../src/pipeline.ts");
const { profileToPersona } = await import("../src/profile.ts");
type WE = import("../src/access/watch.ts").WatchEvent;
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const priya = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8")), ctx = profileToPersona(priya, new Date());
const T0 = new Date(2026, 10, 17, 10, 0, 0).getTime();
const analysis = { company: "Acme Retail", role: "Marketing Executive", location: "Leeds", work_mode: "hybrid", salary_text: null, salary_min_gbp: null, seniority: "mid", years_required: 2, experience: { years: 8, basis: "d" }, requirements: [{ text: "r", priority: "must", rating: "strong", evidence_quote: ctx.bullets[1].text.slice(0, 60), note: "" }], constraint_checks: [], focus_id: 1, focus_note: "", fit_percent: 70, fit_note: "", verdict: "apply", strengths: [], gaps: [], unverified_needed: [], injection_suspected: false, summary: "" };

class FakeTimers { t = 0; q: { id: number; at: number; fn: () => void }[] = []; n = 0;
  setTimeout(fn: () => void, ms: number) { const id = ++this.n; this.q.push({ id, at: this.t + ms, fn }); return id; }
  clearTimeout(h: unknown) { this.q = this.q.filter((x) => x.id !== h); }
  async advance(ms: number) { const target = this.t + ms; for (;;) { const due = this.q.filter((x) => x.at <= target).sort((a, b) => a.at - b.at)[0]; if (!due) break; this.q = this.q.filter((x) => x !== due); this.t = due.at; due.fn(); for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r)); } this.t = target; for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); }
}
type Outcome = "ok" | "auth" | "server" | "badkey" | { limit: number | null };
async function rig(o: { mode: "subscription" | "apiKey" | null; notice?: boolean; key?: string; status?: object; script?: (call: number, role: string) => Outcome; cap?: number | null }) {
  const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-rt-")), db = openDb(":memory:"); migrate(db, MIGRATIONS); const secrets = new MemorySecretStore(), ft = new FakeTimers();
  const clock = () => new Date(T0 + ft.t);
  const st = { out: o.status ?? { loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro", loginExpiresAt: new Date(T0 + 30 * 86400_000).toISOString() } as object };
  const calls: { role: string; env: Record<string, string>; model: string }[] = []; let source = (m: "subscription" | "apiKey" | null) => (m === "apiKey" ? "ANTHROPIC_API_KEY" : "none"); const state = { forceSource: null as string | null };
  const query = (a: { options: any }) => { const system = String(a.options.systemPrompt), role = /# Fit analysis/.test(system) ? "analyst" : "coach", idx = calls.length; calls.push({ role, env: a.options.env, model: a.options.model });
    const out = o.script?.(idx, role) ?? "ok", mode = a.options.env.ANTHROPIC_API_KEY ? "apiKey" : "subscription";
    return (async function* () {
      yield { type: "system", subtype: "init", tools: ["StructuredOutput"], mcp_servers: [], plugins: [], skills: [], cwd: a.options.cwd, permissionMode: "default", apiKeySource: state.forceSource ?? source(mode) };
      if (out === "ok") { yield { type: "result", subtype: "success", is_error: false, structured_output: role === "analyst" ? analysis : { message: "ok" }, total_cost_usd: 0.02, modelUsage: { m: { inputTokens: 100, outputTokens: 20 } }, errors: [] }; return; }
      if (typeof out === "object") { if (out.limit) yield { type: "rate_limit_event", rate_limit_info: { resetsAt: Math.round((T0 + ft.t + out.limit * 60_000) / 1000), status: "rejected" } }; yield { type: "assistant", error: "rate_limit" }; yield { type: "result", subtype: "success", is_error: true, api_error_status: 429, result: "limit reached", total_cost_usd: 0, modelUsage: {}, errors: [] }; throw new Error("Claude Code returned an error result: limit reached"); }
      const e = { auth: ["authentication_failed", null, "Not logged in · Please run /login"], badkey: ["authentication_failed", 401, "Invalid API key · Fix external API key"], server: ["server_error", 500, "Internal error"] }[out] as [string, number | null, string];
      yield { type: "assistant", error: e[0] }; yield { type: "result", subtype: "success", is_error: true, api_error_status: e[1], result: e[2], total_cost_usd: 0, modelUsage: {}, errors: [] };
      throw new Error("Claude Code returned an error result: " + e[2]); // the REAL program does this (seen live in 3a and 3h): the failed result comes first, then it throws
    })(); };
  const cfg = { models: { analyst: "m", writer: "m", checker: "m", coach: "m" }, agentTimeoutSeconds: 5, researchTimeoutSeconds: 5, maxAdChars: 30000 };
  const rt = createAccessRuntime({ db, secrets, statusRunner: async () => ({ code: 0, stdout: JSON.stringify(st.out), timedOut: false, failedToStart: false }), query: query as never, now: clock, timers: ft,
    base: { tone: "friendly", config: cfg, skillsDir: path.join(dir, "..", "skills"), tmpRoot: root, env: { PATH: "/usr/bin" }, now: clock } });
  if (o.mode) setSettings(db, { "claude.mode": o.mode }, clock()); if (o.notice !== false && o.mode === "subscription") rt.access.acceptNotice(); if (o.key) await secrets.set(SECRET_NAMES.claudeApiKey, o.key); if (o.cap !== undefined) setSettings(db, { "spend.monthlyCapUsd": o.cap }, clock());
  const jobsDir = path.join(root, "jobs"); mkdirSync(jobsDir);
  const pl = PL.createPipeline({ jobsDir, profile: priya, runnerFor: rt.runnerFor, renderer: {} as never, fonts: {} as never, config: { accent: "oxford", showRightToWork: true, resumeProfile: "snapshot" }, now: clock });
  const analyse = async () => { const j = await pl.createJob("An ad about marketing. ".repeat(10), "text"); try { const r = await pl.analyse(j); return { job: r.job, err: null as any }; } catch (e: any) { return { job: e.job ?? j, err: e }; } };
  const resume = async () => { const j = (await pl.listJobs())[0]; try { const r = await pl.resume(j); return { job: r.job, err: null as any }; } catch (e: any) { return { job: e.job ?? j, err: e }; } };
  const rows = () => db.all<{ role: string; ok: number; error_code: number | null; mode: string; cost_usd: number }>("SELECT role, ok, error_code, mode, cost_usd FROM usage ORDER BY id");
  return { root, db, secrets, ft, st, calls, rt, pl, analyse, resume, rows, state, clock, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const settle = async (ft: FakeTimers) => { for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r)); void ft; };

// ---------- S1: the sign-in ran out; the user signs in again; the watcher notices; the user presses Resume ----------
{
  const r = await rig({ mode: "subscription", status: { loggedIn: false, authMethod: "none" }, script: (i) => (i === 0 ? "auth" : "ok") });
  const first = await r.analyse();
  ok("S1 a call that says 'not logged in' PAUSES the job (kind auth, resumable, nothing lost) with the catalogue's plain note, not a failure; the call is in the ledger as a failed call (auth code)", first.err?.kind === "auth" && first.err.pausable && first.job.status === "paused" && first.job.note === "Claude needs you to sign in again." && r.rows().length === 1 && r.rows()[0].ok === 0 && r.rows()[0].error_code === EXIT.auth);
  ok("S1 the access state now reads 'expired' (Reconnect), and the message for the paused job offers Reconnect and Resume", (await r.rt.access.state()).kind === "expired" && r.rt.describePause("auth").actions.join() === "reconnect,resume");
  const events: WE[] = [], w = await r.rt.watchPause("auth", (e) => events.push(e), { screenOpen: true })!;
  await r.ft.advance(10_000);
  ok("S1 while the user has not signed in, the watcher only waits: no 'recovered', and not one extra call is made to Claude (nothing resumes by itself)", events.every((e) => e.type === "waiting") && events.length >= 2 && r.calls.length === 1);
  r.st.out = { loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro", loginExpiresAt: new Date(T0 + 30 * 86400_000).toISOString() };
  await r.ft.advance(5_000);
  ok("S1 after the user signs in (the free status check changes from signed out to signed in) the watcher says 'recovered' ONCE, clears the remembered error (state connected), and STILL has made no call: the job is still paused", events.filter((e) => e.type === "recovered").length === 1 && (await r.rt.access.state()).kind === "connected" && r.calls.length === 1 && (await r.pl.listJobs())[0].status === "paused");
  await r.ft.advance(120_000); const n = events.length;
  ok("S1 once recovered the watcher stops: no more events, no more checks", events.length === n && events[events.length - 1].type === "recovered");
  const second = await r.resume();
  ok("S1 only when the USER presses Resume does the job continue: it finishes (analysed), re-running only the step that failed; the ledger now holds the failed call and the successful ones; the remembered error is gone", second.job.status === "analysed" && r.calls.length === 3 && r.rows().length === 3 && r.rows().filter((x) => x.ok === 1).length === 2 && r.rt.access.lastError() === null);
  w.stop(); r.cleanup();
}

// ---------- S2: login revoked elsewhere, the free check still says 'signed in' ----------
{
  const r = await rig({ mode: "subscription", script: (i) => (i === 0 ? "auth" : "ok") });
  await r.analyse(); const events: WE[] = [], w = await r.rt.watchPause("auth", (e) => events.push(e), { screenOpen: true })!;
  await r.ft.advance(30_000);
  ok("S2 a login revoked elsewhere (the free check keeps saying signed in) is NEVER reported as recovered on a guess: it keeps waiting", events.every((e) => e.type === "waiting") && (await r.rt.access.state()).kind === "expired");
  const t = await testConnection({ query: ((a: any) => (async function* () { yield { type: "system", subtype: "init", tools: ["StructuredOutput"], mcp_servers: [], plugins: [], skills: [], cwd: a.options.cwd, permissionMode: "default", apiKeySource: "none" }; yield { type: "result", subtype: "success", is_error: false, structured_output: { message: "ok" }, total_cost_usd: 0.001, modelUsage: {}, errors: [] }; })()) as never, mode: "subscription", env: { PATH: "/usr/bin" }, now: r.clock, tmpRoot: r.root });
  if (t.ok) r.rt.access.recordSuccess(); await w.recheck();
  ok("S2 the user presses Test connection: when it works the remembered error is cleared and the watcher says 'recovered'", t.ok && events.some((e) => e.type === "recovered") && (await r.rt.access.state()).kind === "connected");
  w.stop(); r.cleanup();
}

// ---------- S3: a usage limit with a reset time ----------
{
  const r = await rig({ mode: "subscription", script: (i) => (i === 0 ? { limit: 30 } : "ok") });
  const first = await r.analyse(), st = (await r.rt.access.state()) as { kind: string; resetsAt: string };
  const msg = r.rt.describePause("rate_limit");
  ok("S3 a usage limit pauses the job (kind rate_limit); the reset time from the rate-limit message is kept (30 minutes from now), shown to the user in plain words ('resets today at 10:30 am'), and the state is 'limited'", first.err?.kind === "rate_limit" && first.job.status === "paused" && st.kind === "limited" && Date.parse(st.resetsAt) === T0 + 30 * 60_000 + 0 && msg.body.includes(`resets ${formatWhen(new Date(T0 + 30 * 60_000), new Date(T0))}`) && /10:30 am/.test(msg.body));
  const events: WE[] = [], w = await r.rt.watchPause("rate_limit", (e) => events.push(e))!;
  await r.ft.advance(29 * 60_000);
  ok("S3 before the reset time the watcher does not poll or guess: just one 'waiting' with the time of the next look", events.length === 1 && events[0].type === "waiting" && Date.parse((events[0] as { nextCheckAt: string }).nextCheckAt) >= T0 + 30 * 60_000 && r.calls.length === 1);
  await r.ft.advance(2 * 60_000);
  ok("S3 after the reset time it says 'recovered' (the limit has lapsed, the state is usable again), still with no call made", events.some((e) => e.type === "recovered") && (await r.rt.access.state()).kind === "connected" && r.calls.length === 1);
  const second = await r.resume();
  ok("S3 Resume (pressed by the user) finishes the job", second.job.status === "analysed");
  w.stop(); r.cleanup();
  const r2 = await rig({ mode: "subscription", script: (i) => (i === 0 ? { limit: null } : "ok") }); await r2.analyse(); const ev2: WE[] = [], w2 = await r2.rt.watchPause("rate_limit", (e) => ev2.push(e))!;
  await r2.ft.advance(14 * 60_000); const early = ev2.some((e) => e.type === "recovered"); await r2.ft.advance(3 * 60_000);
  ok("S3 a limit with NO known reset time is forgotten after 15 minutes (so the app is never stuck on it): not recovered at 14, recovered after", !early && ev2.some((e) => e.type === "recovered"));
  w2.stop(); r2.cleanup();
}

// ---------- S4: the monthly spend cap ----------
{
  const r = await rig({ mode: "apiKey", key: "sk-ant-RUNTIMEKEY-0000000000000", cap: 1 });
  recordUsage(r.db, { at: r.clock().toISOString(), role: "writer", mode: "apiKey", costUsd: 1.05, ok: true });
  const first = await r.analyse();
  ok("S4 at the cap the job PAUSES before any call is made (the fake Claude was never reached), with the spend-limit note and the amounts ('$1.05 of your $1.00') in the message", first.err?.kind === "cap" && first.job.status === "paused" && r.calls.length === 0 && r.rt.describePause("cap").body.includes("$1.05 of your $1.00") && r.rows().length === 1);
  const events: WE[] = [], w = await r.rt.watchPause("cap", (e) => events.push(e))!;
  setSettings(r.db, { "spend.monthlyCapUsd": 50 }, r.clock()); await w.recheck();
  ok("S4 the user raises the cap: the watcher (asked to look again) says 'recovered'; nothing has run", events.some((e) => e.type === "recovered") && r.calls.length === 0);
  const second = await r.resume();
  ok("S4 Resume finishes the job, using the saved API key (the call's environment carries it) and recording the calls against the API key in the ledger", second.job.status === "analysed" && r.calls.length === 2 && r.calls.every((c) => c.env.ANTHROPIC_API_KEY === "sk-ant-RUNTIMEKEY-0000000000000") && r.rows().filter((x) => x.mode === "apiKey" && x.ok === 1).length === 3);
  w.stop(); r.cleanup();
  const r2 = await rig({ mode: "apiKey", key: "sk-ant-RUNTIMEKEY-0000000000000", cap: 1 }); recordUsage(r2.db, { at: r2.clock().toISOString(), role: "w", mode: "apiKey", costUsd: 2, ok: true }); await r2.analyse();
  const ev2: WE[] = [], w2 = await r2.rt.watchPause("cap", (e) => ev2.push(e))!; await r2.ft.advance(20 * 86400_000);
  ok("S4 a cap that is never raised is lifted by the new month (the poll notices it): 'recovered' only after the month ends", ev2.some((e) => e.type === "recovered") && ev2.filter((e) => e.type === "waiting").length >= 2);
  w2.stop(); r2.cleanup();
}

// ---------- S5: an outage ----------
{
  const r = await rig({ mode: "subscription", script: (i) => (i === 0 ? "server" : "ok") });
  const first = await r.analyse();
  ok("S5 an outage pauses the job (kind unavailable) but does NOT touch the access state: the sign-in is still 'connected' (an outage is not blamed on the login or the key)", first.err?.kind === "unavailable" && first.job.status === "paused" && (await r.rt.access.state()).kind === "connected" && r.rt.access.lastError() === null && r.rows()[0].ok === 0);
  const events: WE[] = [], w = await r.rt.watchPause("unavailable", (e) => events.push(e))!; await r.ft.advance(59_000);
  ok("S5 an outage cannot be seen ending without a network call, so after a minute the watcher says 'you can try again' (can_try), NOT 'recovered', and does not retry by itself", !events.some((e) => e.type === "can_try") && (await r.ft.advance(2_000), events.some((e) => e.type === "can_try") && !events.some((e) => e.type === "recovered") && r.calls.length === 1));
  const second = await r.resume(); ok("S5 pressing Resume finishes the job", second.job.status === "analysed");
  w.stop(); r.cleanup();
}

// ---------- S6: nothing is connected yet: always a PAUSE with the sign-in message ----------
{
  const cases: [string, Parameters<typeof rig>[0], ((r: Awaited<ReturnType<typeof rig>>) => void) | null][] = [
    ["no way to connect chosen", { mode: null }, null], ["subscription chosen, notice not accepted", { mode: "subscription", notice: false }, null], ["API key chosen, no key saved", { mode: "apiKey" }, null],
    ["API key chosen, the saved key cannot be read", { mode: "apiKey", key: "sk-ant-x-0000000000000000000" }, (r) => { r.secrets.get = async () => { throw new Error("keychain locked"); }; }],
  ];
  for (const [name, opts, tweak] of cases) {
    const r = await rig(opts); tweak?.(r); const res = await r.analyse();
    ok(`S6 ${name}: the job PAUSES (kind auth, resumable) with the sign-in message, Claude is never called, nothing is recorded in the ledger`, res.err?.kind === "auth" && res.err.pausable && res.job.status === "paused" && r.calls.length === 0 && r.rows().length === 0 && /call not started/.test(res.err.message));
    r.cleanup();
  }
}

// ---------- S7: the way to connect is read at EVERY call ----------
{
  const r = await rig({ mode: "subscription", script: (i) => (i === 0 ? "auth" : "ok") });
  await r.analyse(); const j0 = (await r.pl.listJobs())[0];
  setSettings(r.db, { "claude.mode": "apiKey" }, r.clock()); await r.rt.access.saveApiKey("sk-ant-SWITCHEDKEY-000000000000"); const res = await r.resume();
  ok("S7 the user switches to an API key while a job is paused: the next call uses the key (and the old 'expired' error is gone), the first call never had one", res.job.status === "analysed" && r.calls[0].env.ANTHROPIC_API_KEY === undefined && r.calls[1].env.ANTHROPIC_API_KEY === "sk-ant-SWITCHEDKEY-000000000000" && j0.status === "paused");
  r.cleanup();
}

// ---------- S8: a call that used the wrong credential, and errors that are not about access ----------
{
  const r = await rig({ mode: "apiKey", key: "sk-ant-MISMATCHKEY-00000000000" }); r.state.forceSource = "none";
  const res = await r.analyse();
  ok("S8 a key call whose session says it used the subscription is stopped (a FAILED job, not a pause: this is not something Resume fixes), and no access error is remembered for it", res.job.status === "failed" && r.rt.access.lastError() === null && r.rows().length === 1 && r.rows()[0].error_code === EXIT.isolation);
  r.cleanup();
  const r2 = await rig({ mode: "apiKey", key: "sk-ant-BADKEY-0000000000000000", script: () => "badkey" }); const res2 = await r2.analyse();
  ok("S8 a key the service refuses pauses the job and the state becomes key_invalid; saving a different key clears it", res2.err?.kind === "auth" && (await r2.rt.access.state()).kind === "key_invalid" && /API key/.test(r2.rt.describePause("auth").title) && !/sign in/i.test(r2.rt.describePause("auth").body) && (await r2.rt.access.saveApiKey("sk-ant-NEWKEY-00000000000000"), (await r2.rt.access.state()).kind === "key_saved"));
  r2.cleanup();
}

// ---------- the watcher can never resume anything; reset-time reading; timers ----------
{
  const src = readFileSync(path.join(dir, "..", "src", "access", "watch.ts"), "utf8");
  ok("the watcher cannot resume a job: its code never imports or mentions the pipeline, a job or a runner (only events come out)", !/pipeline|resume\(|\.analyse|\.build|createSdkRunner|import .*runner/i.test(src.replace(/\/\/.*$/gm, "")));
  const iso = "2026-11-17T12:30:00.000Z", sec = Date.parse(iso) / 1000;
  ok("reset-time reading: an ISO string, epoch seconds, epoch milliseconds, a numeric string, and several field names are all read; nothing else (text, 0, negative, year 1970 or 3000, missing, not an object) is guessed", parseResetsAt({ resetsAt: iso }) === iso && parseResetsAt({ resets_at: sec }) === iso && parseResetsAt({ resetAt: sec * 1000 }) === iso && parseResetsAt({ reset_at: String(sec) }) === iso && [null, undefined, "x", 5, {}, { resetsAt: "soon" }, { resetsAt: 0 }, { resetsAt: -5 }, { resetsAt: 5 }, { resetsAt: 32503680000 * 1000 }, { resetsAt: {} }, { reset: "" }].every((x) => parseResetsAt(x) === null));
  const r = await rig({ mode: "subscription", status: { loggedIn: false, authMethod: "none" }, script: (i) => (i === 0 ? "auth" : "ok") }); await r.analyse();
  const slowEv: WE[] = [], fastEv: WE[] = [], ws = await r.rt.watchPause("auth", (e) => slowEv.push(e), { screenOpen: false })!, wf = await r.rt.watchPause("auth", (e) => fastEv.push(e), { screenOpen: true })!;
  const gap = (ev: WE[]) => { const w = ev.find((e) => e.type === "waiting") as { nextCheckAt: string }; return Date.parse(w.nextCheckAt) - T0; };
  ok("while the sign-in screen is open the watcher looks every 3 seconds, otherwise every 60 seconds (and the screen can tell it when it opens)", gap(fastEv) === 3000 && gap(slowEv) === 60_000);
  ws.setScreenOpen(true); await r.ft.advance(60_000); const sw = slowEv.filter((e) => e.type === "waiting").map((e) => Date.parse((e as { nextCheckAt: string }).nextCheckAt) - T0);
  ok("after setScreenOpen(true) the slow watcher switches to the fast rhythm at its next look", sw.length >= 2 && sw[1] - 60_000 === 3000);
  ws.stop(); wf.stop(); const before = fastEv.length + slowEv.length; await r.ft.advance(300_000);
  ok("a stopped watcher makes no further checks and sends no further events", fastEv.length + slowEv.length === before && r.ft.q.length === 0);
  r.cleanup();
  const rr = await rig({ mode: "subscription" }); await rr.analyse();
  ok("kinds that cannot be watched (setup, isolation, other) give no watcher; a failing handler in the screen never breaks the watcher", rr.rt.watchPause("setup", () => undefined) === null && rr.rt.watchPause("isolation", () => undefined) === null && rr.rt.watchPause("other", () => undefined) === null);
  const bad = await rr.rt.watchPause("account", () => { throw new Error("UI exploded"); })!; bad.stop(); rr.cleanup();
}
console.log(failures === 0 ? "\nall runtime tests passed" : `\n${failures} runtime test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
