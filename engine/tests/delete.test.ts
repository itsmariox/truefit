// Phase 2g: deleting for real (one job, all jobs and CVs, everything), refusals and safety guards, and "secrets never reach a file". Real files in temp folders.
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { openDb } = await import("../src/store/db.ts");
const { migrate } = await import("../src/store/migrate.ts");
const { MIGRATIONS } = await import("../src/store/schema.ts");
const { openStore, MARKER, DB_FILE, SECRETS_DIR } = await import("../src/store/open.ts");
const { saveProfile, loadProfile } = await import("../src/store/profile-store.ts");
const { setSettings, getSettings } = await import("../src/store/settings-store.ts");
const { rebuildIndex, searchJobs, historySummary } = await import("../src/store/jobs-index.ts");
const { createBackup, listBackups } = await import("../src/store/backup.ts");
const { exportAll } = await import("../src/store/export.ts");
const { MemorySecretStore, SECRET_NAMES } = await import("../src/store/secrets.ts");
const D = await import("../src/store/delete.ts");
const PL = await import("../src/pipeline.ts");
type Prof = import("../src/profile.ts").Profile;
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const priya: Prof = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8"));
const NOW = new Date("2026-11-17T12:00:00Z");
const roots: string[] = [];
const fresh = () => { const d = mkdtempSync(path.join(os.tmpdir(), "cvapp-del-")); roots.push(d); return d; };
const CANARY_API = "sk-ant-CANARYKEY-0123456789", CANARY_BOT = "123456:CANARY-BOT-TOKEN";
// Distinct words with no shared prefix (the search index compresses shared prefixes) and a mixed case: the search index stores LOWERCASE tokens, so every file search below is case-insensitive.
const NAMES = ["Zebracorp7Quillwort", "Hollowmere9Frostbyte", "Nimbuspatch3Ardent", "Orchardvale5Lanternfish"];
const canary = (i: number) => NAMES[i - 1];

type World = { root: string; dataDir: string; jobsDir: string; db: ReturnType<typeof openDb>; secrets: InstanceType<typeof MemorySecretStore>; tmp: string };
async function world(jobs = 3): Promise<World> {
  const root = fresh(), dataDir = path.join(root, "Application Support", "CVApp"), tmp = path.join(root, "tmp"); mkdirSync(tmp);
  const o = await openStore(dataDir, { now: NOW }); if (o.status !== "ok") throw new Error("setup");
  const db = o.db, jobsDir = path.join(dataDir, "jobs"); mkdirSync(jobsDir);
  const p = JSON.parse(JSON.stringify(priya)); p.identity.name = "Priya CANARYPROFILE Nair"; saveProfile(db, p, NOW); setSettings(db, { tone: "concise", "telegram.enabled": true, "telegram.chatId": 4242 }, NOW);
  for (let i = 1; i <= jobs; i++) {
    const f = path.join(jobsDir, `job-${i}`); mkdirSync(f);
    await PL.saveStateFile({ id: `id${i}`, dir: f, status: i === 1 ? "built" : "analysed", created: NOW.toISOString(), updated: NOW.toISOString(), source: "text", company: canary(i), role: `Role ${i}`, verdict: "apply", fit: 70 } as never, NOW);
    writeFileSync(path.join(f, "ad.md"), `Ad for ${canary(i)}\n`); writeFileSync(path.join(f, "cv.pdf"), Buffer.from("%PDF-1.7\n" + canary(i)));
  }
  await rebuildIndex(db, jobsDir);
  await createBackup(db, path.join(dataDir, "Backups"), { reason: "daily", now: NOW });
  const secrets = new MemorySecretStore(); await secrets.set(SECRET_NAMES.claudeApiKey, CANARY_API); await secrets.set(SECRET_NAMES.telegramBotToken, CANARY_BOT);
  return { root, dataDir, jobsDir, db, secrets, tmp };
}
const filesUnder = (d: string): string[] => { const out: string[] = []; const walk = (x: string) => { for (const n of readdirSync(x)) { const p = path.join(x, n); const st = lstatSync(p); if (st.isDirectory()) walk(p); else out.push(p); } }; if (existsSync(d)) walk(d); return out; };
const anyFileHas = (d: string, needle: string) => filesUnder(d).some((f) => { try { return readFileSync(f).toString("latin1").toLowerCase().includes(needle.toLowerCase()); } catch { return false; } });
const snapshot = (d: string) => filesUnder(d).map((f) => path.relative(d, f) + ":" + statSync(f).size).sort().join("|");

// ---------- secure delete in the database itself ----------
{
  const root = fresh(), f = path.join(root, "t.db"), db = openDb(f); migrate(db, MIGRATIONS);
  db.run("INSERT INTO jobs(folder,id,status,source,company,created,updated) VALUES ('c','c','built','text','Quillwortcanary1','a','b')"); db.run("INSERT INTO jobs_fts(company,role,folder) VALUES ('Quillwortcanary1','Frostbyterole','c')");
  ok("setup: the canary is really in the database files before deleting", anyFileHas(root, "quillwortcanary1") && anyFileHas(root, "frostbyterole"));
  db.run("DELETE FROM jobs"); db.run("DELETE FROM jobs_fts"); db.compact();
  ok("after deleting rows and compacting, the deleted text is gone from the database file AND its write-ahead log (secure delete)", !anyFileHas(root, "quillwortcanary1") && !anyFileHas(root, "frostbyterole"));
  db.close();
  // a database made BEFORE migration 3 (the search index still leaks deleted words), upgraded by the real migration
  const root2 = fresh(), f2 = path.join(root2, "old.db"), old = openDb(f2); migrate(old, MIGRATIONS.slice(0, 2));
  old.run("INSERT INTO jobs_fts(company,role,folder) VALUES ('Leakycompany9','Leakyrole','x')"); old.run("DELETE FROM jobs_fts"); old.compact();
  const leaked = anyFileHas(root2, "leakycompany9");
  migrate(old, MIGRATIONS); old.compact();
  ok("a database from BEFORE the fix really leaked (so the test can see the problem), and the upgrade (migration 3) removes what it had already left behind", leaked && !anyFileHas(root2, "leakycompany9") && !anyFileHas(root2, "leakyrole"));
  old.close();
}

// ---------- delete one job ----------
{
  const W = await world();
  const noConfirm = await D.deleteJob(W.db, W.jobsDir, "job-2", { confirmed: false });
  const outside = path.join(W.root, "outside"); mkdirSync(outside); writeFileSync(path.join(outside, "precious.txt"), "keep me"); symlinkSync(outside, path.join(W.jobsDir, "linked"));
  mkdirSync(path.join(W.jobsDir, "plain-folder")); writeFileSync(path.join(W.jobsDir, "plain-folder", "x.txt"), "not a job");
  const bad = await Promise.all(["../x", "a/b", "", "..", "job-2/../job-3", "linked", "plain-folder", "nope"].map((n) => D.deleteJob(W.db, W.jobsDir, n, { confirmed: true })));
  ok("deleting a job needs confirmation; a path trick, a link, a folder that is not a job and a job that does not exist are all refused, and nothing is touched", !noConfirm.ok && bad.every((r) => !r.ok) && existsSync(path.join(W.jobsDir, "job-2")) && existsSync(path.join(outside, "precious.txt")) && existsSync(path.join(W.jobsDir, "plain-folder", "x.txt")) && searchJobs(W.db).total === 3);
  await PL.saveStateFile({ id: "id3", dir: path.join(W.jobsDir, "job-3"), status: "building", created: NOW.toISOString(), updated: NOW.toISOString(), source: "text" } as never, NOW);
  const run = await D.deleteJob(W.db, W.jobsDir, "job-3", { confirmed: true });
  ok("a job that is still running is refused (stop it first)", !run.ok && /still running/.test(run.error) && existsSync(path.join(W.jobsDir, "job-3")));
  await PL.saveStateFile({ id: "id3", dir: path.join(W.jobsDir, "job-3"), status: "analysed", created: NOW.toISOString(), updated: NOW.toISOString(), source: "text", company: canary(3) } as never, NOW);
  const r = await D.deleteJob(W.db, W.jobsDir, "job-2", { confirmed: true });
  ok("deleting a job removes its folder, its row and its search entry, leaves the other jobs, and the deleted company name is gone from the database files", r.ok && !existsSync(path.join(W.jobsDir, "job-2")) && searchJobs(W.db).total === 2 && searchJobs(W.db, { text: canary(2) }).total === 0 && existsSync(path.join(W.jobsDir, "job-1")) && !anyFileHas(W.dataDir, canary(2)) && anyFileHas(W.dataDir, canary(1)));
  W.db.close();
}

// ---------- delete all jobs and CVs ----------
{
  const W = await world();
  writeFileSync(path.join(W.jobsDir, "notes.txt"), "the user's own file"); const outside = path.join(W.root, "outside"); mkdirSync(outside); writeFileSync(path.join(outside, "precious.txt"), "keep me"); symlinkSync(outside, path.join(W.jobsDir, "linked"));
  mkdirSync(path.join(W.dataDir, "jobs.import-2026-11-17T00-00-00-000Z")); writeFileSync(path.join(W.dataDir, "jobs.import-2026-11-17T00-00-00-000Z", "a"), canary(1)); mkdirSync(path.join(W.dataDir, "jobs.replaced-x"));
  mkdirSync(path.join(W.tmp, "cvapp-agent-abc")); mkdirSync(path.join(W.tmp, "cvapp-render-xyz")); mkdirSync(path.join(W.tmp, "someone-elses"));
  const before = snapshot(W.dataDir);
  const no = await D.deleteJobsAndCvs(W.db, W.jobsDir, { confirmed: false, tmpDir: W.tmp });
  await PL.saveStateFile({ id: "id2", dir: path.join(W.jobsDir, "job-2"), status: "building", created: NOW.toISOString(), updated: NOW.toISOString(), source: "text" } as never, NOW);
  const before2 = snapshot(W.dataDir), busy = await D.deleteJobsAndCvs(W.db, W.jobsDir, { confirmed: true, tmpDir: W.tmp });
  ok("deleting all jobs needs confirmation and is refused while any job is running; in both cases nothing changes", !no.ok && !busy.ok && /still running/.test(busy.error) && snapshot(W.dataDir) === before2 && before !== "");
  await PL.saveStateFile({ id: "id2", dir: path.join(W.jobsDir, "job-2"), status: "analysed", created: NOW.toISOString(), updated: NOW.toISOString(), source: "text", company: canary(2) } as never, NOW);
  const r = await D.deleteJobsAndCvs(W.db, W.jobsDir, { confirmed: true, tmpDir: W.tmp });
  ok("all job folders and records are removed, with import leftovers and this app's temporary folders (other people's temp folders are not touched)", r.ok && r.jobs === 3 && r.tempRemoved === 2 && readdirSync(W.jobsDir).sort().join() === "linked,notes.txt" && !existsSync(path.join(W.dataDir, "jobs.import-2026-11-17T00-00-00-000Z")) && !existsSync(path.join(W.dataDir, "jobs.replaced-x")) && existsSync(path.join(W.tmp, "someone-elses")) && !existsSync(path.join(W.tmp, "cvapp-agent-abc")));
  ok("files that are not jobs (the user's own note) and a link out of the folder are left alone and reported; the link's target is never followed", r.ok && r.left.sort().join() === "linked,notes.txt" && existsSync(path.join(outside, "precious.txt")) && lstatSync(path.join(W.jobsDir, "linked")).isSymbolicLink());
  ok("History is empty, the deleted ad and company names are gone from every file of the data folder, and the profile, settings, backups and secrets are untouched", searchJobs(W.db).total === 0 && historySummary(W.db).jobs === 0 && ![1, 2, 3].some((i) => anyFileHas(W.dataDir, canary(i))) && loadProfile(W.db).status === "ok" && getSettings(W.db).settings.tone === "concise" && (await listBackups(path.join(W.dataDir, "Backups"))).length === 1 && (await W.secrets.get(SECRET_NAMES.claudeApiKey)) === CANARY_API);
  W.db.close();
}

// ---------- delete everything ----------
{
  const W = await world(); const before = snapshot(W.dataDir);
  const no = await D.deleteEverything({ dataDir: W.dataDir, db: W.db, secrets: W.secrets, confirmed: false, tmpDir: W.tmp });
  ok("deleting everything needs confirmation; without it nothing is touched", !no.ok && snapshot(W.dataDir) === before && W.secrets.data.size === 2);
  // guards on WHICH folder
  const dangerous = [os.homedir(), "/", path.join(W.root, "Documents"), W.root.split(path.sep).slice(0, 2).join(path.sep) || "/"];
  const docs = path.join(W.root, "Documents"); mkdirSync(docs); writeFileSync(path.join(docs, "my-thesis.docx"), "precious");
  const guard = await Promise.all(dangerous.map((d) => D.deleteEverything({ dataDir: d, db: W.db, secrets: W.secrets, confirmed: true, tmpDir: W.tmp })));
  ok("it refuses any folder that is not the app's own data folder (the home folder, the root, a Documents folder without the marker), and deletes nothing", guard.every((g) => !g.ok) && existsSync(path.join(docs, "my-thesis.docx")) && snapshot(W.dataDir) === before && W.secrets.data.size === 2);
  const missing = await D.deleteEverything({ dataDir: path.join(W.root, "nothing-here", "x", "y"), db: W.db, secrets: W.secrets, confirmed: true, tmpDir: W.tmp });
  ok("a folder that does not exist is a plain error", !missing.ok && /does not exist/.test(missing.error));
  // a running job
  await PL.saveStateFile({ id: "id2", dir: path.join(W.jobsDir, "job-2"), status: "building", created: NOW.toISOString(), updated: NOW.toISOString(), source: "text" } as never, NOW);
  const busyR = await D.deleteEverything({ dataDir: W.dataDir, db: W.db, secrets: W.secrets, confirmed: true, tmpDir: W.tmp });
  ok("it is refused while a job is running, with nothing deleted", !busyR.ok && /still running/.test(busyR.error) && W.secrets.data.size === 2 && loadProfile(W.db).status === "ok");
  await PL.saveStateFile({ id: "id2", dir: path.join(W.jobsDir, "job-2"), status: "analysed", created: NOW.toISOString(), updated: NOW.toISOString(), source: "text", company: canary(2) } as never, NOW);
  // keychain refuses
  W.secrets.failDelete.add(SECRET_NAMES.telegramBotToken); const snapBeforeKeychain = snapshot(W.dataDir);
  const kc = await D.deleteEverything({ dataDir: W.dataDir, db: W.db, secrets: W.secrets, confirmed: true, tmpDir: W.tmp });
  ok("if the Keychain refuses to remove an item, NOTHING in the data folder is deleted, the user is told which Keychain item failed and which were already removed, and to try again", !kc.ok && /Keychain/.test(kc.error) && /already removed/.test(kc.error) && snapshot(W.dataDir) === snapBeforeKeychain && loadProfile(W.db).status === "ok" && existsSync(path.join(W.dataDir, "Backups")) && searchJobs(W.db).total === 3);
  W.secrets.failDelete.clear();
  // leftovers of the app's own making + a user file + a link
  writeFileSync(path.join(W.dataDir, "my-notes.txt"), "mine"); mkdirSync(path.join(W.dataDir, "jobs.replaced-old")); writeFileSync(path.join(W.dataDir, `${DB_FILE}.damaged-2026-11-16`), canary(1));
  mkdirSync(path.join(W.tmp, "cvapp-agent-left"));
  const r = await D.deleteEverything({ dataDir: W.dataDir, db: W.db, secrets: W.secrets, confirmed: true, tmpDir: W.tmp });
  ok("delete everything removes the database and its log files, the damaged copy set aside, backups, all jobs and import leftovers, and this app's temp folders", r.ok && ["app.db", "Backups", "jobs", "jobs.replaced-old", `${DB_FILE}.damaged-2026-11-16`].every((n) => r.removed.includes(n)) && r.tempRemoved === 1 && !existsSync(path.join(W.dataDir, "Backups")) && !existsSync(path.join(W.dataDir, "jobs")) && !existsSync(path.join(W.dataDir, DB_FILE)));
  ok("on the retry the remaining Keychain item is removed too: both the Claude API key and the Telegram bot token are gone (the first one went on the first attempt)", r.ok && r.secretsRemoved.join() === SECRET_NAMES.telegramBotToken && W.secrets.data.size === 0);
  { const S = new MemorySecretStore(); await S.set(SECRET_NAMES.openaiPlan, "tokens"); const W5 = await world(1); let sawSecret = false;
    const r5 = await D.deleteEverything({ dataDir: W5.dataDir, db: W5.db, secrets: S, confirmed: true, tmpDir: W5.tmp, beforeSecrets: async () => { sawSecret = (await S.get(SECRET_NAMES.openaiPlan)) === "tokens"; return "ChatGPT could not be told to end the connection"; } });
    ok("a 'before the secrets are deleted' step runs while the saved tokens still exist (so the ChatGPT session can be ended at OpenAI), its warning is reported, and the secrets are then removed", r5.ok && sawSecret && r5.warnings.includes("ChatGPT could not be told to end the connection") && S.data.size === 0); }
  { const S = new MemorySecretStore(); const W6 = await world(1); const r6 = await D.deleteEverything({ dataDir: W6.dataDir, db: W6.db, secrets: S, confirmed: true, tmpDir: W6.tmp, beforeSecrets: async () => { throw new Error("boom"); } });
    ok("a 'before' step that throws is only a warning: everything is still deleted", r6.ok && r6.warnings.length === 1 && /boom/.test(r6.warnings[0])); }
  { const S = new MemorySecretStore(); for (const n of Object.values(SECRET_NAMES)) await S.set(n, "secret-" + n); const W4 = await world(1); const r4 = await D.deleteEverything({ dataDir: W4.dataDir, db: W4.db, secrets: S, confirmed: true, tmpDir: W4.tmp }); ok("in one go, EVERY secret is reported removed (Claude key, Telegram token, OpenAI key, ChatGPT sign-in, host id)", r4.ok && r4.secretsRemoved.sort().join() === Object.values(SECRET_NAMES).sort().join() && S.data.size === 0); }
  ok("a file the user put in the data folder is NOT deleted and is reported; the folder stays because it is not empty; the marker is gone", r.ok && r.left.join() === "my-notes.txt" && existsSync(path.join(W.dataDir, "my-notes.txt")) && !existsSync(path.join(W.dataDir, MARKER)) && readdirSync(W.dataDir).join() === "my-notes.txt");
  ok("no trace of the profile, the company names, the API key or the bot token remains anywhere under the data folder", !["CANARYPROFILE", canary(1), canary(2), canary(3), CANARY_API, CANARY_BOT].some((c) => anyFileHas(W.root, c)));
  const W2 = await world(1); const r2 = await D.deleteEverything({ dataDir: W2.dataDir, db: W2.db, secrets: W2.secrets, confirmed: true, tmpDir: W2.tmp });
  ok("with nothing of the user's own in it, the data folder itself is removed", r2.ok && r2.left.length === 0 && !existsSync(W2.dataDir));
  const W3 = await world(1); const outside = path.join(W3.root, "outside"); mkdirSync(outside); writeFileSync(path.join(outside, "precious.txt"), "keep me");
  W3.db.close(); rmSync(path.join(W3.dataDir, "jobs"), { recursive: true }); symlinkSync(outside, path.join(W3.dataDir, "jobs"));
  const W3db = openDb(path.join(W3.dataDir, DB_FILE));
  const r3 = await D.deleteEverything({ dataDir: W3.dataDir, db: W3db, secrets: W3.secrets, confirmed: true, tmpDir: W3.tmp });
  ok("a 'jobs' entry that is a link to somewhere else is removed as a link; what it points to is never deleted", r3.ok && existsSync(path.join(outside, "precious.txt")) && !existsSync(path.join(W3.dataDir, "jobs")));
}

// ---------- the secrets folder and the last cleanup step (phase 4d) ----------
{
  const W = await world(1); const sdir = path.join(W.dataDir, SECRETS_DIR); mkdirSync(sdir); writeFileSync(path.join(sdir, "claude-api-key.bin"), "ciphertext");
  let calledAfterFilesGone = false;
  const r = await D.deleteEverything({ dataDir: W.dataDir, db: W.db, secrets: W.secrets, confirmed: true, tmpDir: W.tmp, afterFiles: async () => { calledAfterFilesGone = !existsSync(sdir) && !existsSync(path.join(W.dataDir, DB_FILE)); return "the Keychain item could not be removed"; } });
  ok("'Delete everything' removes the secrets folder too, runs the last cleanup step (the Keychain item) only AFTER the files are gone, and reports a failure of that step as a warning instead of aborting", r.ok && r.removed.includes(SECRETS_DIR) && calledAfterFilesGone && r.warnings.join() === "the Keychain item could not be removed" && !existsSync(sdir));
  const W2 = await world(1); const r2 = await D.deleteEverything({ dataDir: W2.dataDir, db: W2.db, secrets: W2.secrets, confirmed: true, tmpDir: W2.tmp, afterFiles: async () => { throw new Error("boom"); } });
  ok("a last cleanup step that throws is only a warning; everything else was already deleted", r2.ok && r2.warnings.length === 1 && /boom/.test(r2.warnings[0]) && !existsSync(W2.dataDir));
}
// ---------- secrets never reach a file ----------
{
  const W = await world(); const exp = path.join(W.root, "export.zip");
  await exportAll(W.db, W.jobsDir, exp, { now: NOW }); await createBackup(W.db, path.join(W.dataDir, "Backups"), { reason: "pre-update", now: new Date(NOW.getTime() + 1000) }); setSettings(W.db, { tone: "neutral" }, NOW); W.db.compact();
  const z = unzipSync(new Uint8Array(readFileSync(exp)));
  ok("after saving, backing up and exporting, neither secret appears in any file of the data folder (database, log, backups, jobs) nor inside the export zip", !anyFileHas(W.dataDir, CANARY_API) && !anyFileHas(W.dataDir, CANARY_BOT) && Object.entries(z).every(([n, b]) => n.endsWith(".pdf") || (!strFromU8(b).includes(CANARY_API) && !strFromU8(b).includes(CANARY_BOT))));
  W.db.close();
}
for (const r of roots) rmSync(r, { recursive: true, force: true });
console.log(failures === 0 ? "\nall delete tests passed" : `\n${failures} delete test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
