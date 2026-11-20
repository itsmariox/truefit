// Phase 2e: backups, restore, and opening the data folder (integrity check, backup before upgrade, recovery). Real files in temp folders; fixtures only.
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { openDb } = await import("../src/store/db.ts");
const { migrate } = await import("../src/store/migrate.ts");
const { MIGRATIONS } = await import("../src/store/schema.ts");
const { saveProfile, loadProfile } = await import("../src/store/profile-store.ts");
const { setSettings, getSettings } = await import("../src/store/settings-store.ts");
const B = await import("../src/store/backup.ts");
const { openStore, recoverFromBackup, DB_FILE, BACKUPS_DIR } = await import("../src/store/open.ts");
type Prof = import("../src/profile.ts").Profile;
type BackupReasonT = import("../src/store/backup.ts").BackupReason;
const canon = (x: unknown): string => JSON.stringify(x, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v)); // content equality, key order ignored (profiles go through schema v2)
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const priya: Prof = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8"));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const at = (h: number) => new Date(Date.UTC(2026, 10, 17, 0, 0, 0) + h * 3600_000);
const roots: string[] = [];
const fresh = () => { const d = mkdtempSync(path.join(os.tmpdir(), "cvapp-bk-")); roots.push(d); return d; };
const seeded = () => { const db = openDb(":memory:"); migrate(db, MIGRATIONS); saveProfile(db, priya, at(0)); setSettings(db, { tone: "concise", accent: "plum", "telegram.chatId": 42 }, at(0)); return db; };
let bump = 0; const touch = (db: ReturnType<typeof openDb>) => { setSettings(db, { "telegram.chatId": 1000 + ++bump }, at(0)); }; // changes the data so the next backup is not an unchanged copy
const mode = (p: string) => statSync(p).mode & 0o777;

// ---------- creating, listing, pruning ----------
{
  const d = fresh(), bdir = path.join(d, "Backups"), empty = openDb(":memory:"); migrate(empty, MIGRATIONS);
  const r0 = await B.createBackup(empty, bdir, { reason: "daily", now: at(0) });
  ok("an empty database makes no backup (nothing to back up), and no folder is created for nothing", "skipped" in r0 && !existsSync(bdir));
  const db = seeded(); db.run("INSERT INTO jobs(folder,status,source,created,updated) VALUES ('j1','built','text','a','b')");
  const r = await B.createBackup(db, bdir, { reason: "daily", now: at(1) });
  const file = path.join(bdir, (r as { file: string }).file), body = JSON.parse(readFileSync(file, "utf8"));
  ok("a backup is one readable file with a checksum, holding the profile and settings and NOT the jobs; it is private to the user (file 0600, folder 0700)", r.ok && mode(file) === 0o600 && mode(bdir) === 0o700 && body.payload.profile && body.payload.settings.length === 3 && !JSON.stringify(body).includes("j1") && body.sha256.length === 64 && /daily/.test(file));
  ok("the backup file is never left half-written: no temporary file remains", readdirSync(bdir).every((f) => !f.endsWith(".tmp")));
  const list = await B.listBackups(bdir);
  ok("listing shows each backup's time, reason and whether it is valid, newest first", list.length === 1 && list[0].valid && list[0].reason === "daily" && list[0].createdAt === at(1).toISOString());
  for (const h of [2, 3, 4, 5]) { touch(db); await B.createBackup(db, bdir, { reason: h === 3 ? "pre-update" : "daily", now: at(h) }); }
  const kept = await B.listBackups(bdir);
  ok("only the newest THREE backups are kept", kept.length === B.KEEP_BACKUPS && kept.map((k) => k.createdAt).join() === [at(5), at(4), at(3)].map((x) => x.toISOString()).join());
  touch(db); const two = await B.createBackup(db, bdir, { reason: "daily", now: at(5) });
  ok("two backups in the same second get different names (none overwritten)", two.ok && "file" in two && new Set(readdirSync(bdir)).size === readdirSync(bdir).length);
  // damage the newest, then check what housekeeping does
  const newest = path.join(bdir, kept[0].file), t = JSON.parse(readFileSync(newest, "utf8")); t.payload.profile.doc = t.payload.profile.doc.replace("Priya", "Mallory"); writeFileSync(newest, JSON.stringify(t));
  const afterTamper = await B.listBackups(bdir);
  ok("a changed or damaged backup is DETECTED by its checksum and listed as invalid with a reason (never trusted)", afterTamper.some((b) => !b.valid && /checksum/.test(b.problem!)));
  touch(db); await B.createBackup(db, bdir, { reason: "daily", now: at(6) });
  const afterPrune = await B.listBackups(bdir);
  ok("after the next good backup, unusable files are removed and the newest three VALID ones remain", afterPrune.length === 3 && afterPrune.every((b) => b.valid) && afterPrune[0].createdAt === at(6).toISOString());
  writeFileSync(path.join(bdir, "backup-x.json"), "not json"); writeFileSync(path.join(bdir, "backup-y.json"), JSON.stringify({ hello: 1 })); writeFileSync(path.join(bdir, "notes.txt"), "mine");
  const mixed = await B.listBackups(bdir);
  ok("junk files are reported invalid (not valid, incomplete), and files that are not backups are ignored and never deleted", mixed.filter((b) => !b.valid).length === 2 && mixed.some((b) => /not valid/.test(b.problem ?? "")) && mixed.some((b) => /incomplete/.test(b.problem ?? "")) && (touch(db), (await B.createBackup(db, bdir, { reason: "daily", now: at(7) })).ok) && existsSync(path.join(bdir, "notes.txt")));
  ok("a backup over the size limit is refused with a plain reason and nothing is written", await (async () => { const big = clone(priya); big.roles[0].bullets[0].text = "x".repeat(B.MAX_BACKUP_BYTES); const bd = openDb(":memory:"); migrate(bd, MIGRATIONS); bd.run("INSERT INTO profile VALUES (1, ?, 1, 't')", JSON.stringify(big)); const dd = fresh(); const res = await B.createBackup(bd, path.join(dd, "B"), { reason: "daily", now: at(0) }); return !res.ok && /unexpectedly large/.test((res as { error: string }).error) && !existsSync(path.join(dd, "B")); })());
  ok("a backup folder that cannot be written gives a plain error, not a crash", await (async () => { const dd = fresh(); writeFileSync(path.join(dd, "B"), "a file, not a folder"); const res = await B.createBackup(db, path.join(dd, "B"), { reason: "daily", now: at(0) }); return !res.ok && /could not write/.test((res as { error: string }).error); })());
  db.close(); empty.close();
}

// ---------- unchanged data, and WHEN to back up ----------
{
  const d = fresh(), bdir = path.join(d, "B"), db = seeded();
  const a = await B.createBackup(db, bdir, { reason: "daily", now: at(0) }), same = await B.createBackup(db, bdir, { reason: "pre-update", now: at(1) });
  ok("a backup of data identical to the newest backup is SKIPPED ('unchanged'): nothing is written, nothing older is pushed out", "file" in a && "skipped" in same && same.skipped === "unchanged" && (await B.listBackups(bdir)).length === 1);
  touch(db);
  ok("as soon as the profile or settings change, the next backup is written", "file" in (await B.createBackup(db, bdir, { reason: "change", now: at(2) })) && (await B.listBackups(bdir)).length === 2);
  // many failed-upgrade launches in a row must not erase the older backups
  const d2 = fresh(), b2 = path.join(d2, "B"), db2 = seeded();
  await B.createBackup(db2, b2, { reason: "daily", now: at(0) }); touch(db2); await B.createBackup(db2, b2, { reason: "daily", now: at(30) }); touch(db2);
  for (let i = 0; i < 6; i++) await B.createBackup(db2, b2, { reason: "pre-migration", now: at(50 + i) });
  const l2 = await B.listBackups(b2);
  ok("six failed-upgrade launches in a row write ONE pre-migration backup (the rest are unchanged data), so the older backups survive", l2.length === 3 && l2.filter((x) => x.reason === "pre-migration").length === 1 && l2.some((x) => x.createdAt === at(0).toISOString()));
  db.close(); db2.close();
  const R = (h: number, reason: string, valid = true) => ({ createdAt: at(h).toISOString(), reason: reason as never, valid });
  const dec = (nowH: number, list: ReturnType<typeof R>[]) => B.backupDecision(at(nowH), list);
  ok("decision: no backup at all means a daily backup is due", JSON.stringify(dec(0, [])) === '{"due":true,"reason":"daily"}' && JSON.stringify(dec(0, [R(0, "daily", false)])) === '{"due":true,"reason":"daily"}');
  ok("decision: a regular backup under an hour old means nothing is due; between an hour and a day old means a 'change' backup is due; a day or more means daily", !dec(0.5, [R(0, "daily")]).due && JSON.stringify(dec(2, [R(0, "daily")])) === '{"due":true,"reason":"change"}' && JSON.stringify(dec(24, [R(0, "daily")])) === '{"due":true,"reason":"daily"}' && JSON.stringify(dec(23.9, [R(0, "daily")])) === '{"due":true,"reason":"change"}');
  ok("decision: change backups do not count as the day's backup (daily still becomes due 24 hours after the last regular one, even if a change backup is recent); an upgrade-only backup does not count either", JSON.stringify(dec(25, [R(24, "change"), R(0, "daily")])) === '{"due":true,"reason":"daily"}' && !dec(24.5, [R(24, "change"), R(1, "daily")]).due && JSON.stringify(dec(2, [R(1, "pre-migration")])) === '{"due":true,"reason":"daily"}');
  ok("decision: the newest valid backup decides, an invalid newer file is ignored", JSON.stringify(dec(2, [R(1.9, "daily", false), R(0, "daily")])) === '{"due":true,"reason":"change"}');
  // the scheduled run end to end, with real files
  const d3 = fresh(), b3 = path.join(d3, "B"), db3 = seeded();
  const s1 = await B.scheduledBackup(db3, b3, at(0)), s2 = await B.scheduledBackup(db3, b3, at(0.5)), s3 = await B.scheduledBackup(db3, b3, at(2));
  touch(db3);
  const s4 = await B.scheduledBackup(db3, b3, at(3)), s5 = await B.scheduledBackup(db3, b3, at(3.2)); touch(db3); const s6 = await B.scheduledBackup(db3, b3, at(26));
  const kinds = (await B.listBackups(b3)).map((x) => x.reason).join();
  ok("scheduled run: first launch writes a daily backup; within the hour nothing; an hour later with no edits it writes nothing; after an edit it writes a 'change' backup; after a day (with edits again), a daily one; had nothing changed, even the daily one is skipped as unchanged", "file" in s1 && "skipped" in s2 && s2.skipped === "not due" && "skipped" in s3 && s3.skipped === "unchanged" && "file" in s4 && "skipped" in s5 && "file" in s6 && kinds === "daily,change,daily".split(",").reverse().join());
  db3.close();
  // retention: three regular plus one recent change backup
  const d4 = fresh(), b4 = path.join(d4, "B"), db4 = seeded();
  for (const [h, r] of [[0, "daily"], [30, "daily"], [60, "daily"], [90, "daily"], [91.5, "change"], [93, "change"]] as [number, BackupReasonT][]) { touch(db4); await B.createBackup(db4, b4, { reason: r, now: at(h) }); }
  const l4 = await B.listBackups(b4);
  ok("retention: the newest THREE regular backups and the newest ONE change backup are kept (the older change backup is dropped, the daily ones are not pushed out by it)", l4.length === 4 && l4.filter((x) => x.reason === "change").length === 1 && l4.filter((x) => x.reason === "daily").length === 3 && l4.find((x) => x.reason === "change")!.createdAt === at(93).toISOString() && !l4.some((x) => x.createdAt === at(0).toISOString()));
  db4.close();
}

// ---------- restore ----------
{
  const d = fresh(), bdir = path.join(d, "B"), db = seeded(); db.run("INSERT INTO jobs(folder,status,source,created,updated) VALUES ('keepme','built','text','a','b')");
  const made = await B.createBackup(db, bdir, { reason: "daily", now: at(1) }) as { file: string };
  const before = JSON.stringify((loadProfile(db) as { profile: Prof }).profile), settingsBefore = JSON.stringify(getSettings(db).settings);
  const p2 = clone(priya); p2.identity.city = "Elsewhere"; saveProfile(db, p2, at(2)); setSettings(db, { tone: "neutral", "telegram.chatId": 7 }, at(2));
  const r = await B.restoreBackup(db, bdir, made.file);
  ok("restore puts the profile and settings back exactly as they were, and leaves the jobs alone", r.ok && JSON.stringify((loadProfile(db) as { profile: Prof }).profile) === before && JSON.stringify(getSettings(db).settings) === settingsBefore && db.all("SELECT * FROM jobs WHERE folder='keepme'").length === 1);
  const snapshot = () => JSON.stringify([db.all("SELECT * FROM profile"), db.all("SELECT * FROM settings")]);
  const base = snapshot(), good = JSON.parse(readFileSync(path.join(bdir, made.file), "utf8"));
  const write = (name: string, mut: (b: any) => void, resum = true) => { const b = clone(good); mut(b); if (resum) b.sha256 = require_sha(b.payload); writeFileSync(path.join(bdir, name), JSON.stringify(b)); return name; };
  const { createHash } = await import("node:crypto"); const require_sha = (p: unknown) => createHash("sha256").update(JSON.stringify(p)).digest("hex");
  const cases: [string, string][] = [
    [write("backup-t1.json", (b) => { b.payload.profile.doc = "{nope"; }), "cannot be read"],
    [write("backup-t2.json", (b) => { b.payload.profile.doc = JSON.stringify({ x: 1 }); }), "not valid"],
    [write("backup-t3.json", (b) => { b.payload.profile.profile_format = 99; }), "newer version"],
    [write("backup-t4.json", (b) => { b.backupFormat = 99; }), "newer version"],
    [write("backup-t5.json", (b) => { b.payload.profile.doc += " "; }, false), "checksum"],
    ["../outside.json", "not a backup file"],
    ["backup-missing.json", "cannot be read"],
  ];
  const results = await Promise.all(cases.map(async ([f]) => B.restoreBackup(db, bdir, f)));
  ok("a restore is checked before anything changes: unreadable, invalid or newer-format profiles, a newer backup format, a changed file, a path outside the folder and a missing file are all refused with a reason, and the database is untouched", results.every((x, i) => !x.ok && new RegExp(cases[i][1]).test((x as { error: string }).error)) && snapshot() === base);
  const nothing = await B.restoreBackup(db, bdir, write("backup-t6.json", (b) => { b.payload.profile = null; b.payload.settings = [{ key: "tone", value: '"neutral"', updated_at: "t" }, { key: "madeUpKey", value: "1", updated_at: "t" }, { key: "tone", value: 5, updated_at: "t" }]; }));
  ok("restoring a backup with no profile restores that state; settings keys that this version does not know, or malformed rows, are not restored", nothing.ok && loadProfile(db).status === "none" && db.all("SELECT * FROM settings").length === 1 && getSettings(db).settings.tone === "neutral");
  db.close();
}

// ---------- opening the data folder ----------
{
  const d = fresh();
  const o1 = await openStore(d, { now: at(0) });
  ok("a brand-new data folder opens, is created at the latest format, makes no backup, and the folder is private (0700)", o1.status === "ok" && o1.created && o1.migrated.length === MIGRATIONS.length && o1.profile === "none" && o1.backups.length === 0 && mode(d) === 0o700 && o1.db.version() === MIGRATIONS.length);
  if (o1.status === "ok") { saveProfile(o1.db, priya, at(0)); setSettings(o1.db, { tone: "concise" }, at(0)); o1.db.close(); }
  const o2 = await openStore(d, { now: at(1) });
  ok("reopening keeps everything, runs no upgrade and makes no backup", o2.status === "ok" && !o2.created && o2.migrated.length === 0 && o2.profile === "ok" && o2.backups.length === 0);
  if (o2.status === "ok") o2.db.close();
}
{
  // a database from an OLDER version holding data: the upgrade is preceded by a backup
  const d = fresh(), f = path.join(d, DB_FILE), old = openDb(f); migrate(old, MIGRATIONS.slice(0, 1)); saveProfile(old, priya, at(0)); setSettings(old, { tone: "concise" }, at(0)); old.close();
  const o = await openStore(d, { now: at(3) });
  const bk = o.status === "ok" ? o.backups : [];
  ok("an older database is upgraded after a 'pre-migration' backup of its profile and settings was written; nothing is lost", o.status === "ok" && o.migrated.length === MIGRATIONS.length - 1 && bk.length === 1 && bk[0].reason === "pre-migration" && o.profile === "ok" && getSettings(o.db).settings.tone === "concise");
  if (o.status === "ok") o.db.close();
  // failing upgrade: v3 throws
  const d2 = fresh(), db2 = openDb(path.join(d2, DB_FILE)); migrate(db2, MIGRATIONS); saveProfile(db2, priya, at(0)); db2.close();
  const bad = [...MIGRATIONS, { version: MIGRATIONS.length + 1, name: "breaks", up: (x: any) => { x.exec("CREATE TABLE half(a)"); throw new Error("kaboom"); } }];
  const f2 = await openStore(d2, { now: at(4), migrations: bad });
  const chk = openDb(path.join(d2, DB_FILE));
  ok("a failing upgrade is reported plainly, a backup was taken first, and the data is exactly as before (old version, no half-made table, profile intact)", f2.status === "upgrade-failed" && /kaboom/.test(f2.message) && f2.backups.length === 1 && chk.version() === MIGRATIONS.length && loadProfile(chk).status === "ok" && !chk.all("SELECT name FROM sqlite_master").some((r: any) => r.name === "half"));
  chk.close();
  // backup folder unwritable, upgrade pending
  const d3 = fresh(), old3 = openDb(path.join(d3, DB_FILE)); migrate(old3, MIGRATIONS.slice(0, 1)); saveProfile(old3, priya, at(0)); old3.close(); writeFileSync(path.join(d3, BACKUPS_DIR), "blocking file");
  const f3 = await openStore(d3, { now: at(5) });
  const c3 = openDb(path.join(d3, DB_FILE));
  ok("if no backup can be made, the upgrade is REFUSED and the data is not changed", f3.status === "upgrade-failed" && /no backup could be made first/.test(f3.message) && c3.version() === 1);
  c3.close();
  // too new
  const d4 = fresh(), db4 = openDb(path.join(d4, DB_FILE)); migrate(db4, MIGRATIONS); db4.setVersion(99); db4.close(); const bytes4 = readFileSync(path.join(d4, DB_FILE));
  const f4 = await openStore(d4, { now: at(6) });
  ok("data from a newer format is reported (update the app) and the file is not touched", f4.status === "too-new" && /update the app/.test(f4.message) && readFileSync(path.join(d4, DB_FILE)).equals(bytes4));
  // damaged profile inside a sound database
  const d5 = fresh(), db5 = openDb(path.join(d5, DB_FILE)); migrate(db5, MIGRATIONS); db5.run("INSERT INTO profile VALUES (1, '{broken', 1, 't')"); db5.close();
  const f5 = await openStore(d5, { now: at(7) });
  ok("a sound database holding a damaged profile opens and says so (profile: damaged), so the app can offer the backup", f5.status === "ok" && f5.profile === "damaged");
  if (f5.status === "ok") f5.db.close();
}

// ---------- damage and recovery ----------
{
  const d = fresh(), f = path.join(d, DB_FILE), bdir = path.join(d, BACKUPS_DIR);
  const s = await openStore(d, { now: at(0) }); if (s.status !== "ok") throw new Error("setup");
  saveProfile(s.db, priya, at(0)); setSettings(s.db, { tone: "concise", accent: "forest" }, at(0));
  await B.createBackup(s.db, bdir, { reason: "daily", now: at(1) }); s.db.close();
  const bytes = readFileSync(f); for (let i = 100; i < Math.min(bytes.length, 1500); i++) bytes[i] = 0xff; writeFileSync(f, bytes);
  for (const x of [f + "-wal", f + "-shm"]) rmSync(x, { force: true });
  const bad = await openStore(d, { now: at(2) });
  ok("a damaged database is detected at launch: it is reported with a reason and the available backups, and the file is NOT touched", bad.status === "damaged" && bad.backups.length === 1 && bad.backups[0].valid && readFileSync(f).equals(bytes));
  const junkRes = await (async () => { const dj = fresh(); writeFileSync(path.join(dj, DB_FILE), "plain text, not a database. ".repeat(100)); return openStore(dj, { now: at(2) }); })();
  ok("a file that is not a database at all is reported as damaged too", junkRes.status === "damaged");
  const badRecover = await recoverFromBackup(d, "backup-nope.json", { now: at(3) });
  ok("recovering from a bad backup is refused and changes nothing (the damaged file stays where it is)", !badRecover.ok && readFileSync(f).equals(bytes));
  const rec = await recoverFromBackup(d, bad.status === "damaged" ? bad.backups[0].file : "", { now: at(3) });
  ok("recovery moves the damaged file aside with a date (never deletes it), builds a fresh database at the latest format and restores the profile and settings", rec.ok && existsSync(path.join(d, (rec as { movedAside: string }).movedAside)) && readFileSync(path.join(d, (rec as { movedAside: string }).movedAside)).equals(bytes) && (rec as { db: ReturnType<typeof openDb> }).db.version() === MIGRATIONS.length && canon((loadProfile((rec as { db: ReturnType<typeof openDb> }).db) as { profile: Prof }).profile) === canon(priya) && getSettings((rec as { db: ReturnType<typeof openDb> }).db).settings.accent === "forest");
  if (rec.ok) rec.db.close();
  const again = await openStore(d, { now: at(4) });
  ok("after recovery the folder opens normally", again.status === "ok" && again.profile === "ok");
  if (again.status === "ok") again.db.close();
}
for (const r of roots) rmSync(r, { recursive: true, force: true });
console.log(failures === 0 ? "\nall backup tests passed" : `\n${failures} backup test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
