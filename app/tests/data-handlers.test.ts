// Phase 7: History, Settings and your data, on the REAL core, database and export routine; only the save dialog, the login item and the quit are fakes.
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startApp } from "../src/main/core/app-core.ts";
import { createHost } from "../src/main/core/host.ts";
import { createDataHandlers } from "../src/main/data-handlers.ts";
import { createJobsHandlers } from "../src/main/jobs-handlers.ts";
import { rig, priya } from "./core-rig.ts";
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const settle = async (c: { queue: { snapshot(): { entries: { state: string }[]; blocked: boolean } } }) => { for (let t = 0; t < 500; t++) { const q = c.queue.snapshot(); if (!q.entries.some((e) => e.state === "running" || (e.state === "queued" && !q.blocked))) break; await new Promise((r) => setTimeout(r, 10)); } await new Promise((r) => setTimeout(r, 120)); };
const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-datah-")); mkdirSync(path.join(root, "tmp"));
try {
  const R = rig(root); const host = createHost({ start: () => startApp(R.deps()), onReady: () => undefined }); await host.start(); const core = host.core()!;
  core.access.chooseMode("subscription"); core.access.acceptNotice(); core.profile.save(priya);
  const login: boolean[] = [], looks: string[] = []; let dest: string | null = path.join(root, "out.zip"), quits = 0;
  let importFile: string | null = null, changed = 0;
  let textDest: string | null = null, suggestedSeen = "", formatSeen = "", pdfHtml = "";
  let h = createDataHandlers({ host, version: "9.9.9", chooseExportFile: async () => dest, chooseTextFile: async (suggested, format) => { suggestedSeen = suggested; formatSeen = format; return textDest; }, renderPdf: async (html) => { pdfHtml = html; return Buffer.from("%PDF-1.4 fake pdf body"); }, chooseImportFile: async () => importFile, jobsChanged: () => { changed++; }, setLoginItem: (on) => login.push(on), setAppearance: (v) => looks.push(v), afterDelete: () => { quits++; } });
  const hs = (o: Partial<{ text: string; verdict: "apply" | "long_shot" | "skip"; sort: "newest" | "oldest" | "fit" | "company"; offset: string }>) => h["history:search"]({ text: "", verdict: undefined, sort: undefined, offset: undefined, ...o });
  const jobs = createJobsHandlers({ host, push: () => undefined, fetchAd: async () => { throw new Error("no"); } });
  for (const [n, t] of [["Acme", "marketing at Acme"], ["Larkfield", "marketing at Larkfield"]] as const) { R.script.company = n; const c = await jobs["jobs:create"]({ text: `A role description for ${t}. `.repeat(8), force: undefined }); if (c.outcome !== "created") throw new Error("c"); await jobs["jobs:analyse"]({ id: c.job.id }); await settle(core); }
  const all = await hs({ text: "", verdict: undefined, sort: undefined });
  ok("1. History lists every analysed job with its title, verdict and fit; the page gets rows, never folders", all.total === 2 && all.rows.every((r) => r.verdict === "apply" && r.fit === 70 && r.id.length > 3) && !JSON.stringify(all).includes(root));
  ok("2. search finds by company (start of a word) and the filters and sort work", (await hs({ text: "lark", verdict: undefined, sort: undefined })).total === 1 && (await hs({ text: "", verdict: "skip", sort: undefined })).total === 0 && (await hs({ text: "", verdict: "apply", sort: "company" })).rows[0].title.startsWith("Acme"));
  ok("3. a search typed with odd characters is made safe (no error, no match)", (await hs({ text: '"; DROP TABLE jobs; --', sort: undefined, verdict: undefined })).total === 0 && (await hs({ text: "", verdict: undefined, sort: undefined })).total === 2);
  const sm = await h["history:summary"](undefined);
  ok("4. the summary counts jobs, analysed jobs, the verdict split and the average fit", sm.jobs === 2 && sm.analysed === 2 && sm.apply === 2 && sm.avgFit === 70 && sm.built === 0);
  const st = await h["settings:get"](undefined);
  ok("5. settings come with their allowed options and the app version", st.tone === "friendly" && st.tones.includes("concise") && st.accents.includes("oxford") && st.version === "9.9.9" && st.notify.analysed === true);
  const set = await h["settings:set"]({ patch: { tone: "concise", notifyFailed: false, capUsd: 25, startAtLogin: true } });
  ok("6. a valid change is saved and read back, and 'start at login' reaches the login item", set.ok && set.settings.tone === "concise" && set.settings.notify.failed === false && set.settings.capUsd === 25 && login.join() === "true");
  ok("6b. the first-run guide starts as not done, can be marked done from the page, and is part of the settings view", (await h["settings:get"](undefined)).onboardingDone === false && (await h["settings:set"]({ patch: { onboardingDone: true } })).ok && (await h["settings:get"](undefined)).onboardingDone === true && !(await h["settings:set"]({ patch: { onboardingDone: "yes" } })).ok);
  const look0 = (await h["settings:get"](undefined)).appearance, look1 = await h["settings:set"]({ patch: { appearance: "dark" } }), look2 = await h["settings:set"]({ patch: { appearance: "neon" } });
  ok("6c. the app looks light until told otherwise; 'dark' is saved and reaches the window, 'neon' is refused and changes nothing", look0 === "light" && look1.ok && look1.settings.appearance === "dark" && looks.join() === "dark" && !look2.ok && (await h["settings:get"](undefined)).appearance === "dark");
  const bad = await h["settings:set"]({ patch: { tone: "shouting" } }), unk = await h["settings:set"]({ patch: { "claude.mode": "apiKey" } }), mix = await h["settings:set"]({ patch: { accent: "forest", capUsd: -5 } });
  ok("7. a bad value, a setting the page may not change (the Claude mode), or a bad value mixed with a good one is refused as a WHOLE and nothing changes", !bad.ok && !unk.ok && !mix.ok && (await h["settings:get"](undefined)).accent === "oxford" && (await h["settings:get"](undefined)).tone === "concise");
  await R.secrets.set("claude-api-key", "sk-ant-api03-EXPORTCHECKFAKEFAKEFAKE"); await R.secrets.set("telegram-bot-token", "123456789:AAExportCheckFakeFakeFakeFake_abc");
  const ex = await h["data:export"](undefined);
  ok("8. export asks the main process for the place, writes one zip with both jobs, and the page never sees a path", ex.status === "saved" && ex.jobs === 2 && existsSync(path.join(root, "out.zip")) && statSync(path.join(root, "out.zip")).size > 500 && !JSON.stringify(ex).includes(root));
  const zipBytes = (await import("node:fs")).readFileSync(path.join(root, "out.zip")).toString("latin1");
  ok("8b. the export zip holds NO secret: no key file, no token file, no secrets or telegram folder, and neither value appears in it", !/secrets|telegram|claude-api-key|bot-token|EXPORTCHECK|AAExportCheck/.test(zipBytes));
  dest = null; ok("9. cancelling the save dialog exports nothing", (await h["data:export"](undefined)).status === "cancelled");
  textDest = path.join(root, "extra.txt");
  const sv = await h["data:saveText"]({ name: "Cover note, Acme/Retail: Marketing?", text: "Dear team", format: undefined });
  ok("9a. 'Save as text file' writes the text to the place the dialog gave, adds a final newline, and returns no path", sv.status === "saved" && (await import("node:fs")).readFileSync(textDest, "utf8") === "Dear team\n" && !JSON.stringify(sv).includes(root));
  ok("9a2. the suggested file name has no slash, colon or question mark and ends in .txt", /^[^/:?]+\.txt$/.test(suggestedSeen) && suggestedSeen.includes("Acme"));
  textDest = null; ok("9a3. cancelling the text save dialog writes nothing and says 'cancelled'", (await h["data:saveText"]({ name: "x", text: "y", format: undefined })).status === "cancelled");
  textDest = path.join(root, "no-such-folder", "deep", "x.txt"); ok("9a4. a place that cannot be written gives 'failed', not a crash", (await h["data:saveText"]({ name: "x", text: "y", format: undefined })).status === "failed"); textDest = null;
  { // Word and PDF export of an extra (2026-11-18)
    const fs = await import("node:fs"), cp = await import("node:child_process"); const nasty = "Dear <team> & \"friends\"\n\nLine two with an 'apostrophe'.\u0001 (a control character)";
    textDest = path.join(root, "extra-word"); const w = await h["data:saveText"]({ name: "Cover note: Acme/Retail", text: nasty, format: "docx" });
    const docx = path.join(root, "extra-word.docx");
    ok("9b1. 'Save as Word' asks the dialog for a .docx name, writes the file (adding the extension) and returns no path", w.status === "saved" && formatSeen === "docx" && suggestedSeen.endsWith(".docx") && !/[/:]/.test(suggestedSeen) && fs.existsSync(docx) && !JSON.stringify(w).includes(root));
    const txt = (() => { try { return cp.execFileSync("/usr/bin/textutil", ["-convert", "txt", "-stdout", docx], { encoding: "utf8" }); } catch { return null; } })();
    ok("9b2. the .docx is a real Word file: macOS textutil reads it back, with the special characters intact and the control character gone", txt !== null && txt.includes("Dear <team> & \"friends\"") && txt.includes("Line two with an 'apostrophe'.") && !txt.includes("\u0001"));
    textDest = path.join(root, "extra-pdf.pdf"); const pd = await h["data:saveText"]({ name: "Notes", text: "Hello <b>bold</b> & more\n\nSecond", format: "pdf" });
    ok("9b3. 'Save as PDF' sends escaped HTML to the print window (no tag gets through) and writes what it returns", pd.status === "saved" && formatSeen === "pdf" && fs.readFileSync(textDest).toString().startsWith("%PDF-") && pdfHtml.includes("&lt;b&gt;bold&lt;/b&gt; &amp; more") && !pdfHtml.includes("<b>") && !/<script/i.test(pdfHtml));
    textDest = path.join(root, "plain.txt"); await h["data:saveText"]({ name: "Plain", text: "x", format: undefined });
    ok("9b4. with no format the file is plain text, as before", formatSeen === "txt" && fs.readFileSync(textDest, "utf8") === "x\n");
    textDest = null;
  }
  const usage = (await h["settings:get"](undefined)).usage;
  ok("9b. Settings shows this month's use in plain lines (the subscription requests made by the two analyses)", usage.some((l) => /Subscription, this month: \d+ requests?/.test(l)));
  // keep a copy, delete the jobs only, then restore from the copy
  dest = path.join(root, "keep.zip"); await h["data:export"](undefined); dest = null;
  const wrongJ = await h["data:deleteJobs"]({ phrase: "delete everything" }), jobsDirNow = path.join(root, "data", "jobs");
  ok("9c. 'Delete jobs and CVs' needs its own phrase (the 'delete everything' phrase does not work for it)", !wrongJ.deleted && (await h["history:search"]({ text: "", verdict: undefined, sort: undefined, offset: undefined })).total === 2);
  const dj = await h["data:deleteJobs"]({ phrase: "Delete Jobs" });
  ok("9d. it removes both jobs and their files, keeps the profile and settings, and tells the page to refresh", dj.deleted && dj.jobs === 2 && (await h["history:search"]({ text: "", verdict: undefined, sort: undefined, offset: undefined })).total === 0 && core.profile.get() !== null && core.settings.get().settings.tone === "concise" && changed === 1);
  const none = await h["data:importPick"](undefined); importFile = path.join(root, "notazip.zip"); (await import("node:fs")).writeFileSync(importFile, "not a zip at all"); const badPick = await h["data:importPick"](undefined);
  ok("9e. cancelling the open dialog picks nothing; a file that is not an export is refused as invalid", none.status === "cancelled" && badPick.status === "invalid" && !(await h["data:importConfirm"]({ phrase: "replace everything" })).imported);
  importFile = path.join(root, "keep.zip"); const pick = await h["data:importPick"](undefined);
  ok("9f. a real export is read and described (two jobs, with a profile) without changing anything", pick.status === "picked" && pick.jobs === 2 && pick.hasProfile && (await h["history:search"]({ text: "", verdict: undefined, sort: undefined, offset: undefined })).total === 0);
  { // review 2026-11-18: choosing another copy (even a cancelled or invalid one) forgets the earlier pick, so a typed phrase can't restore an old copy
    const keep = importFile; importFile = null; const cancelled = await h["data:importPick"](undefined); const refused = await h["data:importConfirm"]({ phrase: "Replace Everything" });
    ok("9f2. after a cancelled pick the earlier copy is forgotten: the typed phrase restores nothing", cancelled.status === "cancelled" && !refused.imported);
    importFile = keep; await h["data:importPick"](undefined);
  }
  { // review P2 (fixed 2026-11-19): a restore or delete the engine REFUSES (a job is running) must not leave the app half shut down
    const fsx = await import("node:fs"), busyDir = path.join(jobsDirNow, "zz-busy-test"); fsx.mkdirSync(busyDir, { recursive: true }); fsx.writeFileSync(path.join(busyDir, "status.json"), JSON.stringify({ id: "zz-busy-test", status: "analysing", created: "2026-01-01T00:00:00.000Z", updated: "2026-01-01T00:00:00.000Z" }));
    const before = host.core(); const rr = await h["data:importConfirm"]({ phrase: "Replace Everything" }); const dd = await h["data:delete"]({ phrase: "delete everything" });
    const after = host.core(), alive = (() => { try { return !!after && Array.isArray(after.queue.snapshot().entries) && !!after.settings.get().settings; } catch { return false; } })();
    ok("9f3. a restore and a delete are refused BEFORE anything is shut down when a job is running: the same core keeps running, settings still read, nothing is deleted and the running job is left exactly as it was", !rr.imported && !dd.deleted && alive && after === before && fsx.existsSync(busyDir) && JSON.parse(fsx.readFileSync(path.join(busyDir, "status.json"), "utf8")).status === "analysing");
    importFile = importFile; await h["data:importPick"](undefined); fsx.rmSync(busyDir, { recursive: true, force: true });
  }
  const nope = await h["data:importConfirm"]({ phrase: "yes" }), q0 = quits;
  ok("9g. restoring needs the typed phrase", !nope.imported && quits === q0);
  const imp = await h["data:importConfirm"]({ phrase: "Replace Everything" }); await new Promise((r) => setTimeout(r, 1700));
  ok("9h. with the phrase the export replaces everything: both job folders are back on disk and the app is asked to quit so it reopens on the restored data", imp.imported && (await import("node:fs")).readdirSync(jobsDirNow).length === 2 && quits === q0 + 1);
  // the app reopens on the restored data (a new core on the same folder), as it would after the quit
  const hostB = createHost({ start: () => startApp(R.deps()), onReady: () => undefined }); await hostB.start();
  h = createDataHandlers({ host: hostB, version: "9.9.9", chooseExportFile: async () => dest, setLoginItem: (on) => login.push(on), afterDelete: () => { quits++; } });
  ok("9i. after reopening, the restored jobs are in History again", (await h["history:search"]({ text: "", verdict: undefined, sort: undefined, offset: undefined })).total === 2);
  const tgDirBefore = existsSync(path.join(root, "data", "telegram")), secDirBefore = existsSync(path.join(root, "data", "secrets"));
  (await import("node:fs")).writeFileSync(path.join(root, "data", "notices.json"), JSON.stringify([{ id: "n1", kind: "analysed", jobId: "x", title: "Job analysed", body: "Company CANARYNOTICE, Role", at: "2026-01-01T00:00:00.000Z" }])); // the saved banners hold company and role names
  const qBase = quits; const no = await h["data:delete"]({ phrase: "delete" }), still = existsSync(path.join(root, "data", "app.db"));
  ok("10. the wrong phrase deletes nothing", !no.deleted && still && quits === qBase);
  const yes = await h["data:delete"]({ phrase: " Delete Everything " });
  await new Promise((r) => setTimeout(r, 1700));
  ok("11b. \"Delete everything\" also removes the saved banners file (it holds company and role names) and leaves nothing of the data folder behind", !existsSync(path.join(root, "data", "notices.json")) && !existsSync(path.join(root, "data")));
  ok("11. the exact phrase (any capitals) deletes the data and the Keychain item, then asks the app to quit", yes.deleted && !existsSync(path.join(root, "data", "app.db")) && R.removed.length === 1 && quits === qBase + 1 && tgDirBefore && !existsSync(path.join(root, "data", "telegram")) && !existsSync(path.join(root, "data", "secrets")) && secDirBefore !== undefined);
} finally { rmSync(root, { recursive: true, force: true }); }
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); } else console.log("\nALL PASS");
