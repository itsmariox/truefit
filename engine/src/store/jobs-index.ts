// The job index and History queries (phase 2d). The job FOLDERS are the truth; this table only makes History fast and searchable, and can always be rebuilt from them.
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Db } from "./db.ts";
import { loadState, type JobState } from "../pipeline.ts";

const folderOf = (j: JobState) => path.basename(j.dir);

// Adds or updates one job (called after every saved job state). Keyed by the job id, so the folder rename after analysis moves the row instead of duplicating it.
export function upsertJob(db: Db, j: JobState): void {
  const folder = folderOf(j);
  db.transaction(() => {
    for (const old of db.all<{ folder: string }>("SELECT folder FROM jobs WHERE id = ? AND folder <> ?", j.id, folder)) { db.run("DELETE FROM jobs_fts WHERE folder = ?", old.folder); db.run("DELETE FROM jobs WHERE folder = ?", old.folder); }
    db.run(`INSERT INTO jobs(folder, id, status, source, url, company, role, verdict, fit, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(folder) DO UPDATE SET id=excluded.id, status=excluded.status, source=excluded.source, url=excluded.url, company=excluded.company, role=excluded.role, verdict=excluded.verdict, fit=excluded.fit, created=excluded.created, updated=excluded.updated`,
      folder, j.id, j.status, j.source, j.url ?? null, j.company ?? null, j.role ?? null, j.verdict ?? null, typeof j.fit === "number" ? Math.round(j.fit) : null, j.created, j.updated);
    db.run("DELETE FROM jobs_fts WHERE folder = ?", folder);
    db.run("INSERT INTO jobs_fts(company, role, folder) VALUES (?, ?, ?)", j.company ?? "", j.role ?? "", folder);
  });
}
export function removeJob(db: Db, folder: string): void {
  db.transaction(() => { db.run("DELETE FROM jobs_fts WHERE folder = ?", folder); db.run("DELETE FROM jobs WHERE folder = ?", folder); });
}

// Throws the whole index away and reads it again from the job folders (start-up check, or after the database was lost or restored). Folders without a readable
// status file are listed in `skipped` and left out; the index and the folders then agree exactly.
export async function rebuildIndex(db: Db, jobsDir: string): Promise<{ indexed: number; skipped: { folder: string; reason: string }[] }> {
  const jobs: JobState[] = [], skipped: { folder: string; reason: string }[] = [];
  for (const n of await readdir(jobsDir).catch(() => [] as string[])) {
    try {
      const s = await loadState(path.join(jobsDir, n));
      if (!s || typeof s.id !== "string" || typeof s.status !== "string" || typeof s.created !== "string" || typeof s.updated !== "string" || (s.source !== "text" && s.source !== "link")) throw new Error("status file is incomplete");
      jobs.push({ ...s, dir: path.join(jobsDir, n) });
    } catch (e) { const err = e as NodeJS.ErrnoException; skipped.push({ folder: n, reason: err.code === "ENOENT" || err.code === "ENOTDIR" ? "no status file" : err instanceof SyntaxError ? "status file is not valid JSON" : err.message.replace(/\/\S+/g, "…") }); }
  }
  jobs.sort((a, b) => b.updated.localeCompare(a.updated) || folderOf(a).localeCompare(folderOf(b))); // when two folders claim one job id (a copied folder) the most recently updated one wins
  const seen = new Set<string>(), unique = jobs.filter((j) => (seen.has(j.id) ? (skipped.push({ folder: folderOf(j), reason: "same job id as another folder" }), false) : (seen.add(j.id), true)));
  db.transaction(() => { db.exec("DELETE FROM jobs_fts; DELETE FROM jobs;"); });
  for (const j of unique) upsertJob(db, j);
  return { indexed: unique.length, skipped };
}

// ---------- History queries ----------
export type HistoryRow = { folder: string; id: string | null; status: string; source: string; url: string | null; company: string | null; role: string | null; verdict: string | null; fit: number | null; created: string; updated: string };
export type HistoryQuery = { text?: string; status?: string[]; verdict?: string[]; from?: string; to?: string; sort?: "newest" | "oldest" | "fit" | "company"; limit?: number; offset?: number };
const SORTS = { newest: "created DESC", oldest: "created ASC", fit: "fit IS NULL, fit DESC, created DESC", company: "COALESCE(company,'') COLLATE NOCASE ASC, created DESC" } as const;

// Search is over company and role only (the ad text is not searched). Every word must match at the start of a word; anything the user types is made safe first.
export function ftsQuery(text: string): string | null {
  const toks = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  return toks.length ? toks.map((t) => `"${t}"*`).join(" ") : null;
}
export function searchJobs(db: Db, q: HistoryQuery = {}): { rows: HistoryRow[]; total: number } {
  const where: string[] = [], args: (string | number)[] = [];
  const fts = q.text ? ftsQuery(q.text) : null;
  if (fts) { where.push("folder IN (SELECT folder FROM jobs_fts WHERE jobs_fts MATCH ?)"); args.push(fts); }
  if (q.status?.length) { where.push(`status IN (${q.status.map(() => "?").join(",")})`); args.push(...q.status); }
  if (q.verdict?.length) { where.push(`verdict IN (${q.verdict.map(() => "?").join(",")})`); args.push(...q.verdict); }
  if (q.from) { where.push("created >= ?"); args.push(q.from); }
  if (q.to) { where.push("created < ?"); args.push(q.to); }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const limit = Math.max(1, Math.min(500, Math.trunc(q.limit ?? 100))), offset = Math.max(0, Math.trunc(q.offset ?? 0));
  const rows = db.all<HistoryRow>(`SELECT folder, id, status, source, url, company, role, verdict, fit, created, updated FROM jobs ${w} ORDER BY ${SORTS[q.sort ?? "newest"]}, folder LIMIT ? OFFSET ?`, ...args, limit, offset);
  const total = Number(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM jobs ${w}`, ...args)!.n);
  return { rows, total };
}

// The History top panel (PRD 06): jobs analysed, CVs built, average fit, verdict split. `since` limits it to jobs created on or after that time.
export function historySummary(db: Db, o: { since?: string } = {}) {
  const w = o.since ? "WHERE created >= ?" : "", a = o.since ? [o.since] : [];
  const one = db.get<{ jobs: number; analysed: number; built: number; avg: number | null }>(`SELECT COUNT(*) AS jobs, SUM(verdict IS NOT NULL) AS analysed, SUM(status = 'built') AS built, AVG(fit) AS avg FROM jobs ${w}`, ...a)!;
  const split: Record<string, number> = { apply: 0, long_shot: 0, skip: 0 };
  for (const r of db.all<{ verdict: string; n: number }>(`SELECT verdict, COUNT(*) AS n FROM jobs ${w ? w + " AND" : "WHERE"} verdict IS NOT NULL GROUP BY verdict`, ...a)) split[r.verdict] = Number(r.n);
  const byStatus: Record<string, number> = {};
  for (const r of db.all<{ status: string; n: number }>(`SELECT status, COUNT(*) AS n FROM jobs ${w} GROUP BY status`, ...a)) byStatus[r.status] = Number(r.n);
  return { jobs: Number(one.jobs), analysed: Number(one.analysed ?? 0), built: Number(one.built ?? 0), averageFit: one.avg === null ? null : Math.round(Number(one.avg)), verdicts: split, byStatus };
}

// Folders of the jobs created in the last `days` days: the gap radar reads exactly these (it still reads each job's analysis from its folder).
export function recentFolders(db: Db, now: Date, days = 30): string[] {
  const since = new Date(now.getTime() - days * 86400_000).toISOString();
  return db.all<{ folder: string }>("SELECT folder FROM jobs WHERE created >= ? ORDER BY created DESC", since).map((r) => r.folder);
}

// The History table as CSV (export). Cells that a spreadsheet would run as a formula (starting with = + - @) get a leading apostrophe; quotes are doubled.
const cell = (v: unknown) => { let s = v === null || v === undefined ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function historyCsv(rows: HistoryRow[]): string {
  const head = ["Company", "Role", "Date", "Fit %", "Verdict", "State", "Link", "Folder"];
  return [head, ...rows.map((r) => [r.company, r.role, r.created.slice(0, 10), r.fit, r.verdict?.replace("_", " "), r.status.replace("_", " "), r.url, r.folder])].map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n";
}

// Every job row, no paging (for the export's History table).
export function allJobs(db: Db): HistoryRow[] {
  return db.all<HistoryRow>("SELECT folder, id, status, source, url, company, role, verdict, fit, created, updated FROM jobs ORDER BY created DESC, folder");
}
