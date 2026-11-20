// Backups of the profile and settings (phase 2e, PRD 15). Jobs are NOT backed up (they can be rerun, and their folders are their own record).
// A backup is one readable JSON file with a checksum, so it stays usable even when the SQLite file is what got damaged. The last three valid ones are kept.
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "./db.ts";
import { validateProfile } from "../profile.ts";
import { SETTINGS } from "./settings-store.ts";
import { PROFILE_FORMAT_LATEST, loadProfile } from "./profile-store.ts";
import { validateProfile2 } from "../profile-v2.ts";

export const BACKUP_FORMAT = 1;
export const KEEP_BACKUPS = 3;        // the newest three regular backups (daily, pre-update, pre-migration) ...
export const KEEP_CHANGE_BACKUPS = 1; // ... plus the newest one made because the data changed since the last backup
export const CHANGE_AFTER_MS = 3600_000, DAILY_AFTER_MS = 86400_000;
export const MAX_BACKUP_BYTES = 5_000_000; // a profile is a few tens of KB; a backup over this is refused as a sign that something is wrong
export type BackupReason = "daily" | "change" | "pre-update" | "pre-migration" | "pre-import";
type SettingRow = { key: string; value: string; updated_at: string };
type Payload = { profile: { doc: string; profile_format: number; updated_at: string } | null; settings: SettingRow[] };
type BackupFile = { backupFormat: number; createdAt: string; reason: BackupReason; sha256: string; payload: Payload };
export type BackupInfo = { file: string; createdAt: string | null; reason: BackupReason | null; valid: boolean; problem?: string; sha256?: string; newer?: boolean }; // newer: made by a newer version of the app (not usable here, never deleted here)

const sha = (p: Payload) => createHash("sha256").update(JSON.stringify(p)).digest("hex");
const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, "-");

export async function createBackup(db: Db, dir: string, o: { reason: BackupReason; now: Date }): Promise<{ ok: true; file: string } | { ok: false; error: string } | { ok: true; skipped: "nothing to back up" | "unchanged" | "profile unreadable" }> {
  const payload: Payload = {
    profile: db.get<{ doc: string; profile_format: number; updated_at: string }>("SELECT doc, profile_format, updated_at FROM profile WHERE id = 1") ?? null,
    settings: db.all<SettingRow>("SELECT key, value, updated_at FROM settings ORDER BY key"),
  };
  if (!payload.profile && !payload.settings.length) return { ok: true, skipped: "nothing to back up" };
  // A profile that does not load (damaged, or from a newer app) is NEVER backed up: the backup would pass its own checksum yet be useless, and it would push the last good one out.
  if (payload.profile && loadProfile(db).status !== "ok") return { ok: true, skipped: "profile unreadable" };
  // Same content as the newest valid backup: that data is already safe, so nothing is written (and nothing older is pushed out of the kept ones).
  const newest = (await listBackups(dir)).find((b) => b.valid);
  if (newest && newest.sha256 === sha(payload)) return { ok: true, skipped: "unchanged" };
  const body = JSON.stringify({ backupFormat: BACKUP_FORMAT, createdAt: o.now.toISOString(), reason: o.reason, sha256: sha(payload), payload } satisfies BackupFile, null, 2);
  if (Buffer.byteLength(body) > MAX_BACKUP_BYTES) return { ok: false, error: "the data to back up is unexpectedly large; no backup was made" };
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    let name = `backup-${stamp(o.now)}-${o.reason}.json`, n = 1;
    while ((await readdir(dir)).includes(name)) name = `backup-${stamp(o.now)}-${o.reason}-${++n}.json`;
    const tmp = path.join(dir, name + ".tmp");
    await writeFile(tmp, body, { mode: 0o600 });
    await rename(tmp, path.join(dir, name)); // the finished file appears all at once, never half-written
    await chmod(path.join(dir, name), 0o600);
    await prune(dir);
    return { ok: true, file: name };
  } catch (e) { return { ok: false, error: `could not write the backup: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}` }; }
}

async function readBackup(file: string): Promise<{ ok: true; backup: BackupFile } | { ok: false; problem: string; newer?: boolean }> {
  let raw: string;
  try { raw = await readFile(file, "utf8"); } catch { return { ok: false, problem: "the file cannot be read" }; }
  let b: BackupFile;
  try { b = JSON.parse(raw); } catch { return { ok: false, problem: "the file is not valid" }; }
  if (!b || typeof b !== "object" || typeof b.sha256 !== "string" || !b.payload || !Array.isArray(b.payload.settings) || typeof b.createdAt !== "string") return { ok: false, problem: "the file is incomplete" };
  if (typeof b.backupFormat !== "number" || b.backupFormat > BACKUP_FORMAT) return { ok: false, problem: "made by a newer version of the app: update the app", newer: true };
  if (sha(b.payload) !== b.sha256) return { ok: false, problem: "the file was changed or damaged (checksum does not match)" };
  return { ok: true, backup: b };
}

export async function listBackups(dir: string): Promise<BackupInfo[]> {
  const out: BackupInfo[] = [];
  for (const f of (await readdir(dir).catch(() => [] as string[])).filter((x) => /^backup-.*\.json$/.test(x))) {
    const r = await readBackup(path.join(dir, f));
    out.push(r.ok ? { file: f, createdAt: r.backup.createdAt, reason: r.backup.reason, valid: true, sha256: r.backup.sha256 } : { file: f, createdAt: null, reason: null, valid: false, problem: r.problem, ...(r.newer ? { newer: true } : {}) });
  }
  return out.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.file.localeCompare(a.file));
}

// Keeps the newest KEEP_BACKUPS valid backups. Unusable files and leftovers are removed, but only here, right after a good backup was written (so a damaged
// folder never loses the last good copy to housekeeping).
async function prune(dir: string): Promise<void> {
  const all = await listBackups(dir), valid = all.filter((b) => b.valid);
  const change = valid.filter((b) => b.reason === "change"), regular = valid.filter((b) => b.reason !== "change");
  for (const b of [...regular.slice(KEEP_BACKUPS), ...change.slice(KEEP_CHANGE_BACKUPS)]) await rm(path.join(dir, b.file), { force: true });
  for (const b of all.filter((x) => !x.valid && !x.newer)) await rm(path.join(dir, b.file), { force: true }); // a backup from a NEWER app is not ours to delete
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".tmp"))) await rm(path.join(dir, f), { force: true });
}

// WHEN to back up (PRD 15: "once a day while the app is in use", plus protection for edits in between). One pure rule, so it can be tested without timers; the app
// shell calls `scheduledBackup` at launch, every hour while it runs, after the Mac wakes, and at quit.
//   - no backup at all                                  -> daily
//   - the newest regular backup is 24 hours old or more -> daily
//   - else the newest backup of any kind is an hour old or more -> change (written only if the data really changed: unchanged data is skipped)
//   - else nothing is due.
export function backupDecision(now: Date, backups: { createdAt: string | null; reason: BackupReason | null; valid: boolean }[]): { due: false } | { due: true; reason: "daily" | "change" } {
  const valid = backups.filter((b) => b.valid && b.createdAt);
  const age = (b: { createdAt: string | null }) => now.getTime() - new Date(b.createdAt!).getTime();
  const any = valid[0], regular = valid.find((b) => b.reason !== "change" && b.reason !== "pre-migration");
  if (!any) return { due: true, reason: "daily" };
  if (!regular || age(regular) >= DAILY_AFTER_MS) return { due: true, reason: "daily" };
  if (age(any) >= CHANGE_AFTER_MS) return { due: true, reason: "change" };
  return { due: false };
}
export async function scheduledBackup(db: Db, dir: string, now: Date) {
  const d = backupDecision(now, await listBackups(dir));
  if (!d.due) return { ok: true as const, skipped: "not due" as const };
  return createBackup(db, dir, { reason: d.reason, now });
}

// Puts the profile and settings of a backup back. Everything is checked BEFORE anything changes; then both are replaced in one transaction. Jobs are untouched.
export async function restoreBackup(db: Db, dir: string, name: string): Promise<{ ok: true; profile: boolean; settings: number } | { ok: false; error: string }> {
  if (name !== path.basename(name)) return { ok: false, error: "not a backup file" };
  const r = await readBackup(path.join(dir, name));
  if (!r.ok) return { ok: false, error: r.problem };
  const { payload } = r.backup;
  if (payload.profile) {
    if (payload.profile.profile_format > PROFILE_FORMAT_LATEST) return { ok: false, error: "the profile in this backup was written by a newer version of the app: update the app" };
    let p: any; try { p = JSON.parse(payload.profile.doc); } catch { return { ok: false, error: "the profile in this backup cannot be read" }; }
    const errs = payload.profile.profile_format >= PROFILE_FORMAT_LATEST ? validateProfile2(p, { requireDates: false }) : validateProfile(p, { requireDates: false });
    if (errs.length) return { ok: false, error: `the profile in this backup is not valid: ${errs[0]}` };
  }
  const settings = payload.settings.filter((s) => typeof s.key === "string" && typeof s.value === "string" && typeof s.updated_at === "string" && (SETTINGS as Record<string, unknown>)[s.key] !== undefined);
  db.transaction(() => {
    db.exec("DELETE FROM profile; DELETE FROM settings;");
    if (payload.profile) db.run("INSERT INTO profile(id, doc, profile_format, updated_at) VALUES (1, ?, ?, ?)", payload.profile.doc, payload.profile.profile_format, payload.profile.updated_at);
    for (const s of settings) db.run("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)", s.key, s.value, s.updated_at);
  });
  return { ok: true, profile: !!payload.profile, settings: settings.length };
}
