// Phase 2d: the job index, its rebuild from job folders, History search, summary, radar input and CSV. Fixtures only; analyse() runs on a fake runner (no Claude).
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { openDb } = await import("../src/store/db.ts");
const { migrate } = await import("../src/store/migrate.ts");
const { MIGRATIONS } = await import("../src/store/schema.ts");
const { upsertJob, removeJob, rebuildIndex, searchJobs, historySummary, recentFolders, historyCsv, ftsQuery } = await import("../src/store/jobs-index.ts");
const PL = await import("../src/pipeline.ts");
const { profileToPersona } = await import("../src/profile.ts");
type J = import("../src/pipeline.ts").JobState;
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const NOW = new Date("2026-11-17T12:00:00Z");
const tmp = mkdtempSync(path.join(os.tmpdir(), "cvapp-jobs-")), jobsDir = path.join(tmp, "jobs"); mkdirSync(jobsDir);
const day = (n: number) => new Date(NOW.getTime() - n * 86400_000).toISOString();
const mkJob = (folder: string, p: Partial<J>): J => ({ id: "id-" + folder, dir: path.join(jobsDir, folder), status: "analysed", created: day(1), updated: day(1), source: "text", ...p });
const put = async (j: J, analysis?: object) => { mkdirSync(j.dir, { recursive: true }); await PL.saveStateFile(j, new Date(j.updated)); if (analysis) writeFileSync(path.join(j.dir, "analysis.json"), JSON.stringify(analysis)); };
const JOBS: J[] = [
  mkJob("acme-marketing-executive", { company: "Acme Retail", role: "Marketing Executive", verdict: "apply", fit: 80, status: "built", created: day(2) }),
  mkJob("larkfield-email-lead", { company: "Larkfield Pet Supplies", role: "Email Marketing Lead", verdict: "apply", fit: 70, status: "analysed", created: day(5) }),
  mkJob("harbour-social", { company: "Harbour & Hill Coffee", role: "Social Media Executive", verdict: "long_shot", fit: 50, status: "skipped", created: day(10) }),
  mkJob("quillon-analyst", { company: "Quillon Stationery", role: "Marketing Analyst", verdict: "skip", fit: 20, status: "analysed", created: day(40) }),
  mkJob("=cmd-injection", { company: "=HYPERLINK(\"http://x\")", role: "Role, with \"quotes\"", verdict: "apply", fit: 65, status: "failed", created: day(3), url: "https://example.com/job" }),
  mkJob("unknown-still-running", { status: "analysing", created: day(0) }),
];
for (const j of JOBS) await put(j);
const db = openDb(":memory:"); migrate(db, MIGRATIONS);

// ---------- the migration from version 1 (the first real migration test) ----------
{
  const d1 = openDb(":memory:"); migrate(d1, MIGRATIONS.slice(0, 1));
  d1.run("INSERT INTO jobs(folder,status,source,company,role,created,updated) VALUES ('old-job','built','text','Old Co','Writer','a','b')");
  const r = migrate(d1, MIGRATIONS, { beforeMigrate: () => undefined });
  ok("migration 2 on a version-1 database keeps the existing job rows and makes them searchable; their id is empty until the next rebuild", r.from === 1 && d1.get<{ company: string }>("SELECT company FROM jobs WHERE folder='old-job'")!.company === "Old Co" && d1.all("SELECT * FROM jobs_fts WHERE jobs_fts MATCH 'old*'").length === 1 && d1.get<{ id: unknown }>("SELECT id FROM jobs")!.id === null);
  d1.close();
}

// ---------- rebuild from folders ----------
mkdirSync(path.join(jobsDir, "not-a-job")); writeFileSync(path.join(jobsDir, "broken-status"), "x"); mkdirSync(path.join(jobsDir, "bad-json")); writeFileSync(path.join(jobsDir, "bad-json", "status.json"), "{nope"); mkdirSync(path.join(jobsDir, "half")); writeFileSync(path.join(jobsDir, "half", "status.json"), JSON.stringify({ id: "x" }));
const dup = mkJob("acme-copy", { id: JOBS[0].id, company: "Acme Retail", updated: day(9) }); await put(dup);
const rb = await rebuildIndex(db, jobsDir);
ok("rebuild reads every readable job folder; folders with no, broken or incomplete status files, and a second folder with the same job id, are listed as skipped with a reason, never indexed", rb.indexed === 6 && rb.skipped.map((s) => s.folder).sort().join() === "acme-copy,bad-json,broken-status,half,not-a-job" && rb.skipped.every((s) => s.reason.length > 3 && !s.reason.includes("/")) && rb.skipped.find((s) => s.folder === "acme-copy")!.reason === "same job id as another folder" && db.all("SELECT * FROM jobs").length === 6);
rmSync(path.join(jobsDir, "acme-copy"), { recursive: true });
{
  await rebuildIndex(db, jobsDir); const a = JSON.stringify(searchJobs(db, { limit: 500 }));
  const d2 = openDb(":memory:"); migrate(d2, MIGRATIONS); await rebuildIndex(d2, jobsDir); const b = JSON.stringify(searchJobs(d2, { limit: 500 })); d2.close();
  ok("rebuild twice, and from an empty database, gives exactly the same History", a === b && searchJobs(db).total === 6);
}

// ---------- search, filters, sort ----------
const names = (r: { rows: { company: string | null }[] }) => r.rows.map((x) => x.company);
ok("default order is newest first; limit and offset page through it; total counts all matches", (() => { const all = searchJobs(db); const p1 = searchJobs(db, { limit: 2 }), p2 = searchJobs(db, { limit: 2, offset: 2 }); return names(all)[0] === null && names(p1).length === 2 && p1.total === 6 && JSON.stringify([...p1.rows, ...p2.rows].map((r) => r.folder)) === JSON.stringify(all.rows.slice(0, 4).map((r) => r.folder)); })());
ok("text search matches company and role, by word start, case-insensitive, all words required: 'market' finds the marketing roles, 'acme exec' finds one, 'zzz' none", names(searchJobs(db, { text: "MARKET" })).sort().join("|") === ["Acme Retail", "Larkfield Pet Supplies", "Quillon Stationery"].sort().join("|") && searchJobs(db, { text: "acme exec" }).total === 1 && searchJobs(db, { text: "zzz" }).total === 0 && searchJobs(db, { text: "harbour & hill" }).total === 1);
ok("anything typed in the search box is safe: quotes, operators, symbols and empty text never throw (empty text means no filter)", ["\"", "AND OR NOT", "acme*", "(((", "a:b", "'; DROP TABLE jobs; --", "   ", "NEAR(", "é"].every((t) => { try { searchJobs(db, { text: t }); return true; } catch { return false; } }) && searchJobs(db, { text: "   " }).total === 6 && ftsQuery("a\"b") === '"a"* "b"*');
ok("filters by state and verdict combine; the date range filters on creation time", searchJobs(db, { status: ["built", "skipped"] }).total === 2 && searchJobs(db, { verdict: ["apply"] }).total === 3 && searchJobs(db, { verdict: ["apply"], status: ["built"] }).total === 1 && searchJobs(db, { from: day(6), to: day(1) }).total === 3);
ok("sort by fit puts the highest first and jobs with no fit last; sort by company is alphabetical and ignores case", (() => { const f = searchJobs(db, { sort: "fit" }).rows.map((r) => r.fit); const c = searchJobs(db, { sort: "company" }).rows.map((r) => r.company ?? ""); return f[0] === 80 && f[f.length - 1] === null && c.join() === [...c].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).join(); })());
ok("limit is clamped (1 to 500) and a negative offset is treated as 0", searchJobs(db, { limit: 0 }).rows.length === 1 && searchJobs(db, { limit: 99999 }).rows.length === 6 && searchJobs(db, { offset: -5 }).rows.length === 6);

// ---------- summary ----------
{
  const s = historySummary(db), s30 = historySummary(db, { since: day(30) });
  ok("summary: jobs, analysed (has a verdict), built, average fit (rounded) and the verdict split", s.jobs === 6 && s.analysed === 5 && s.built === 1 && s.averageFit === 57 && s.verdicts.apply === 3 && s.verdicts.long_shot === 1 && s.verdicts.skip === 1 && s.byStatus.analysing === 1);
  ok("summary since a date leaves out older jobs; an empty database gives zeros and a null average, not an error", s30.jobs === 5 && s30.verdicts.skip === 0 && (() => { const e = openDb(":memory:"); migrate(e, MIGRATIONS); const z = historySummary(e); e.close(); return z.jobs === 0 && z.averageFit === null && z.verdicts.apply === 0; })());
  ok("radar input: the folders of the jobs from the last 30 days, newest first (the 40-day-old job is out)", recentFolders(db, NOW).join() === ["unknown-still-running", "acme-marketing-executive", "=cmd-injection", "larkfield-email-lead", "harbour-social"].sort((a, b) => (JOBS.find((j) => j.dir.endsWith(b))!.created).localeCompare(JOBS.find((j) => j.dir.endsWith(a))!.created)).join() && !recentFolders(db, NOW).includes("quillon-analyst"));
}

// ---------- write-through, rename, removal ----------
{
  upsertJob(db, { ...JOBS[1], status: "built", fit: 72 });
  ok("updating a job changes its row and does not duplicate it", searchJobs(db).total === 6 && db.get<{ status: string; fit: number }>("SELECT status, fit FROM jobs WHERE folder='larkfield-email-lead'")!.fit === 72);
  upsertJob(db, { ...JOBS[1], dir: path.join(jobsDir, "larkfield-renamed"), company: "Larkfield Ltd" });
  ok("the folder rename after analysis MOVES the row (same job id), and search finds the new name and not the old", searchJobs(db).total === 6 && db.all("SELECT * FROM jobs WHERE folder='larkfield-email-lead'").length === 0 && searchJobs(db, { text: "larkfield ltd" }).total === 1 && searchJobs(db, { text: "pet supplies" }).total === 0);
  removeJob(db, "larkfield-renamed");
  ok("removing a job removes its row and its search entry", searchJobs(db).total === 5 && searchJobs(db, { text: "larkfield" }).total === 0);
}

// ---------- CSV ----------
{
  const csv = historyCsv(searchJobs(db, { limit: 500 }).rows), lines = csv.trim().split("\r\n");
  ok("CSV: a header and one line per job; quotes doubled, commas and quotes quoted; a cell starting with = gets a leading apostrophe so a spreadsheet never runs it as a formula; verdict and state read as words", lines[0] === "Company,Role,Date,Fit %,Verdict,State,Link,Folder" && lines.length === 6 && csv.includes("\"'=HYPERLINK(\"\"http://x\"\")\"") && csv.includes("\"Role, with \"\"quotes\"\"\"") && csv.includes("long shot") && csv.includes("2026-11-15") && !/(^|,)=/m.test(csv));
}

// ---------- the pipeline writes through it ----------
{
  const seen: J[] = [], idb = openDb(":memory:"); migrate(idb, MIGRATIONS);
  const priya = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8")), ctx = profileToPersona(priya, NOW);
  const analysis = { company: "Acme Retail", role: "Marketing Executive", location: "Leeds", work_mode: "hybrid", salary_text: null, salary_min_gbp: null, seniority: "mid", years_required: 2, experience: { years: 8, basis: "dated roles" }, requirements: [{ text: "reporting", priority: "must", rating: "strong", evidence_quote: ctx.bullets[1].text.slice(0, 60), note: "" }], constraint_checks: [], focus_id: 1, focus_note: "", fit_percent: 70, fit_note: "", verdict: "apply", strengths: [], gaps: [], unverified_needed: [], injection_suspected: false, summary: "" };
  const runner = async (d: string, role: string) => { writeFileSync(path.join(d, role === "analyst" ? "analysis.json" : "coach-verdict.json"), JSON.stringify(role === "analyst" ? analysis : { message: "ok" })); return { code: 0, log: "" }; };
  const jd = path.join(tmp, "pjobs"); mkdirSync(jd);
  const pl = PL.createPipeline({ jobsDir: jd, profile: priya, runnerFor: () => runner as never, renderer: {} as never, fonts: {} as never, config: { accent: "oxford", showRightToWork: true, resumeProfile: "snapshot" }, now: () => NOW, onJobChange: (j) => { seen.push(j); upsertJob(idb, j); } });
  const job = await pl.createJob("An ad about marketing. ".repeat(10), "text"); const a = await pl.analyse(job);
  const rows = searchJobs(idb).rows;
  ok("the pipeline reports every saved state to the index: after analysing there is ONE row (the rename moved it), with company, role, verdict and fit, matching the folder on disk", rows.length === 1 && rows[0].company === "Acme Retail" && rows[0].verdict === "apply" && rows[0].fit === 70 && rows[0].status === "analysed" && rows[0].folder === path.basename(a.job.dir) && seen.length >= 2 && searchJobs(idb, { text: "marketing exec" }).total === 1);
  const idb2 = openDb(":memory:"); migrate(idb2, MIGRATIONS); await rebuildIndex(idb2, jd);
  ok("and a rebuild from the folders gives the same row", JSON.stringify(searchJobs(idb2).rows) === JSON.stringify(rows));
  const pl2 = PL.createPipeline({ jobsDir: jd, profile: priya, runnerFor: () => runner as never, renderer: {} as never, fonts: {} as never, config: { accent: "oxford", showRightToWork: true, resumeProfile: "snapshot" }, now: () => NOW, onJobChange: () => { throw new Error("index exploded"); } });
  const j2 = await pl2.createJob("Another ad. ".repeat(20), "text"); const a2 = await pl2.analyse(j2);
  ok("an error inside the index hook never breaks a job", a2.job.status === "analysed");
  idb.close(); idb2.close();
}
db.close(); rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? "\nall jobs-index tests passed" : `\n${failures} jobs-index test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
