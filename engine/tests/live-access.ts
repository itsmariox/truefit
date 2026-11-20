// LIVE access checks through the real access runtime, the real runner and the REAL Claude program (phase 3h). Opt-in, never part of npm test:
//   CVAPP_LIVE=1 node tests/live-access.ts            scenarios A and B: no quota (refused before any model work), fictional profile and ad only
//   CVAPP_LIVE=1 CVAPP_LIVE_SIGNIN=1 node tests/live-access.ts   adds scenario E: starts the REAL sign-in in a separate settings folder, waits for its link, then cancels (no login is made; a browser tab may open)
//   CVAPP_LIVE=1 CVAPP_LIVE_CALL=1 node tests/live-access.ts   adds scenario C: ONE tiny real call on the cheapest model with the user's real login (a fraction of a cent of quota)
// Scenario A uses an EMPTY separate settings folder, so the user's real login is never touched, read or changed.
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
if (process.env.CVAPP_LIVE !== "1") { console.log("set CVAPP_LIVE=1 (real calls; A and B spend no quota)"); process.exit(0); }
const dir = path.dirname(fileURLToPath(import.meta.url)), root = path.join(dir, "..");
const { query } = await import("@anthropic-ai/claude-agent-sdk");
const { openDb } = await import("../src/store/db.ts"); const { migrate } = await import("../src/store/migrate.ts"); const { MIGRATIONS } = await import("../src/store/schema.ts");
const { setSettings } = await import("../src/store/settings-store.ts"); const { MemorySecretStore, SECRET_NAMES } = await import("../src/store/secrets.ts");
const { createAccessRuntime } = await import("../src/access/runtime.ts"); const { spawnRunner } = await import("../src/access/status.ts"); const { findBundledClaude } = await import("../src/access/access.ts");
const { testConnection, VALIDATION_MODEL } = await import("../src/access/connect.ts"); const { loadConfig } = await import("../src/config.ts"); const PL = await import("../src/pipeline.ts");
const bin = findBundledClaude(); if (!bin) { console.error("the bundled Claude program was not found"); process.exit(2); }
const profile = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8")), cfg = await loadConfig();
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const tmp = mkdtempSync(path.join(os.tmpdir(), "cvapp-liveaccess-"));

async function scenario(name: string, o: { mode: "subscription" | "apiKey"; key?: string; configDir?: string }) {
  const db = openDb(":memory:"); migrate(db, MIGRATIONS); const secrets = new MemorySecretStore();
  setSettings(db, { "claude.mode": o.mode }, new Date()); if (o.key) await secrets.set(SECRET_NAMES.claudeApiKey, o.key);
  const rt = createAccessRuntime({ db, secrets, statusRunner: spawnRunner(bin!), query: query as never, base: { tone: "friendly", config: cfg, skillsDir: path.join(root, "skills"), tmpRoot: tmp, env: process.env, configDir: o.configDir } });
  if (o.mode === "subscription") rt.access.acceptNotice();
  const jobsDir = path.join(tmp, name, "jobs"); mkdirSync(jobsDir, { recursive: true });
  const pl = PL.createPipeline({ jobsDir, profile, runnerFor: rt.runnerFor, renderer: {} as never, fonts: {} as never, config: { accent: "oxford", showRightToWork: true, resumeProfile: "snapshot" } });
  const job = await pl.createJob("Marketing Executive at Brightwell Home (a fictional company). Weekly email campaigns, social posts, Google Analytics reporting. ".repeat(4), "text");
  let err: any = null; try { await pl.analyse(job); } catch (e) { err = e; }
  const state = await rt.access.state(), rows = db.all<{ role: string; mode: string; ok: number; error_code: number | null; cost_usd: number }>("SELECT role, mode, ok, error_code, cost_usd FROM usage");
  return { err, state, rows, rt, db };
}

// A: no login at all (an empty, separate settings folder)
{
  const cfgDir = mkdtempSync(path.join(tmp, "nologin-")), r = await scenario("A", { mode: "subscription", configDir: cfgDir });
  ok("A (live) no login: the real program says 'Not logged in'; the job PAUSES (kind auth, resumable) with the catalogue's sign-in note; the access state is expired/not connected; ONE failed row with cost 0 in the ledger", r.err?.kind === "auth" && r.err.pausable && r.err.job?.status === "paused" && r.err.job.note === "Claude needs you to sign in again." && ["expired", "not_connected"].includes(r.state.kind) && r.rows.length === 1 && r.rows[0].ok === 0 && r.rows[0].cost_usd === 0);
  console.log("   state:", r.state.kind, "| message:", r.rt.describePause("auth").title, "|", r.rt.describePause("auth").body);
  r.db.close();
}
// B: a wrong API key while the real subscription login is present (it must NOT fall back to the subscription)
{
  const r = await scenario("B", { mode: "apiKey", key: "sk-ant-api03-LIVECHECKFAKEFAKEFAKEFAKEFAKEFAKE-FAKE" });
  ok("B (live) a wrong API key with the real subscription login present: the service refuses it (no silent fall back to the subscription); the job PAUSES (kind auth); the state is key_invalid; ONE failed row, mode apiKey, cost 0", r.err?.kind === "auth" && r.err.job?.status === "paused" && r.state.kind === "key_invalid" && r.rows.length === 1 && r.rows[0].ok === 0 && r.rows[0].mode === "apiKey" && r.rows[0].cost_usd === 0);
  console.log("   state:", r.state.kind, "| message:", r.rt.describePause("auth", { details: "" }).title, "→ for the state:", (await import("../src/access/messages.ts")).describeState(r.state, new Date()).title);
  r.db.close();
}
// D: a refused key through connectWithKey (the way the Settings screen saves a key): nothing is saved, no mode changes
{
  const { connectWithKey } = await import("../src/access/connect.ts"); const { createAccess } = await import("../src/access/access.ts");
  const db = openDb(":memory:"); migrate(db, MIGRATIONS); const secrets = new MemorySecretStore();
  const access = createAccess({ db, secrets, run: spawnRunner(bin!) });
  const r = await connectWithKey("sk-ant-api03-LIVECHECKFAKEFAKEFAKEFAKEFAKEFAKE-FAKE", { query: query as never, env: process.env, db, access, tmpRoot: tmp });
  const rows = db.all<{ ok: number; mode: string; cost_usd: number }>("SELECT ok, mode, cost_usd FROM usage");
  ok("D (live) a refused key through connectWithKey: the answer is 'access' with the state key_invalid, NOTHING is saved, no mode is set, and the ledger has one failed row (mode apiKey, cost 0)", !r.ok && r.kind === "access" && r.state?.kind === "key_invalid" && (await secrets.get(SECRET_NAMES.claudeApiKey)) === null && access.lastError() === null && rows.length === 1 && rows[0].ok === 0 && rows[0].cost_usd === 0);
  db.close();
}
// E: the REAL sign-in through createSignIn (opt-in): link, then cancel; nothing is logged in and the Keychain is unchanged
if (process.env.CVAPP_LIVE_SIGNIN === "1") {
  const { createSignIn } = await import("../src/access/signin.ts"); const { minimalEnv } = await import("../src/agents/options.ts"); const { checkLoginStatus } = await import("../src/access/status.ts"); const { execFileSync } = await import("node:child_process");
  const claudeKeychain = () => { try { return execFileSync("security", ["dump-keychain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(/\n(?=keychain:|class:)/).filter((b) => /"svce"<blob>="Claude/.test(b)).map((b) => (b.match(/"svce"<blob>="([^"]*)"/)?.[1] ?? "") + "|" + (b.match(/"mdat"<timedate>=[^"]*"([^"]*)"/)?.[1] ?? "")).sort().join(";"); } catch { return "unreadable"; } };
  const procs = () => { try { return execFileSync("pgrep", ["-f", "auth login --claudeai"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).length; } catch { return 0; } }, procsBefore = procs();
  const cfgDir = mkdtempSync(path.join(tmp, "signin-")), before = claudeKeychain(), env = { ...minimalEnv(process.env, { configDir: cfgDir }), PATH: "/var/empty" }; // no PATH: the program cannot open a browser tab by itself
  const links: string[] = [], events: string[] = [];
  const s = createSignIn({ binary: bin!, env, confirm: () => checkLoginStatus(spawnRunner(bin!), env), timeoutMs: 60_000 });
  const h = s.start((e) => { events.push(e.type); if (e.type === "link") { links.push(e.url); setTimeout(() => h.cancel(), 300); } });
  const res = await Promise.race([h.done, new Promise<{ ok: false; reason: string }>((r) => setTimeout(() => r({ ok: false, reason: "no link within 40s" }), 40_000))]); if (!links.length) h.cancel();
  await new Promise((r) => setTimeout(r, 2500));
  const alive = procs() - procsBefore; // sign-in programs still running beyond those that were running before (none expected)
  const st = await checkLoginStatus(spawnRunner(bin!), env);
  ok("E (live) the REAL sign-in through createSignIn: the link event arrives with the genuine authorisation link (https, a claude.com address, with the one-time 'state' and 'code_challenge'), a cancel ends it ('cancelled'), no process is left, the throwaway folder is NOT logged in, and the Keychain's Claude entries are identical before and after", links.length === 1 && /^https:\/\/claude\.com\//.test(links[0]) && /[?&]state=/.test(links[0]) && /[?&]code_challenge=/.test(links[0]) && !res.ok && (res as { reason: string }).reason === "cancelled" && alive === 0 && st.ok && !st.status.loggedIn && claudeKeychain() === before && events[0] === "starting");
  console.log("   events:", events.join(","), "| link host ok:", links[0] ? new URL(links[0]).hostname : "none", "| keychain unchanged:", claudeKeychain() === before);
} else console.log("SKIP E: set CVAPP_LIVE_SIGNIN=1 to start the real sign-in and cancel it");
// C: ONE tiny real call, only with CVAPP_LIVE_CALL=1
if (process.env.CVAPP_LIVE_CALL === "1") {
  const db = openDb(":memory:"); migrate(db, MIGRATIONS);
  const t = await testConnection({ query: query as never, mode: "subscription", env: process.env, db, tmpRoot: tmp });
  const rows = db.all<{ role: string; model: string; mode: string; ok: number; cost_usd: number }>("SELECT role, model, mode, ok, cost_usd FROM usage");
  console.log("   test result:", JSON.stringify(t.ok ? { ok: true, costUsd: t.costUsd, ms: t.ms } : { ok: false, kind: t.kind, why: (t as { why?: string }).why }));
  ok(`C (live) Test connection on the cheapest model (${VALIDATION_MODEL}) with the real subscription login: it works, apiKeySource and the isolation fields pass the checks, and one ledger row (mode subscription) records the cost`, t.ok && rows.length === 1 && rows[0].ok === 1 && rows[0].mode === "subscription" && rows[0].model === VALIDATION_MODEL);
  db.close();
} else console.log("SKIP C: set CVAPP_LIVE_CALL=1 to make the one tiny paid call");
rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? "\nall live-access checks passed" : `\n${failures} live-access check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
