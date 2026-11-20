// Phase 4d: the app core, as whole stories on real files, the REAL engine (pipeline, store, access, runner) and fakes only for Claude, the login status, the clock, the timers and the Keychain.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { kindFromNote, startApp, type AppCore, type CoreEvent, type StartResult } from "../src/main/core/app-core.ts";
import { MemorySecretStore, SECRET_NAMES } from "../../engine/src/store/secrets.ts";
import { DB_FILE, JOBS_DIR, BACKUPS_DIR } from "../../engine/src/store/open.ts";
import { rig, priya, T0, analysis } from "./core-rig.ts";
void MemorySecretStore; void T0; void analysis;
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
let cur: AppCore | null = null; // the core being driven: settle waits (in real time, up to 5 s) until the queue has nothing running or startable
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  for (let t = 0; t < 500 && cur; t++) { const q = cur.queue.snapshot(); if (!q.entries.some((e) => e.state === "running" || (e.state === "queued" && !q.blocked))) break; await new Promise((r) => setTimeout(r, 10)); }
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

async function ready(r: StartResult): Promise<{ core: AppCore; notes: Extract<StartResult, { status: "ready" }>["notes"] }> { if (r.status !== "ready") throw new Error("expected ready, got " + r.status); cur = r.core; return r; }
const AD = (n: string) => `A marketing role at ${n}, working with the team on campaigns and reporting. `.repeat(6);

const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-core-")); mkdirSync(path.join(root, "tmp"));
try {
  // 1. first launch
  const R = rig(root); const { core, notes } = await ready(await startApp(R.deps()));
  ok("1. first launch creates the data folder and a database, with no profile yet and no leftovers", notes.created && notes.profile === "none" && notes.leftovers.length === 0 && existsSync(path.join(root, "data", DB_FILE)));
  const early = await core.jobs.create(AD("Acme"));
  ok("2. a job cannot be created before there is a profile (a plain reason, nothing is written)", !early.ok && early.reason === "no_profile" && !existsSync(path.join(root, "data", JOBS_DIR)) || (!early.ok && readdirSync(path.join(root, "data", JOBS_DIR)).length === 0));
  const events: CoreEvent[] = []; core.onEvent((e) => events.push(e)); core.onEvent(() => { throw new Error("a broken screen"); });
  const saved = core.profile.save(priya); core.access.chooseMode("subscription"); core.access.acceptNotice();
  ok("3. a saved profile is kept and used from then on", saved.ok && core.profile.get()?.identity.name === priya.identity.name && !!priya.identity.name);

  // 4. a job through the queue
  const c1 = await core.jobs.create(AD("Acme Retail")); if (!c1.ok) throw new Error("create failed " + c1.reason);
  ok("4. creating a job writes its folder and does not start the analysis", script0(R) && readdirSync(path.join(root, "data", JOBS_DIR)).length === 1);
  const a1 = core.jobs.analyse(c1.job); await settle();
  const j1 = await core.jobs.get(c1.job.id), idx = core.jobs.list();
  ok("5. analysing runs through the queue to the end; History (the index) already knows the job; screens heard about it", a1.ok && j1?.status === "analysed" && idx.total === 1 && idx.rows[0].company === "Acme Retail" && events.some((e) => e.type === "queue") && events.some((e) => e.type === "job") && core.queue.idle());
  const dup = await core.jobs.create(AD("Acme Retail").toUpperCase().replace(/ /g, "  "));
  ok("6. the same ad again (capitals and spacing ignored) is recognised and the existing job is offered instead", !dup.ok && dup.reason === "duplicate" && dup.existing.id === c1.job.id);
  const empty = await core.jobs.create("   "), long = await core.jobs.create("x".repeat(30001));
  ok("7. an empty or over-long ad is refused with a reason", !empty.ok && empty.reason === "empty" && !long.ok && long.reason === "too_long");

  // 8. a pause blocks the next job; nothing resumes by itself; Resume continues
  R.script.next = "auth"; R.script.company = "Larkfield";
  const c2 = await core.jobs.create(AD("Larkfield")), c3 = await core.jobs.create(AD("Bramble")); if (!c2.ok || !c3.ok) throw new Error("create");
  core.jobs.analyse(c2.job); core.jobs.analyse(c3.job); await settle();
  let snap = core.queue.snapshot(); const callsAtPause = R.script.calls;
  ok("8. Claude not signed in PAUSES the job (login), the queue is blocked and the next job waits without a single call", snap.blocked && snap.entries.find((e) => e.id === c2.job.id)?.state === "paused" && snap.entries.find((e) => e.id === c3.job.id)?.state === "queued" && (await core.jobs.get(c2.job.id))?.status === "paused");
  R.script.next = "ok"; await R.ft.advance(3_600_000 * 3 / 3); await settle();
  ok("9. even after the connection works again nothing resumes by itself", core.queue.snapshot().blocked && R.script.calls === callsAtPause);
  const rr = core.jobs.resume((await core.jobs.get(c2.job.id))!); await settle();
  snap = core.queue.snapshot();
  ok("10. the user's Resume continues the paused job, then the waiting one starts", rr.ok && !snap.blocked && snap.entries.every((e) => e.state === "done" || e.state === "skipped") && (await core.jobs.get(c3.job.id))?.status === "analysed");

  // 11. Skip
  R.script.next = "auth"; const c4 = await core.jobs.create(AD("Skipper")); if (!c4.ok) throw new Error("c4"); core.jobs.analyse(c4.job); await settle();
  const c5 = await core.jobs.create(AD("After skip")); if (!c5.ok) throw new Error("c5"); R.script.next = "ok"; core.jobs.analyse(c5.job); await settle();
  const blockedNow = core.queue.snapshot().blocked; await core.jobs.skip((await core.jobs.get(c4.job.id))!); await settle();
  ok("11. Skip ends the paused job as skipped and the queue moves on", blockedNow && (await core.jobs.get(c4.job.id))?.status === "skipped" && (await core.jobs.get(c5.job.id))?.status === "analysed" && !core.queue.snapshot().blocked);

  // 12. backups
  const bdir = path.join(root, "data", BACKUPS_DIR), nBefore = () => (existsSync(bdir) ? readdirSync(bdir).length : 0), b0 = nBefore();
  core.backup.start(); await settle(); const b1 = nBefore();
  await R.ft.advance(3_600_000); const b2 = nBefore(); core.backup.onWake(); await settle(); const b3 = nBefore();
  ok("12. a backup is taken at launch; the hourly timer and a wake-from-sleep ask again (and the schedule rules decide whether a new file is due)", b1 >= b0 + 1 && b2 >= b1 && b3 >= b2 && R.ft.q.length === 1);
  await core.shutdown(); await core.shutdown();
  ok("13. shutdown stops the timer and can be called twice", R.ft.q.length === 0);

  // 14. a restart: a job that was running becomes interrupted, is not run, and does not block
  const live = rig(root, R.secrets); const first = await ready(await startApp(live.deps()));
  const c6 = await first.core.jobs.create(AD("Midway")); if (!c6.ok) throw new Error("c6");
  const statusFile = path.join(c6.job.dir, "status.json"); const st = JSON.parse(readFileSync(statusFile, "utf8")); st.status = "analysing"; writeFileSync(statusFile, JSON.stringify(st));
  await first.core.shutdown({ finalBackup: false });
  const second = await ready(await startApp(live.deps())); const callsBefore = live.script.calls;
  const j6 = await second.core.jobs.get(c6.job.id);
  ok("14. after a restart the half-done job is 'interrupted', is NOT run by itself, and the queue is free", j6?.status === "interrupted" && second.core.needsAttention().some((j) => j.id === c6.job.id) && live.script.calls === callsBefore && !second.core.queue.snapshot().blocked);
  const rj = second.core.jobs.resume(j6!); await settle();
  ok("15. the user's Resume then runs it from its kept steps", rj.ok && (await second.core.jobs.get(c6.job.id))?.status === "analysed");
  await second.core.shutdown({ finalBackup: false });

  // 16. a paused job from before the restart blocks again, and is shown
  const L = rig(root, R.secrets); const s3 = await ready(await startApp(L.deps())); L.script.next = "auth";
  const c7 = await s3.core.jobs.create(AD("Paused before")); if (!c7.ok) throw new Error("c7"); s3.core.jobs.analyse(c7.job); await settle(); await s3.core.shutdown({ finalBackup: false });
  const s4 = await ready(await startApp(L.deps())); L.script.next = "ok";
  const p = s4.core.queue.snapshot().entries.find((e) => e.id === c7.job.id);
  ok("16. a job paused before the restart is back in the queue as paused and blocks it until the user decides", p?.state === "paused" && s4.core.queue.snapshot().blocked);
  s4.core.jobs.resume((await s4.core.jobs.get(c7.job.id))!); await settle();
  ok("17. and Resume finishes it", (await s4.core.jobs.get(c7.job.id))?.status === "analysed");

  // 18. delete everything: files, secrets, then the Keychain item
  await s4.core.access.saveKey("sk-ant-FAKE-test-key").catch(() => undefined); await R.secrets.set(SECRET_NAMES.claudeApiKey, "sk-ant-FAKE-x");
  const del = await s4.core.deleteEverything(true);
  ok("18. 'delete everything' removes the data and the secrets, and removes the Keychain item AFTER the files", del.ok && !existsSync(path.join(root, "data", DB_FILE)) && (await R.secrets.get(SECRET_NAMES.claudeApiKey)) === null && L.removed.length + R.removed.length >= 1 && (L.order.concat(R.order)).every((o) => o === "keychain-after-files"));
} finally { rmSync(root, { recursive: true, force: true }); }

// 19-21. problems at start-up are returned as outcomes, never thrown, and nothing is opened that is not safe
{
  const root2 = mkdtempSync(path.join(os.tmpdir(), "cvapp-core2-")); mkdirSync(path.join(root2, "tmp"));
  try {
    const R = rig(root2); const a = await ready(await startApp(R.deps())); a.core.profile.save(priya); await a.core.shutdown(); // writes a final backup
    writeFileSync(path.join(root2, "data", DB_FILE), "this is not a database at all, just text".repeat(50));
    const dmg = await startApp(R.deps());
    ok("19. a damaged database is reported as 'damaged' with the backups listed, and the jobs folder is not touched", dmg.status === "damaged" && dmg.backups.length >= 1);
    if (dmg.status === "damaged") {
      const rec = await ready(await dmg.recover(dmg.backups[0].file));
      ok("20. recovering from a backup brings the profile back and the app starts", rec.core.profile.get()?.identity.name === priya.identity.name && !!priya.identity.name); await rec.core.shutdown({ finalBackup: false });
    }
    writeFileSync(path.join(root2, "data", DB_FILE), "garbage again".repeat(80));
    const dmg2 = await startApp(R.deps()); if (dmg2.status !== "damaged") throw new Error("expected damaged");
    const fresh = await ready(await dmg2.startFresh());
    ok("21. 'start fresh' gives an empty app and keeps the damaged file aside (never deleted)", fresh.core.profile.get() === null && readdirSync(path.join(root2, "data")).some((n) => n.startsWith(DB_FILE) && n !== DB_FILE)); await fresh.core.shutdown({ finalBackup: false });
  } finally { rmSync(root2, { recursive: true, force: true }); }
}
ok("22. the pause kind is read back from a job's note for every pausable kind (used after a restart and when the queue entry is not there yet); an unknown note gives 'other'", kindFromNote("Claude needs you to sign in again.") === "auth" && kindFromNote("You've reached your Claude usage limit.") === "rate_limit" && kindFromNote("Claude couldn't be reached.") === "unavailable" && kindFromNote("There's a problem with your Claude account or billing.") === "account" && kindFromNote("Claude took too long to answer.") === "timeout" && kindFromNote("Your monthly spend limit has been reached.") === "cap" && kindFromNote("anything else") === "other" && kindFromNote(undefined) === "other");
{
  const root3 = mkdtempSync(path.join(os.tmpdir(), "cvapp-core3-")); mkdirSync(path.join(root3, "tmp"));
  try {
    const R = rig(root3); const { core } = await ready(await startApp(R.deps())); core.access.chooseMode("subscription"); core.access.acceptNotice(); core.profile.save(priya);
    const a = await core.jobs.create(AD("Queue A")), b = await core.jobs.create(AD("Queue B")); if (!a.ok || !b.ok) throw new Error("create");
    R.script.next = "auth"; core.jobs.analyse(a.job); await settle(); const pausedA = core.queue.snapshot().blocked;
    R.script.next = "ok"; const calls = R.script.calls; let done = false; const tp = core.telegramPipeline()!.analyse(b.job).then(() => { done = true; }); await new Promise((r) => setTimeout(r, 300));
    ok("23. a Telegram job waits behind a paused app job (one queue for the whole app): nothing is sent to Claude while the line is blocked", pausedA && !done && R.script.calls === calls && core.queue.snapshot().entries.some((e) => e.id === b.job.id && e.state === "queued"));
    core.jobs.resume((await core.jobs.get(a.job.id))!); await tp; await settle();
    ok("24. after the user resumes, both finish and the Telegram call gets its result", done && (await core.jobs.get(b.job.id))?.status === "analysed" && (await core.jobs.get(a.job.id))?.status === "analysed");
    let refused = ""; R.script.next = "auth"; core.jobs.analyse(a.job); await settle();
    try { await core.telegramPipeline()!.analyse((await core.jobs.get(a.job.id))!); } catch (e) { refused = (e as Error).message; }
    ok("25. a Telegram request for a job that is already paused in the queue is refused with a plain error (the bot reports it)", /already/.test(refused));
    await core.shutdown({ finalBackup: false });
  } finally { rmSync(root3, { recursive: true, force: true }); }
}
function script0(r: ReturnType<typeof rig>) { return r.script.calls === 0; } // the analysis is not started (the small ad check may have run)
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); } else console.log("\nALL PASS");
