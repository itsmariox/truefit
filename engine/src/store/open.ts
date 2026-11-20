// Opening the app's data folder at launch (phase 2e): integrity check, automatic backup before a format upgrade, upgrade, and the recovery path. The folder holds
// app.db and a Backups folder. Nothing here ever deletes a database: a damaged one is moved aside with a date, so no copy is ever lost to a failed recovery.
import { mkdir, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { openDb, type Db } from "./db.ts";
import { migrate, MigrationError, StoreTooNewError, type Migration } from "./migrate.ts";
import { MIGRATIONS } from "./schema.ts";
import { createBackup, listBackups, restoreBackup, type BackupInfo } from "./backup.ts";
import { loadProfile } from "./profile-store.ts";
import { rebuildIndex } from "./jobs-index.ts";

export const DB_FILE = "app.db", BACKUPS_DIR = "Backups", JOBS_DIR = "jobs", SECRETS_DIR = "secrets", TELEGRAM_DIR = "telegram", MARKER = ".cvapp-data"; // the marker proves a folder is the app's own data folder (delete refuses any other folder)
export type OpenResult =
  | { status: "ok"; db: Db; created: boolean; migrated: string[]; profile: "none" | "ok" | "damaged" | "too-new"; backups: BackupInfo[];
      index: { indexed: number; skipped: { folder: string; reason: string }[] };   // the History index is rebuilt from the job folders at EVERY launch
      leftovers: string[] }                                                        // folders an interrupted import left next to the jobs folder (jobs.import-*, jobs.replaced-*): the app reports them, never deletes them
  | { status: "damaged"; reason: string; backups: BackupInfo[] }       // the file is left exactly as it is; the user chooses to restore (recoverFromBackup)
  | { status: "too-new"; message: string }                              // never touched; the app asks for an update
  | { status: "upgrade-failed"; message: string; backups: BackupInfo[] }; // the data is as it was before; a backup was taken first

export async function openStore(dataDir: string, o: { now: Date; migrations?: Migration[] }): Promise<OpenResult> {
  const migrations = o.migrations ?? MIGRATIONS, file = path.join(dataDir, DB_FILE), backupsDir = path.join(dataDir, BACKUPS_DIR);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const existed = (await readdir(dataDir)).includes(DB_FILE);
  await writeFile(path.join(dataDir, MARKER), "CVApp data folder. Do not put your own files here.\n", { mode: 0o600 });
  const backups = () => listBackups(backupsDir);
  let db: Db;
  try { db = openDb(file); } catch (e) { return { status: "damaged", reason: `the database cannot be opened: ${(e as Error).message}`, backups: await backups() }; }
  if (existed) {
    const problems = db.integrity();
    if (problems.length) { db.close(); return { status: "damaged", reason: `the database failed its integrity check: ${problems[0]}`, backups: await backups() }; }
  }
  // The backup must be written (it is async) BEFORE migrating, but `migrate` is synchronous: so take it first when an upgrade is pending.
  let backupError: string | null = null;
  try {
    const from = db.version(), known = migrations.length;
    if (from > known) { db.close(); return { status: "too-new", message: new StoreTooNewError(from, known).message }; }
    if (from > 0 && from < known) { const b = await createBackup(db, backupsDir, { reason: "pre-migration", now: o.now }); if (!b.ok) backupError = b.error; }
    const r = migrate(db, migrations, { beforeMigrate: () => { if (backupError) throw new Error(`no backup could be made first (${backupError}); your data was not changed`); } });
    const profile = loadProfile(db).status;
    const index = await rebuildIndex(db, path.join(dataDir, JOBS_DIR));
    const leftovers = (await readdir(dataDir)).filter((n) => n.startsWith(JOBS_DIR + ".import-") || n.startsWith(JOBS_DIR + ".replaced-")).sort();
    return { status: "ok", db, created: !existed || from === 0, migrated: r.ran, profile, backups: await backups(), index, leftovers };
  } catch (e) {
    db.close();
    if (e instanceof MigrationError || backupError) return { status: "upgrade-failed", message: (e as Error).message, backups: await backups() };
    return { status: "damaged", reason: `the database could not be read: ${(e as Error).message}`, backups: await backups() };
  }
}

// After the user chooses "restore": the damaged database is moved aside (never deleted), a fresh one is created, and the chosen backup is put in.
export async function recoverFromBackup(dataDir: string, backupFile: string, o: { now: Date; migrations?: Migration[] }): Promise<{ ok: true; db: Db; movedAside: string } | { ok: false; error: string }> {
  const file = path.join(dataDir, DB_FILE), aside = `${DB_FILE}.damaged-${o.now.toISOString().replace(/[:.]/g, "-")}`;
  const test = openDb(":memory:"); migrate(test, o.migrations ?? MIGRATIONS);
  const chk = await restoreBackup(test, path.join(dataDir, BACKUPS_DIR), backupFile); test.close();
  if (!chk.ok) return { ok: false, error: chk.error }; // the backup is checked on a scratch database first: a bad backup changes nothing
  for (const ext of ["", "-wal", "-shm"]) await rename(file + ext, path.join(dataDir, aside + ext)).catch(() => undefined);
  const db = openDb(file);
  migrate(db, o.migrations ?? MIGRATIONS);
  const r = await restoreBackup(db, path.join(dataDir, BACKUPS_DIR), backupFile);
  if (!r.ok) { db.close(); return { ok: false, error: r.error }; }
  return { ok: true, db, movedAside: aside };
}

// For a damaged database with NO usable backup (or when the user declines the backups): the damaged file is moved aside with a date (never deleted) and the app starts
// with an empty database. The History is rebuilt from the job folders; the profile must be entered or imported again. Only with `confirmed: true` (the screen asks).
export async function startFresh(dataDir: string, o: { now: Date; confirmed: boolean; migrations?: Migration[] }): Promise<{ ok: true; db: Db; movedAside: string } | { ok: false; error: string }> {
  if (!o.confirmed) return { ok: false, error: "starting fresh needs confirmation" };
  const file = path.join(dataDir, DB_FILE), aside = `${DB_FILE}.damaged-${o.now.toISOString().replace(/[:.]/g, "-")}`;
  for (const ext of ["", "-wal", "-shm"]) await rename(file + ext, path.join(dataDir, aside + ext)).catch(() => undefined);
  const db = openDb(file);
  migrate(db, o.migrations ?? MIGRATIONS);
  await rebuildIndex(db, path.join(dataDir, JOBS_DIR));
  return { ok: true, db, movedAside: aside };
}
