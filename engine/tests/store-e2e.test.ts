// Phase 2 seam test: the whole data lifecycle through the REAL modules in one story, on real files (no Claude, no Chrome): open a new data folder, save a profile and
// settings, run jobs through the real pipeline with the History index listening, back up on the schedule, export, lose the database, recover, import on a "second Mac",
// and finally delete everything. Each module has its own tests; this one checks that they agree with each other.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { openStore, recoverFromBackup, DB_FILE, JOBS_DIR, BACKUPS_DIR } = await import("../src/store/open.ts");
const { saveProfile, loadProfile } = await import("../src/store/profile-store.ts");
const { setSettings, getSettings } = await import("../src/store/settings-store.ts");
const { upsertJob, rebuildIndex, searchJobs, historySummary } = await import("../src/store/jobs-index.ts");
const { scheduledBackup, listBackups } = await import("../src/store/backup.ts");
const { exportAll, importExport } = await import("../src/store/export.ts");
const { deleteEverything } = await import("../src/store/delete.ts");
const { MemorySecretStore, SECRET_NAMES } = await import("../src/store/secrets.ts");
const PL = await import("../src/pipeline.ts");
const { profileToPersona } = await import("../src/profile.ts");
type Prof = import("../src/profile.ts").Profile;
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const NOW = new Date("2026-11-17T09:00:00Z"), at = (h: number) => new Date(NOW.getTime() + h * 3600_000);
const priya: Prof = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8")), ctx = profileToPersona(priya, NOW);
const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-life-"));
const macA = path.join(root, "macA", "CVApp"), macB = path.join(root, "macB", "CVApp");

const analysis = (company: string) => ({ company, role: "Marketing Executive", location: "Leeds", work_mode: "hybrid", salary_text: null, salary_min_gbp: null, seniority: "mid", years_required: 2, experience: { years: 8, basis: "dated roles" }, requirements: [{ text: "reporting", priority: "must", rating: "strong", evidence_quote: ctx.bullets[1].text.slice(0, 60), note: "" }], constraint_checks: [], focus_id: 1, focus_note: "", fit_percent: 70, fit_note: "", verdict: "apply", strengths: [], gaps: [], unverified_needed: [], injection_suspected: false, summary: "" });
let nextCompany = "Acme Retail";
const runner = async (d: string, role: string) => { writeFileSync(path.join(d, role === "analyst" ? "analysis.json" : "coach-verdict.json"), JSON.stringify(role === "analyst" ? analysis(nextCompany) : { message: "ok" })); return { code: 0, log: "" }; };

// 1. a new data folder
const a = await openStore(macA, { now: NOW }); if (a.status !== "ok") throw new Error("setup failed");
ok("1. a new data folder opens at the latest format with nothing in it", a.created && a.profile === "none");
saveProfile(a.db, priya, NOW); setSettings(a.db, { tone: "concise", accent: "forest", "telegram.enabled": true, "telegram.chatId": 4242 }, NOW);
// 2. two real jobs through the real pipeline, the index listening
const jobsA = path.join(macA, JOBS_DIR); mkdirSync(jobsA);
const plA = PL.createPipeline({ jobsDir: jobsA, profile: priya, runnerFor: () => runner as never, renderer: {} as never, fonts: {} as never, config: { accent: "oxford", showRightToWork: true, resumeProfile: "snapshot" }, now: () => NOW, onJobChange: (j) => upsertJob(a.db, j) });
for (const c of ["Acme Retail", "Larkfield Pet Supplies"]) { nextCompany = c; await plA.analyse(await plA.createJob(`An ad for a marketing role at ${c}. `.repeat(8), "text")); }
ok("2. two jobs analysed through the real pipeline appear in the History index as they happen, searchable by company, and agree with a rebuild from the folders", searchJobs(a.db).total === 2 && searchJobs(a.db, { text: "larkfield" }).total === 1 && historySummary(a.db).analysed === 2 && await (async () => { const before = JSON.stringify(searchJobs(a.db).rows); await rebuildIndex(a.db, jobsA); return JSON.stringify(searchJobs(a.db).rows) === before; })());
// 3. scheduled backups
const bdir = path.join(macA, BACKUPS_DIR);
const b1 = await scheduledBackup(a.db, bdir, NOW), b2 = await scheduledBackup(a.db, bdir, at(0.3));
const p2 = JSON.parse(JSON.stringify(priya)); p2.roles[0].bullets[0].text += " (edited)"; saveProfile(a.db, p2, at(1.5));
const b3 = await scheduledBackup(a.db, bdir, at(2));
const bl = await listBackups(bdir);
ok("3. the schedule writes a daily backup at launch, nothing within the hour, and a 'change' backup after the profile was edited", "file" in b1 && "skipped" in b2 && "file" in b3 && bl.map((b) => b.reason).join() === "change,daily");
// 4. export
const zip = path.join(root, "my-export.zip"), ex = await exportAll(a.db, jobsA, zip, { now: at(3) });
ok("4. the export holds both jobs, the profile and the History table", ex.ok && ex.jobs === 2 && (await import("../src/store/export.ts").then((m) => m.inspectExport(zip))).ok);
// 5. the database is lost (damaged); the jobs survive
a.db.close();
const dbFile = path.join(macA, DB_FILE), bytes = readFileSync(dbFile); for (let i = 100; i < Math.min(bytes.length, 2000); i++) bytes[i] = 0xff; writeFileSync(dbFile, bytes); for (const e of ["-wal", "-shm"]) rmSync(dbFile + e, { force: true });
const bad = await openStore(macA, { now: at(4) });
ok("5. the damaged database is detected at launch, with the backups offered, and the jobs folder is untouched", bad.status === "damaged" && bad.backups.length === 2 && readdirSync(jobsA).length === 2);
const rec = await recoverFromBackup(macA, bad.status === "damaged" ? bad.backups[0].file : "", { now: at(4) });
if (!rec.ok) throw new Error("recover failed: " + rec.error);
const idx = await rebuildIndex(rec.db, jobsA);
ok("6. recovery restores the newest profile (with the edit) and the settings from the backup, and the History is rebuilt from the job folders: nothing the user made is lost", loadProfile(rec.db).status === "ok" && (loadProfile(rec.db) as { profile: Prof }).profile.roles[0].bullets[0].text.endsWith("(edited)") && getSettings(rec.db).settings.accent === "forest" && idx.indexed === 2 && searchJobs(rec.db, { text: "acme" }).total === 1 && existsSync(path.join(macA, rec.movedAside)));
rec.db.close();
// 7. a second Mac imports the export
const b = await openStore(macB, { now: at(5) }); if (b.status !== "ok") throw new Error("setup B");
setSettings(b.db, { "telegram.chatId": 777 }, at(5));
const imp = await importExport({ zipFile: zip, db: b.db, jobsDir: path.join(macB, JOBS_DIR), backupsDir: path.join(macB, BACKUPS_DIR), now: at(6), confirmReplace: false });
ok("7. a second Mac imports the export: the profile (as exported, with the edit), the settings and both jobs arrive, History works, and the second Mac keeps its OWN Telegram pairing", imp.ok && imp.jobs === 2 && (loadProfile(b.db) as { profile: Prof }).profile.roles[0].bullets[0].text.endsWith("(edited)") && getSettings(b.db).settings.tone === "concise" && getSettings(b.db).settings["telegram.chatId"] === 777 && searchJobs(b.db, { text: "larkfield" }).total === 1);
// 8. delete everything on both
const secrets = new MemorySecretStore(); await secrets.set(SECRET_NAMES.claudeApiKey, "sk-ant-LIFECYCLE-CANARY"); await secrets.set(SECRET_NAMES.telegramBotToken, "999:LIFECYCLE-CANARY");
const openA = await openStore(macA, { now: at(7) }); if (openA.status !== "ok") throw new Error("reopen A");
const delA = await deleteEverything({ dataDir: macA, db: openA.db, secrets, confirmed: true, tmpDir: path.join(root, "tmp") });
const delB = await deleteEverything({ dataDir: macB, db: b.db, secrets, confirmed: true, tmpDir: path.join(root, "tmp") });
const files: string[] = []; const walk = (d: string) => { for (const n of readdirSync(d)) { const p = path.join(d, n); if (existsSync(p) && readdirSync(path.dirname(p)).includes(n)) { try { walk(p); } catch { files.push(p); } } } }; walk(root);
ok("8. delete everything on both Macs leaves nothing of the app behind: no data folder, no secret, and not one file except the export the user chose to keep", delA.ok && delB.ok && secrets.data.size === 0 && !existsSync(macA) && !existsSync(macB) && files.map((f) => path.basename(f)).join() === "my-export.zip");
rmSync(root, { recursive: true, force: true });
console.log(failures === 0 ? "\nall store-e2e tests passed" : `\n${failures} store-e2e test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
