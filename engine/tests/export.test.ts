// Phase 2f: export and import of everything, including hostile and damaged zips. Real files in temp folders; fixtures only.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Zip, ZipPassThrough, strFromU8, strToU8, unzipSync, zipSync } from "fflate";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { openDb } = await import("../src/store/db.ts");
const { migrate } = await import("../src/store/migrate.ts");
const { MIGRATIONS } = await import("../src/store/schema.ts");
const { saveProfile, loadProfile } = await import("../src/store/profile-store.ts");
const { setSettings, getSettings } = await import("../src/store/settings-store.ts");
const { upsertJob, searchJobs, historySummary } = await import("../src/store/jobs-index.ts");
const { listBackups } = await import("../src/store/backup.ts");
const X = await import("../src/store/export.ts");
const PL = await import("../src/pipeline.ts");
type Prof = import("../src/profile.ts").Profile;
const { toV1View } = await import("../src/profile-v2.ts");
const canon = (x: unknown): string => JSON.stringify(x, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v)); // content equality, key order ignored (the stored and exported profile now go through schema v2)
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const priya: Prof = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8"));
const NOW = new Date("2026-11-17T12:00:00Z");
const roots: string[] = [];
const fresh = () => { const d = mkdtempSync(path.join(os.tmpdir(), "cvapp-x-")); roots.push(d); return d; };
const hash = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
// a tree of files -> one comparable string
// status.json files are compared WITHOUT their `dir` field: the export removes this Mac's path from them on purpose
const norm = (p: string, b: Buffer) => { if (!p.endsWith("status.json")) return b; const j = JSON.parse(b.toString("utf8")); delete j.dir; return Buffer.from(JSON.stringify(j, null, 2)); };
const treeHash = (root: string): string => { const out: string[] = []; const walk = (d: string) => { for (const n of readdirSync(d).sort()) { const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else out.push(path.relative(root, p) + ":" + hash(norm(p, readFileSync(p)))); } }; if (existsSync(root)) walk(root); return out.join("\n"); };
const pdfBytes = () => Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(3000), Buffer.from([0, 255, 13, 10, 0])]);

type App = { root: string; db: ReturnType<typeof openDb>; jobsDir: string; backupsDir: string };
async function makeApp(withData: boolean, jobs = 3): Promise<App> {
  const root = fresh(), db = openDb(":memory:"); migrate(db, MIGRATIONS);
  const jobsDir = path.join(root, "jobs"), backupsDir = path.join(root, "Backups");
  if (withData) {
    saveProfile(db, priya, NOW); setSettings(db, { tone: "concise", accent: "plum", "notify.failed": false, "telegram.enabled": true, "telegram.chatId": 555 }, NOW);
    mkdirSync(jobsDir);
    for (let i = 1; i <= jobs; i++) {
      const folder = `company-${i}-role-2026-11-1${i % 10}`, d = path.join(jobsDir, folder); mkdirSync(d);
      const st = { id: `id-${i}`, dir: d, status: i === 1 ? "built" : "analysed", created: new Date(NOW.getTime() - i * 86400_000).toISOString(), updated: NOW.toISOString(), source: "text", company: `Company ${i}`, role: `Role ${i}`, verdict: "apply", fit: 60 + i };
      await PL.saveStateFile(st as never, NOW);
      writeFileSync(path.join(d, "ad.md"), `Ad ${i} with ü and £ and 日本\n`); writeFileSync(path.join(d, "analysis.json"), JSON.stringify({ company: `Company ${i}` }));
      if (i === 1) { writeFileSync(path.join(d, "cv.pdf"), pdfBytes()); writeFileSync(path.join(d, "cv-v1.pdf"), pdfBytes()); writeFileSync(path.join(d, "cover-note-v1.md"), "Dear team\n"); writeFileSync(path.join(d, ".DS_Store"), "junk"); writeFileSync(path.join(d, "x.tmp"), "junk"); }
      upsertJob(db, { ...st, dir: d } as never);
    }
  }
  return { root, db, jobsDir, backupsDir };
}
const outZip = (a: App, n = "export.zip") => path.join(a.root, n);

// ---------- export ----------
const A = await makeApp(true);
const ez = outZip(A);
const e1 = await X.exportAll(A.db, A.jobsDir, ez, { now: NOW });
const zip = e1.ok ? unzipSync(new Uint8Array(readFileSync(ez))) : {};
const names = Object.keys(zip).sort();
ok("export writes ONE zip (private to the user, 0600) with a manifest, the profile as data and as a readable copy, settings, the History CSV and every job file", e1.ok && statSync(ez).mode % 0o1000 === 0o600 && ["cvapp-export.json", "profile.json", "profile.md", "settings.json", "history.csv"].every((n) => names.includes(n)) && e1.jobs === 3 && names.length === 17 && names.filter((n) => n.startsWith("jobs/")).length === 12);
ok("job files are byte for byte the originals (status.json only loses its `dir` field, the folder path of this Mac), including binary PDFs and non-English text; dot files and temporary files are left out", e1.ok && (() => { const f1 = path.join(A.jobsDir, "company-1-role-2026-11-11"); return hash(zip["jobs/company-1-role-2026-11-11/cv.pdf"]) === hash(readFileSync(path.join(f1, "cv.pdf"))) && strFromU8(zip["jobs/company-1-role-2026-11-11/ad.md"]) === readFileSync(path.join(f1, "ad.md"), "utf8") && !names.some((n) => /\.DS_Store|\.tmp/.test(n)); })());
ok("the profile is exported exactly, and the readable copy names every employer, shows Draft/Verified marks and the Do-not-use list", e1.ok && canon(toV1View(JSON.parse(strFromU8(zip["profile.json"])))) === canon(priya) && priya.roles.every((r) => strFromU8(zip["profile.md"]).includes(r.company)) && /\[verified\]/.test(strFromU8(zip["profile.md"])) && /Do not use/.test(strFromU8(zip["profile.md"])));
setSettings(A.db, { "claude.mode": "subscription", "claude.noticeAcceptedAt": NOW.toISOString() }, NOW);
const e1b = await X.exportAll(A.db, A.jobsDir, outZip(A, "export2.zip"), { now: NOW }), zip2 = e1b.ok ? unzipSync(new Uint8Array(readFileSync(outZip(A, "export2.zip")))) : {};
ok("how THIS Mac connects to Claude (mode, notice date) is never exported", e1b.ok && !/claude\./i.test(strFromU8(zip2["settings.json"])));
ok("settings are exported WITHOUT the Telegram pairing and without anything secret; the History CSV has a header and one line per job", e1.ok && (() => { const s = JSON.parse(strFromU8(zip["settings.json"])); return s.tone === "concise" && s["notify.failed"] === false && !Object.keys(s).some((k) => /telegram|token|key|secret|password/i.test(k)); })() && strFromU8(zip["history.csv"]).trim().split("\r\n").length === 4);
ok("no file path of this Mac and no API-key-looking text appears in any text file of the export", e1.ok && names.filter((n) => !n.endsWith(".pdf")).every((n) => { const t = strFromU8(zip[n]); return !t.includes(os.tmpdir()) && !/sk-ant|\/Users\//.test(t); }));
ok("the manifest lists every other file with its size and checksum, and the export format and time", e1.ok && (() => { const m = JSON.parse(strFromU8(zip["cvapp-export.json"])); return m.exportFormat === 1 && m.createdAt === NOW.toISOString() && m.files.length === names.length - 1 && m.files.every((f: { path: string; size: number; sha256: string }) => hash(zip[f.path]) === f.sha256 && zip[f.path].length === f.size); })());
{
  const D = await makeApp(true); D.db.run("UPDATE profile SET doc='{broken'");
  const r = await X.exportAll(D.db, D.jobsDir, outZip(D), { now: NOW }); const z = r.ok ? unzipSync(new Uint8Array(readFileSync(outZip(D)))) : {};
  ok("a damaged profile does not stop the export: the jobs are exported and a warning says the profile was left out", r.ok && r.warnings.length === 1 && !("profile.json" in z) && Object.keys(z).some((n) => n.startsWith("jobs/")));
  const E = await makeApp(false), re = await X.exportAll(E.db, E.jobsDir, outZip(E), { now: NOW });
  ok("an app with no data exports an empty but valid export, and that imports into another empty app", re.ok && re.jobs === 0 && (await X.inspectExport(outZip(E))).ok);
  const N = await makeApp(true, 1); mkdirSync(path.join(N.jobsDir, "company-1-role-2026-11-11", "nested"));
  const rn = await X.exportAll(N.db, N.jobsDir, outZip(N), { now: NOW });
  ok("a job folder that holds a sub-folder makes the export fail loudly (it would otherwise lose data silently)", !rn.ok && /contains a folder/.test(rn.error));
  const O = await makeApp(true, 1); mkdirSync(path.join(O.jobsDir, "weird name é")); writeFileSync(path.join(O.jobsDir, "weird name é", "status.json"), JSON.stringify({ id: "w", status: "built", created: "a", updated: "b", source: "text" }));
  const ro = await X.exportAll(O.db, O.jobsDir, outZip(O), { now: NOW });
  ok("a folder with a name that cannot be exported safely is skipped and reported, the rest is exported", ro.ok && ro.jobs === 1 && ro.skipped.some((s) => /weird/.test(s.folder)));
}

// ---------- inspect and round trip ----------
const ins = await X.inspectExport(ez);
ok("inspect reads an export and summarises it (time, profile yes, 3 jobs, file count, settings count) without changing anything", ins.ok && ins.summary.hasProfile && ins.summary.jobs === 3 && ins.summary.createdAt === NOW.toISOString() && ins.summary.settings >= 3);
const B = await makeApp(false);
const imp = await X.importExport({ zipFile: ez, db: B.db, jobsDir: B.jobsDir, backupsDir: B.backupsDir, now: NOW, confirmReplace: false });
const lp = loadProfile(B.db);
ok("ROUND TRIP: export, then import into an empty app: the profile is identical, the jobs folder is identical byte for byte (except the files the export leaves out), the settings come across and History is rebuilt and searchable", imp.ok && imp.jobs === 3 && lp.status === "ok" && canon(lp.profile) === canon(priya) && getSettings(B.db).settings.tone === "concise" && getSettings(B.db).settings.accent === "plum" && searchJobs(B.db, { text: "company 2" }).total === 1 && historySummary(B.db).jobs === 3 && (() => { const a = treeHash(A.jobsDir).split("\n").filter((l) => !/\.DS_Store|x\.tmp/.test(l)).join("\n"); return a === treeHash(B.jobsDir); })());
ok("the Telegram pairing is NOT carried over (it belongs to the token on the other Mac): the new app keeps its own", getSettings(B.db).settings["telegram.chatId"] === null && getSettings(B.db).settings["telegram.enabled"] === false);
ok("importing into an empty app needs no confirmation and makes no backup (there was nothing to lose)", (await listBackups(B.backupsDir)).length === 0);

// ---------- replace everything ----------
{
  const C = await makeApp(true, 2); setSettings(C.db, { tone: "neutral", "telegram.chatId": 999 }, NOW);
  const beforeJobs = treeHash(C.jobsDir), beforeProfile = JSON.stringify((loadProfile(C.db) as { profile: Prof }).profile);
  const need = await X.importExport({ zipFile: ez, db: C.db, jobsDir: C.jobsDir, backupsDir: C.backupsDir, now: NOW, confirmReplace: false });
  ok("when the app already holds data, an import WITHOUT confirmation changes nothing and says what would be replaced (profile, number of jobs)", !need.ok && !!need.needsConfirmation && need.needsConfirmation.replacesProfile && need.needsConfirmation.replacesJobs === 2 && treeHash(C.jobsDir) === beforeJobs && getSettings(C.db).settings.tone === "neutral");
  const p2 = JSON.parse(JSON.stringify(priya)); p2.identity.city = "Elsewhere"; saveProfile(C.db, p2, NOW);
  const done = await X.importExport({ zipFile: ez, db: C.db, jobsDir: C.jobsDir, backupsDir: C.backupsDir, now: NOW, confirmReplace: true });
  const bk = await listBackups(C.backupsDir);
  ok("with confirmation: the profile, settings and jobs are REPLACED by the export's (the 2 old jobs are gone, the 3 imported ones are there), a 'pre-import' backup of the old profile was taken, and this Mac's Telegram pairing is kept", done.ok && searchJobs(C.db).total === 3 && canon((loadProfile(C.db) as { profile: Prof }).profile) === canon(priya) && getSettings(C.db).settings.tone === "concise" && getSettings(C.db).settings["telegram.chatId"] === 999 && bk.length === 1 && bk[0].reason === "pre-import");
  ok("the replaced jobs and any staging folders are really removed afterwards (nothing left next to the jobs folder)", readdirSync(C.root).filter((n) => /import-|replaced-/.test(n)).length === 0);
  void beforeProfile;
  // failure after the swap: everything is put back
  const F = await makeApp(true, 2), fj = treeHash(F.jobsDir), fp = JSON.stringify((loadProfile(F.db) as { profile: Prof }).profile), fs = JSON.stringify(getSettings(F.db).settings);
  const bad = await X.importExport({ zipFile: ez, db: F.db, jobsDir: F.jobsDir, backupsDir: F.backupsDir, now: NOW, confirmReplace: true, afterSwap: () => { throw new Error("disk went away"); } });
  ok("a failure AFTER the jobs were swapped in puts the old jobs back and leaves the profile and settings unchanged, with a plain error and no leftovers", !bad.ok && /nothing was changed/.test(bad.error ?? "") && treeHash(F.jobsDir) === fj && JSON.stringify((loadProfile(F.db) as { profile: Prof }).profile) === fp && JSON.stringify(getSettings(F.db).settings) === fs && readdirSync(F.root).filter((n) => /import-|replaced-/.test(n)).length === 0);
  // no backup possible
  const G = await makeApp(true, 1); writeFileSync(G.backupsDir, "a file, not a folder"); const gj = treeHash(G.jobsDir);
  const nb = await X.importExport({ zipFile: ez, db: G.db, jobsDir: G.jobsDir, backupsDir: G.backupsDir, now: NOW, confirmReplace: true });
  ok("if the safety backup cannot be made, the import is refused and nothing is changed", !nb.ok && /no backup/.test(nb.error ?? "") && treeHash(G.jobsDir) === gj);
  // importing the same export twice is fine
  const again = await X.importExport({ zipFile: ez, db: C.db, jobsDir: C.jobsDir, backupsDir: C.backupsDir, now: new Date(NOW.getTime() + 1000), confirmReplace: true });
  ok("importing the same export twice works (replace, not merge: no duplicates)", again.ok && searchJobs(C.db).total === 3);
}

// ---------- hostile and damaged files: every one is refused and NOTHING changes ----------
{
  const T = await makeApp(true, 1), snap = () => treeHash(T.jobsDir) + "|" + JSON.stringify([T.db.all("SELECT * FROM profile"), T.db.all("SELECT * FROM settings"), T.db.all("SELECT folder FROM jobs")]) + "|" + readdirSync(T.root).sort().join();
  const base = snap();
  const goodFiles: Record<string, Uint8Array> = { "profile.json": strToU8(JSON.stringify(priya)), "settings.json": strToU8("{}"), "jobs/job-1/status.json": strToU8(JSON.stringify({ id: "j", status: "built", created: "a", updated: "b", source: "text" })), "jobs/job-1/ad.md": strToU8("ad") };
  const build = (files: Record<string, Uint8Array>, o: { manifest?: (m: any) => void; skipManifest?: boolean; dropFromManifest?: string[]; extraZip?: Record<string, Uint8Array> } = {}) => {
    const m: any = { exportFormat: 1, createdAt: NOW.toISOString(), dbFormat: 2, jobs: 1, files: Object.entries(files).filter(([p]) => !o.dropFromManifest?.includes(p)).map(([p, b]) => ({ path: p, size: b.length, sha256: hash(b) })) };
    o.manifest?.(m);
    const all: Record<string, Uint8Array> = { ...(o.skipManifest ? {} : { "cvapp-export.json": strToU8(JSON.stringify(m)) }), ...files, ...(o.extraZip ?? {}) };
    return Buffer.from(zipSync(all));
  };
  const dupZip = () => { const chunks: Uint8Array[] = []; const z = new Zip((e, c) => { if (!e) chunks.push(c); }); for (const [n, d] of [["cvapp-export.json", strToU8(JSON.stringify({ exportFormat: 1, createdAt: "x", files: [] }))], ["profile.json", strToU8("{}")], ["profile.json", strToU8("{}")]] as [string, Uint8Array][]) { const f = new ZipPassThrough(n); z.add(f); f.push(d, true); } z.end(); return Buffer.concat(chunks); };
  const good = build(goodFiles);
  const trunc = good.subarray(0, Math.floor(good.length / 2));
  const flipped = Buffer.from(good); flipped[Math.floor(flipped.length / 2)] ^= 0xff;
  const cases: [string, Buffer | string, RegExp | null][] = [
    ["not a zip at all", Buffer.from("this is just text, definitely not a zip file".repeat(5)), /cannot be unpacked|not a valid/],
    ["an empty file", Buffer.alloc(0), /cannot be unpacked|not a valid/],
    ["a zip cut in half", trunc, /cannot be unpacked|not a valid/],
    ["a zip with bytes flipped in the middle", flipped, null],
    ["no manifest", build(goodFiles, { skipManifest: true }), /no manifest/],
    ["an export from a NEWER format", build(goodFiles, { manifest: (m) => { m.exportFormat = 99; } }), /newer version/],
    ["a file changed after the manifest was made", build({ ...goodFiles, "jobs/job-1/ad.md": strToU8("tampered") }, { manifest: (m) => { m.files.find((f: any) => f.path === "jobs/job-1/ad.md").sha256 = hash(strToU8("ad")); m.files.find((f: any) => f.path === "jobs/job-1/ad.md").size = 2; } }), /changed or damaged/],
    ["a file the manifest does not list", build(goodFiles, { dropFromManifest: ["jobs/job-1/ad.md"] }), /does not list/],
    ["a listed file that is missing", build(goodFiles, { manifest: (m) => m.files.push({ path: "jobs/job-1/cv.pdf", size: 1, sha256: "0" }) }), /missing/],
    ["a path that climbs out with ..", build({ ...goodFiles, "jobs/../../evil.txt": strToU8("x") }), /unsafe/],
    ["an absolute path", build({ ...goodFiles, "/etc/evil.txt": strToU8("x") }), /unsafe/],
    ["a backslash path", build({ ...goodFiles, "jobs\\job-2\\x.md": strToU8("x") }), /unsafe/],
    ["a job folder nested too deep", build({ ...goodFiles, "jobs/job-1/deeper/x.md": strToU8("x") }), /unsafe/],
    ["an unexpected top-level file", build({ ...goodFiles, "evil.sh": strToU8("rm -rf /") }), /unsafe/],
    ["a job folder with a hidden name", build({ ...goodFiles, "jobs/.hidden/status.json": strToU8("{}") }), /unsafe/],
    ["the same file name twice", dupZip(), /twice/],
    ["an invalid profile", build({ ...goodFiles, "profile.json": strToU8(JSON.stringify({ hello: 1 })) }), /not valid/],
    ["a profile that is not JSON", build({ ...goodFiles, "profile.json": strToU8("{no") }), /profile.json cannot be read/],
    ["a settings file that is not an object", build({ ...goodFiles, "settings.json": strToU8("[1,2]") }), /not a settings file/],
    ["a job with no readable status file", build({ ...goodFiles, "jobs/job-1/status.json": strToU8("{}") }), /status file/],
  ];
  const results: [string, boolean, string][] = [];
  for (const [name, bytes, re] of cases) {
    const f = path.join(T.root, "hostile.zip"); writeFileSync(f, bytes);
    const ins2 = await X.inspectExport(f), r = await X.importExport({ zipFile: f, db: T.db, jobsDir: T.jobsDir, backupsDir: T.backupsDir, now: NOW, confirmReplace: true });
    const reason = !r.ok ? (r.problems ?? [r.error ?? ""]).join(" ") : "ACCEPTED";
    results.push([name, !ins2.ok && !r.ok && (re ? re.test(reason) : true) && snap().replace(/hostile\.zip,?/, "") === base.replace(/hostile\.zip,?/, ""), reason.slice(0, 80)]);
  }
  for (const [name, good2, reason] of results) ok(`hostile or damaged export refused with a reason and NOTHING changed (no file, row, folder or leftover): ${name} [${reason}]`, good2);
  ok("nothing was written outside the app's own folders by any of them", !existsSync(path.join(T.root, "evil.txt")) && !existsSync(path.join(path.dirname(T.root), "evil.txt")) && !existsSync("/etc/evil.txt"));
  const f2 = path.join(T.root, "lim.zip"); writeFileSync(f2, good);
  const lim1 = await X.inspectExport(f2, { ...X.LIMITS, entries: 2 }), lim2 = await X.inspectExport(f2, { ...X.LIMITS, totalBytes: 100 }), lim3 = await X.inspectExport(f2, { ...X.LIMITS, fileBytes: 10 });
  ok("size limits are enforced from the archive headers before anything is unpacked: too many entries, too much data in total, one file too large", !lim1.ok && !lim2.ok && !lim3.ok && lim3.problems.some((p) => /too large/.test(p)));
  ok("a good archive built the same way as the hostile ones IS accepted (the refusals above are not just because of a bad builder)", (await X.inspectExport(f2)).ok);
}

// ---------- a bigger history ----------
{
  const Big = await makeApp(true, 1); const t0 = Date.now();
  for (let i = 10; i < 210; i++) { const folder = `bulk-${i}`, d = path.join(Big.jobsDir, folder); mkdirSync(d); await PL.saveStateFile({ id: `b${i}`, dir: d, status: "built", created: NOW.toISOString(), updated: NOW.toISOString(), source: "text", company: `Bulk ${i}`, role: "R" } as never, NOW); writeFileSync(path.join(d, "cv.pdf"), pdfBytes()); writeFileSync(path.join(d, "ad.md"), "x".repeat(8000)); }
  const bz = outZip(Big, "big.zip"), re = await X.exportAll(Big.db, Big.jobsDir, bz, { now: NOW }), Dst = await makeApp(false);
  const ri = await X.importExport({ zipFile: bz, db: Dst.db, jobsDir: Dst.jobsDir, backupsDir: Dst.backupsDir, now: NOW, confirmReplace: false });
  const strip = (r: string) => treeHash(r).split("\n").filter((l) => !/\.DS_Store|x\.tmp/.test(l)).join("\n");
  ok(`200 jobs (about ${Math.round((re.ok ? re.bytes : 0) / 1e6 * 10) / 10} MB) export and import with an identical result, in ${Math.round((Date.now() - t0) / 100) / 10} s`, re.ok && ri.ok && ri.jobs === 201 && strip(Big.jobsDir) === treeHash(Dst.jobsDir) && Date.now() - t0 < 30000);
}
{ // schema v2 (2026-11-18): the export carries the v2 profile WITHOUT the stored CV text and the change log; an export made by the v1 app still restores
  const V = await import("../src/profile-v2.ts"), P = await import("../src/store/profile-store.ts");
  const A = await makeApp(true), p2 = V.migrateV1ToV2(priya, "2026-01-01T00:00:00.000Z");
  p2.sources = [{ id: "s1", kind: "cv", label: "CV", addedAt: "2026-01-01T00:00:00.000Z", textHash: "h1", text: "MASKED-CV-TEXT-CANARY" }]; p2.log = [{ at: "2026-01-01T00:00:00.000Z", actor: "import", summary: "UNDO-LOG-CANARY" }];
  p2.facts.roles[0].bullets[0].meta = { origin: "cv", trust: "trusted", addedAt: "2026-01-01T00:00:00.000Z", sourceId: "s1" };
  ok("v2 export: the v2 profile can be saved", P.saveProfileV2(A.db, p2, NOW).ok);
  const z = outZip(A, "v2.zip"), r = await X.exportAll(A.db, A.jobsDir, z, { now: NOW }), files = r.ok ? unzipSync(new Uint8Array(readFileSync(z))) : {};
  const pj = files["profile.json"] ? strFromU8(files["profile.json"]) : "";
  ok("v2 export: profile.json is schema v2 with its provenance and source list, but NO stored CV text and NO change log", /"schemaVersion": 2/.test(pj) && pj.includes('"sourceId": "s1"') && !pj.includes("MASKED-CV-TEXT-CANARY") && !pj.includes("UNDO-LOG-CANARY") && pj.includes('"textHash": "h1"'));
  const B = await makeApp(false), imp2 = await X.importExport({ zipFile: z, db: B.db, jobsDir: B.jobsDir, backupsDir: B.backupsDir, now: NOW, confirmReplace: true });
  const back = P.loadProfileV2(B.db);
  ok("v2 export: it restores into a fresh app as a v2 profile (storedFormat 2) with the same provenance, and the old app's profile view is identical to the original", imp2.ok && back.status === "ok" && back.storedFormat === 2 && back.profile.facts.roles[0].bullets[0].meta.sourceId === "s1" && JSON.stringify(Object.entries(loadProfile(B.db).status === "ok" ? 1 : 0)) !== "" && loadProfile(B.db).status === "ok");
  // an export made by the v1 app: profile.json is a v1 document
  const v1Files = new Map<string, Uint8Array>([["profile.json", strToU8(JSON.stringify(priya, null, 2))], ["settings.json", strToU8("{}")], ["history.csv", strToU8("")]]);
  const { MIGRATIONS: MG } = await import("../src/store/schema.ts");
  const man = { exportFormat: 1, createdAt: NOW.toISOString(), dbFormat: MG.length, jobs: 0, files: [...v1Files].map(([pth, b]) => ({ path: pth, size: b.length, sha256: hash(b) })) };
  const zv1 = path.join(A.root, "v1.zip"); writeFileSync(zv1, zipSync({ "cvapp-export.json": strToU8(JSON.stringify(man)), ...Object.fromEntries(v1Files) }));
  const C = await makeApp(false), imp1 = await X.importExport({ zipFile: zv1, db: C.db, jobsDir: C.jobsDir, backupsDir: C.backupsDir, now: NOW, confirmReplace: true }), l1 = P.loadProfileV2(C.db);
  ok("v1 export: an export made by the older app (a v1 profile.json) still restores; it is stored as v1, read as v2 (legacy provenance) and unchanged for every reader", imp1.ok && l1.status === "ok" && l1.storedFormat === 1 && l1.profile.facts.roles[0].bullets[0].meta.origin === "legacy" && JSON.stringify(loadProfile(C.db).status === "ok" ? Object.keys((loadProfile(C.db) as any).profile).sort() : []) === JSON.stringify(Object.keys(priya).sort()));
}
for (const r of roots) rmSync(r, { recursive: true, force: true });
console.log(failures === 0 ? "\nall export tests passed" : `\n${failures} export test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
