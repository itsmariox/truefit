// Deleting data for real (phase 2g, PRD 15 "Delete is real" and 14 Settings > Data). Three levels:
//   deleteJob            one job (History, with a confirm saying it cannot be undone)
//   deleteJobsAndCvs     every job record and file, plus temporary files; the profile, settings and backups stay
//   deleteEverything     all of the above, plus profile, settings, backups, the Keychain items and the Telegram link
// The typed confirmation is collected by the screen; these functions only run with `confirmed: true`. They refuse while a job is running (the shell stops jobs
// first), refuse any folder that is not the app's own data folder, delete only what the app itself created, and never follow a link out of the folder.
import { lstat, readdir, rm, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Db } from "./db.ts";
import { removeJob } from "./jobs-index.ts";
import { loadState } from "../pipeline.ts";
import { SECRET_NAMES, type SecretStore } from "./secrets.ts";
import { BACKUPS_DIR, DB_FILE, JOBS_DIR, MARKER, SECRETS_DIR, TELEGRAM_DIR } from "./open.ts";

const NAME = /^[a-z0-9][a-z0-9._-]*$/i;
export const RUNNING = new Set(["analysing", "building"]);
export type DeleteResult<T> = ({ ok: true } & T) | { ok: false; error: string };

async function isLink(p: string) { try { return (await lstat(p)).isSymbolicLink(); } catch { return false; } }
async function isDir(p: string) { try { return (await lstat(p)).isDirectory(); } catch { return false; } }

// A job folder is a plain folder (not a link) with a readable status file.
export async function jobFolders(jobsDir: string): Promise<{ jobs: { folder: string; status: string }[]; others: string[] }> {
  const jobs: { folder: string; status: string }[] = [], others: string[] = [];
  for (const n of await readdir(jobsDir).catch(() => [] as string[])) {
    const p = path.join(jobsDir, n);
    if (n.startsWith(".") || !NAME.test(n) || await isLink(p) || !(await isDir(p))) { others.push(n); continue; }
    try { const s = await loadState(p); if (typeof s?.status !== "string") throw 0; jobs.push({ folder: n, status: s.status }); } catch { others.push(n); }
  }
  return { jobs, others };
}
export const runningJobs = (jobs: { folder: string; status: string }[]) => jobs.filter((j) => RUNNING.has(j.status)).map((j) => j.folder);

// Temporary files this app leaves in the system temp folder if it was killed mid-job (agent working folders, the PDF renderer's scratch folders).
export async function sweepTemp(tmpDir = os.tmpdir()): Promise<number> {
  let n = 0;
  for (const f of await readdir(tmpDir).catch(() => [] as string[])) if (/^cvapp-(agent|render|pdf|live-gate)-/.test(f)) { await rm(path.join(tmpDir, f), { recursive: true, force: true }); n++; }
  return n;
}

export async function deleteJob(db: Db, jobsDir: string, folder: string, o: { confirmed: boolean }): Promise<DeleteResult<{ folder: string }>> {
  if (!o.confirmed) return { ok: false, error: "deleting a job needs confirmation" };
  if (folder !== path.basename(folder) || !NAME.test(folder)) return { ok: false, error: "not a job folder" };
  const p = path.join(jobsDir, folder);
  if (await isLink(p) || !(await isDir(p))) return { ok: false, error: "that job does not exist" };
  let status: string; try { status = (await loadState(p)).status; } catch { return { ok: false, error: "that folder is not a job" }; } // never remove a folder that is not a job
  if (RUNNING.has(status)) return { ok: false, error: "this job is still running: stop it first" };
  await rm(p, { recursive: true, force: true });
  removeJob(db, folder); db.compact();
  return { ok: true, folder };
}

export async function deleteJobsAndCvs(db: Db, jobsDir: string, o: { confirmed: boolean; tmpDir?: string }): Promise<DeleteResult<{ jobs: number; left: string[]; tempRemoved: number }>> {
  if (!o.confirmed) return { ok: false, error: "deleting all jobs needs confirmation" };
  const { jobs, others } = await jobFolders(jobsDir), busy = runningJobs(jobs);
  if (busy.length) return { ok: false, error: `${busy.length} job(s) are still running: stop them first` };
  for (const j of jobs) await rm(path.join(jobsDir, j.folder), { recursive: true, force: true });
  for (const n of await readdir(path.dirname(jobsDir)).catch(() => [] as string[])) if (n.startsWith(path.basename(jobsDir) + ".import-") || n.startsWith(path.basename(jobsDir) + ".replaced-")) await rm(path.join(path.dirname(jobsDir), n), { recursive: true, force: true });
  db.transaction(() => { db.exec("DELETE FROM jobs_fts; DELETE FROM jobs;"); });
  db.compact();
  return { ok: true, jobs: jobs.length, left: others.filter((n) => !n.startsWith(".")), tempRemoved: await sweepTemp(o.tmpDir) };
}

export type EverythingResult = { removed: string[]; left: string[]; secretsRemoved: string[]; tempRemoved: number; warnings: string[] };
export async function deleteEverything(o: { dataDir: string; db: Db; secrets: SecretStore; confirmed: boolean; tmpDir?: string; beforeSecrets?: () => Promise<string | null> /* e.g. ends the ChatGPT session at OpenAI while the saved tokens still exist; returns a warning text when it could not */; afterFiles?: () => Promise<string | null> /* e.g. removes the Keychain item that holds the secret-file key; returns a warning text when it could not */ }): Promise<DeleteResult<EverythingResult>> {
  if (!o.confirmed) return { ok: false, error: "deleting everything needs confirmation" };
  const dir = path.resolve(o.dataDir), entries = await readdir(dir).catch(() => null);
  if (!entries) return { ok: false, error: "the data folder does not exist" };
  // Only the app's own data folder: it must carry the marker or hold the database. Never a home folder, a root or any other folder.
  if (dir === path.parse(dir).root || dir === os.homedir() || dir.split(path.sep).filter(Boolean).length < 3 || !(entries.includes(MARKER) || entries.includes(DB_FILE))) return { ok: false, error: "that is not the app's data folder; nothing was deleted" };
  const { jobs } = await jobFolders(path.join(dir, JOBS_DIR)), busy = runningJobs(jobs);
  if (busy.length) return { ok: false, error: `${busy.length} job(s) are still running: stop them first` };
  const warnings: string[] = [];
  if (o.beforeSecrets) { try { const w = await o.beforeSecrets(); if (w) warnings.push(w); } catch (e) { warnings.push(`a first cleanup step failed: ${(e as Error).message.slice(0, 120)}`); } }
  // Secrets first: if the Keychain refuses, NOTHING else is touched, so the user can simply try again.
  const secretsRemoved: string[] = [];
  for (const name of Object.values(SECRET_NAMES)) {
    try { if (await o.secrets.delete(name)) secretsRemoved.push(name); }
    catch { return { ok: false, error: `could not remove "${name}" from the Keychain; no data was deleted from the folder${secretsRemoved.length ? ` (already removed from the Keychain: ${secretsRemoved.join(", ")})` : ""}: try again` }; }
  }
  o.db.close();
  const mine = (n: string) => n === DB_FILE || n === DB_FILE + "-wal" || n === DB_FILE + "-shm" || n.startsWith(DB_FILE + ".damaged-") || n === BACKUPS_DIR || n === SECRETS_DIR || n === TELEGRAM_DIR || n === "notices.json" || n === JOBS_DIR || n.startsWith(JOBS_DIR + ".import-") || n.startsWith(JOBS_DIR + ".replaced-");
  const removed: string[] = [], left: string[] = [];
  for (const n of entries) {
    if (n === MARKER) continue;
    if (!mine(n)) { left.push(n); continue; }
    const p = path.join(dir, n);
    await rm(p, { recursive: !(await isLink(p)), force: true }); // a link is removed as a link, never followed
    removed.push(n);
  }
  await rm(path.join(dir, MARKER), { force: true });
  await rmdir(dir).catch(() => undefined); // removed only when empty: files the user put there are never deleted
  if (o.afterFiles) { try { const w = await o.afterFiles(); if (w) warnings.push(w); } catch (e) { warnings.push(`a last cleanup step failed: ${(e as Error).message.slice(0, 120)}`); } }
  return { ok: true, removed, left, secretsRemoved, tempRemoved: await sweepTemp(o.tmpDir), warnings };
}
