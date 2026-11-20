// Phase 2 review, the four smaller items: no backup of an unreadable profile, a newer app's backups are not deleted, import refused while a job runs, interrupted-import
// leftovers reported, History index rebuilt at every launch, a "start fresh" path, and a private database file. Real files in temp folders; fixtures only.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { openDb } = await import("../src/store/db.ts");
const { migrate } = await import("../src/store/migrate.ts");
const { MIGRATIONS } = await import("../src/store/schema.ts");
const { saveProfile, loadProfile } = await import("../src/store/profile-store.ts");
const { setSettings } = await import("../src/store/settings-store.ts");
const B = await import("../src/store/backup.ts");
const { openStore, startFresh, recoverFromBackup, DB_FILE, JOBS_DIR, BACKUPS_DIR } = await import("../src/store/open.ts");
const { searchJobs } = await import("../src/store/jobs-index.ts");
const X = await import("../src/store/export.ts");
const PL = await import("../src/pipeline.ts");
type Prof = import("../src/profile.ts").Profile;
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const priya: Prof = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8"));
const NOW = new Date("2026-11-17T12:00:00Z"), at = (h: number) => new Date(NOW.getTime() + h * 3600_000);
const roots: string[] = []; const fresh = () => { const d = mkdtempSync(path.join(os.tmpdir(), "cvapp-fix-")); roots.push(d); return d; };
const mode = (p: string) => statSync(p).mode & 0o777;
const mkJob = async (jobsDir: string, folder: string, status: string, company = "Acme") => { const d = path.join(jobsDir, folder); mkdirSync(d, { recursive: true }); await PL.saveStateFile({ id: "id-" + folder, dir: d, status, created: NOW.toISOString(), updated: NOW.toISOString(), source: "text", company, role: "Role", verdict: "apply", fit: 60 } as never, NOW); writeFileSync(path.join(d, "ad.md"), "ad"); };

// ---------- 3. backups and an unreadable profile ----------
{
  const bdir = path.join(fresh(), "B"), db = openDb(":memory:"); migrate(db, MIGRATIONS); saveProfile(db, priya, NOW); setSettings(db, { tone: "concise" }, NOW);
  await B.createBackup(db, bdir, { reason: "daily", now: at(0) });
  const good = (await B.listBackups(bdir)).map((b) => b.file).join();
  db.run("UPDATE profile SET doc = '{broken'"); setSettings(db, { tone: "neutral" }, at(1));
  const r1 = await B.createBackup(db, bdir, { reason: "change", now: at(2) }), r2 = await B.scheduledBackup(db, bdir, at(30));
  ok("a profile that does not load is NEVER backed up (skipped 'profile unreadable'), by a direct backup or by the schedule, so the last good backup is not pushed out", "skipped" in r1 && r1.skipped === "profile unreadable" && "skipped" in r2 && r2.skipped === "profile unreadable" && (await B.listBackups(bdir)).map((b) => b.file).join() === good);
  db.run("UPDATE profile SET doc = ?, profile_format = 99", JSON.stringify(priya));
  const r3 = await B.createBackup(db, bdir, { reason: "change", now: at(3) });
  ok("a profile written by a newer format is not backed up either", "skipped" in r3 && r3.skipped === "profile unreadable");
  db.run("DELETE FROM profile"); setSettings(db, { tone: "friendly" }, at(4));
  ok("with NO profile at all (settings only) a backup is still made", "file" in (await B.createBackup(db, bdir, { reason: "change", now: at(4) })));
  db.close();
  // a backup made by a newer version of the app is not ours to delete
  const d2 = path.join(fresh(), "B"), db2 = openDb(":memory:"); migrate(db2, MIGRATIONS); saveProfile(db2, priya, NOW);
  mkdirSync(d2, { recursive: true }); writeFileSync(path.join(d2, "backup-future.json"), JSON.stringify({ backupFormat: 99, createdAt: at(0).toISOString(), reason: "daily", sha256: "x", payload: { profile: null, settings: [] } }));
  writeFileSync(path.join(d2, "backup-junk.json"), "not json");
  await B.createBackup(db2, d2, { reason: "daily", now: at(1) });
  const l2 = await B.listBackups(d2);
  ok("housekeeping removes junk files but KEEPS a backup made by a newer app (listed as unusable here, flagged 'newer')", existsSync(path.join(d2, "backup-future.json")) && !existsSync(path.join(d2, "backup-junk.json")) && l2.some((b) => b.newer === true && !b.valid) && l2.filter((b) => b.valid).length === 1);
  db2.close();
}

// ---------- 4. import while a job runs; leftovers of an interrupted import ----------
{
  const root = fresh(), dataDir = path.join(root, "x", "CVApp");
  const o = await openStore(dataDir, { now: NOW }); if (o.status !== "ok") throw new Error("setup");
  saveProfile(o.db, priya, NOW); const jobsDir = path.join(dataDir, JOBS_DIR); await mkJob(jobsDir, "job-a", "built");
  const zip = path.join(root, "e.zip"); await X.exportAll(o.db, jobsDir, zip, { now: NOW });
  await mkJob(jobsDir, "job-b", "building");
  const before = readdirSync(jobsDir).sort().join(), r = await X.importExport({ zipFile: zip, db: o.db, jobsDir, backupsDir: path.join(dataDir, BACKUPS_DIR), now: at(1), confirmReplace: true });
  ok("an import is refused while a job is running, with nothing changed (same rule as delete)", !r.ok && /still running/.test(r.error ?? "") && readdirSync(jobsDir).sort().join() === before && readdirSync(dataDir).every((n) => !/import-|replaced-/.test(n)));
  o.db.close();
  // an interrupted import left staging folders
  mkdirSync(path.join(dataDir, "jobs.import-2026-11-17T00-00-00-000Z")); mkdirSync(path.join(dataDir, "jobs.replaced-2026-11-17T00-00-00-000Z")); writeFileSync(path.join(dataDir, "jobs.replaced-2026-11-17T00-00-00-000Z", "keep.txt"), "the user's old jobs");
  const o2 = await openStore(dataDir, { now: at(2) });
  ok("at launch the folders an interrupted import left behind are REPORTED (never deleted: 'replaced' holds the user's old jobs)", o2.status === "ok" && o2.leftovers.length === 2 && o2.leftovers.some((n) => n.startsWith("jobs.replaced-")) && existsSync(path.join(dataDir, "jobs.replaced-2026-11-17T00-00-00-000Z", "keep.txt")));
  if (o2.status === "ok") o2.db.close();
}

// ---------- 5. index at every launch, start fresh, private file ----------
{
  const root = fresh(), dataDir = path.join(root, "y", "CVApp"), jobsDir = path.join(dataDir, JOBS_DIR);
  const o1 = await openStore(dataDir, { now: NOW }); if (o1.status !== "ok") throw new Error("setup");
  await mkJob(jobsDir, "job-1", "built", "Alpha Co"); await mkJob(jobsDir, "job-2", "analysed", "Beta Co");
  saveProfile(o1.db, priya, NOW); o1.db.close();
  const o2 = await openStore(dataDir, { now: at(1) });
  ok("the History index is rebuilt from the job folders at EVERY launch: jobs added while the app was closed (or whose index hook failed) are there at once", o2.status === "ok" && o2.index.indexed === 2 && searchJobs(o2.db, { text: "alpha" }).total === 1);
  if (o2.status === "ok") o2.db.close();
  rmSync(path.join(jobsDir, "job-1"), { recursive: true });
  const o3 = await openStore(dataDir, { now: at(2) });
  ok("and a job folder removed behind the app's back disappears from History at the next launch", o3.status === "ok" && o3.index.indexed === 1 && searchJobs(o3.db, { text: "alpha" }).total === 0);
  if (o3.status === "ok") { o3.db.run("INSERT INTO settings VALUES ('x','1','t')"); o3.db.close(); }
  ok("the database file and its log files are private to the user (0600), even after writes", [DB_FILE, DB_FILE + "-wal", DB_FILE + "-shm"].filter((n) => existsSync(path.join(dataDir, n))).every((n) => mode(path.join(dataDir, n)) === 0o600) && mode(path.join(dataDir, DB_FILE)) === 0o600);
  // damaged, no backup at all
  const bytes = readFileSync(path.join(dataDir, DB_FILE)); for (let i = 100; i < Math.min(bytes.length, 2000); i++) bytes[i] = 0xff; writeFileSync(path.join(dataDir, DB_FILE), bytes); for (const e of ["-wal", "-shm"]) rmSync(path.join(dataDir, DB_FILE + e), { force: true });
  const bad = await openStore(dataDir, { now: at(3) });
  ok("setup: a damaged database with NO backup is reported as damaged with an empty backup list", bad.status === "damaged" && bad.backups.length === 0);
  const rec = await recoverFromBackup(dataDir, "backup-none.json", { now: at(3) });
  const no = await startFresh(dataDir, { now: at(3), confirmed: false });
  ok("there is a way out: recovery from a missing backup is refused, and 'start fresh' needs confirmation and changes nothing without it", !rec.ok && !no.ok && readFileSync(path.join(dataDir, DB_FILE)).equals(bytes));
  const sf = await startFresh(dataDir, { now: at(3), confirmed: true });
  ok("'start fresh' sets the damaged file aside with a date (never deletes it), starts an empty database at the latest format, and rebuilds History from the job folders; the profile has to be entered or imported again", sf.ok && existsSync(path.join(dataDir, sf.movedAside)) && readFileSync(path.join(dataDir, sf.movedAside)).equals(bytes) && sf.db.version() === MIGRATIONS.length && loadProfile(sf.db).status === "none" && searchJobs(sf.db, { text: "beta" }).total === 1 && mode(path.join(dataDir, DB_FILE)) === 0o600);
  if (sf.ok) sf.db.close();
  const again = await openStore(dataDir, { now: at(4) });
  ok("after starting fresh the folder opens normally", again.status === "ok" && again.profile === "none");
  if (again.status === "ok") again.db.close();
}
for (const r of roots) rmSync(r, { recursive: true, force: true });
console.log(failures === 0 ? "\nall store-fixes tests passed" : `\n${failures} store-fixes test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
