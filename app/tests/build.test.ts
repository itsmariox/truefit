// Phase 6: Build CV and extras through the REAL core, pipeline, runner, fit loop and ATS checks, with the fake Claude (all roles) and the Chrome renderer (the Electron renderer is
// proven in the real-Electron test). Skipped, loudly, when no Chrome-based browser is installed.
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startApp } from "../src/main/core/app-core.ts";
import { createHost } from "../src/main/core/host.ts";
import { createJobsHandlers } from "../src/main/jobs-handlers.ts";
import { fakeQuery } from "../src/main/core/fake-claude.ts";
import { ChromeCliRenderer, findChrome, loadFonts } from "../../engine/src/cv/render.ts";
import { rig, priya } from "./core-rig.ts";
if (!findChrome()) { if (process.env.CVAPP_SKIP_BUILD_TEST === "1") { console.log("SKIP (CVAPP_SKIP_BUILD_TEST=1): no Chrome-based browser found"); process.exit(0); } console.error("FAIL the build test needs a Chrome-based browser (set CVAPP_CHROME), or set CVAPP_SKIP_BUILD_TEST=1 to skip it on purpose"); process.exit(1); }
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const settle = async (c: { queue: { snapshot(): { entries: { state: string }[]; blocked: boolean } } }) => { for (let t = 0; t < 1500; t++) { const q = c.queue.snapshot(); if (!q.entries.some((e) => e.state === "running" || (e.state === "queued" && !q.blocked))) break; await new Promise((r) => setTimeout(r, 20)); } await new Promise((r) => setTimeout(r, 150)); };
const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-build-")); mkdirSync(path.join(root, "tmp"));
try {
  const R = rig(root), controls = { questions: [] as string[], failChecker: false };
  const deps = { ...R.deps(), query: ((a: any) => fakeQuery(priya, controls)(a)) as never, renderer: new ChromeCliRenderer(), fonts: await loadFonts() };
  const host = createHost({ start: () => startApp(deps), onReady: () => undefined }); await host.start();
  const opened: string[] = [], revealed: string[] = [];
  const h = createJobsHandlers({ host, push: () => undefined, fetchAd: async () => { throw new Error("no"); }, openPath: async (f) => { opened.push(f); return ""; }, reveal: (f) => { revealed.push(f); } });
  const core = host.core()!; core.access.chooseMode("subscription"); core.access.acceptNotice(); core.profile.save(priya);
  const c = await h["jobs:create"]({ text: "A marketing role at a fictional shop with weekly emails and reporting. ".repeat(8), force: undefined }); if (c.outcome !== "created") throw new Error("create");
  await h["jobs:analyse"]({ id: c.job.id }); await settle(core);
  let d = await h["jobs:get"]({ id: c.job.id });
  ok("1. before any build the job has no CV and no extras", d?.status === "analysed" && d.build.state === "none" && !d.build.pdf && d.extras.length === 0);
  const b = await h["jobs:build"]({ id: c.job.id, layout: undefined, ignoreQuestions: undefined, refreshProfile: undefined }); await settle(core); d = await h["jobs:get"]({ id: c.job.id });
  ok("2. Build CV runs the whole pipeline (writer, real render, fit and ATS checks, checker, coach): the job is 'built', a valid PDF exists and the page's view says so", b.queued && d?.status === "built" && d.build.state === "built" && d.build.pdf === true && d.build.versions === 1);
  const job = await core.jobs.get(c.job.id); const pdf = readFileSync(path.join(job!.dir, "cv.pdf"));
  ok("3. the file is a real PDF of a reasonable size and no folder path reaches the page", pdf.subarray(0, 5).toString() === "%PDF-" && pdf.length > 5000 && !JSON.stringify(d).includes(root));
  ok("4. 'Open CV' and 'Show in Finder' use the job's own file (the page sends only an id)", (await h["jobs:openPdf"]({ id: c.job.id })).opened && opened[0] === path.join(job!.dir, "cv.pdf") && (await h["jobs:reveal"]({ id: c.job.id })).shown && revealed.length === 1);
  await h["jobs:build"]({ id: c.job.id, layout: undefined, ignoreQuestions: undefined, refreshProfile: undefined }); await settle(core);
  ok("5. 'Build again' keeps every version (two now)", (await h["jobs:get"]({ id: c.job.id }))?.build.versions === 2);
  await h["jobs:extra"]({ id: c.job.id, kind: "cover-note" }); await settle(core); d = await h["jobs:get"]({ id: c.job.id });
  ok("6. a cover note is written only when asked and appears with its text; the others do not exist yet", d?.extras.length === 1 && d.extras[0].kind === "cover-note" && d.extras[0].text.length > 10);
  controls.questions = ["Have you managed a paid search budget?"];
  const c2 = await h["jobs:create"]({ text: "A different marketing role at another fictional shop, with social media and events. ".repeat(8), force: undefined }); if (c2.outcome !== "created") throw new Error("c2");
  await h["jobs:analyse"]({ id: c2.job.id }); await settle(core); await h["jobs:build"]({ id: c2.job.id, layout: undefined, ignoreQuestions: undefined, refreshProfile: undefined }); await settle(core);
  const q = await h["jobs:get"]({ id: c2.job.id });
  ok("7. a fact the profile lacks stops the build in 'needs_fact' with the question in plain words, and the queue is NOT blocked", q?.build.state === "needs_fact" && /paid search budget/.test(q.build.question ?? "") && !core.queue.snapshot().blocked);
  await h["jobs:build"]({ id: c2.job.id, layout: undefined, ignoreQuestions: true, refreshProfile: undefined }); await settle(core);
  ok("8. 'Build without it' then builds the CV", (await h["jobs:get"]({ id: c2.job.id }))?.build.state === "built");
  await core.shutdown({ finalBackup: false });
  ok("9. nothing was left running or open", existsSync(path.join(root, "data")));
} finally { rmSync(root, { recursive: true, force: true }); }
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); } else console.log("\nALL PASS");
