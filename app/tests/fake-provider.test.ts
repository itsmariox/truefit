// The fake AI service (provider seam, phase 1b): it answers exactly like the fake Claude, and a whole job (analyse, build, cover note) runs through it with the Claude query wired to
// THROW, so the test fails if anything still goes through the Claude path. Needs a Chrome-based browser for the build, like build.test.ts.
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startApp } from "../src/main/core/app-core.ts";
import { createHost } from "../src/main/core/host.ts";
import { createJobsHandlers } from "../src/main/jobs-handlers.ts";
import { fakeQuery } from "../src/main/core/fake-claude.ts";
import { fakeProvider } from "../src/main/core/fake-provider.ts";
import { ChromeCliRenderer, findChrome, loadFonts } from "../../engine/src/cv/render.ts";
import { loadSkill } from "../../engine/src/agents/prompts.ts";
import { rig, priya } from "./core-rig.ts";
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const skills = path.join(import.meta.dirname, "..", "..", "engine", "skills");

// 1. parity: for every role's skill, the provider's answer equals the fake Claude's structured output
{ const roles: [string, string][] = [["fit-analysis", "analyst"], ["cv-writing", "writer"], ["fact-check", "checker"], ["coach-reply", "coach"], ["cv-import", "importer"]];
  let same = true;
  for (const [skill] of roles) {
    const system = await loadSkill(skills, skill), prompt = "<job_ad>x</job_ad>";
    const viaProvider = await fakeProvider(priya).run({ role: skill, model: "m", system, prompt, schema: "coach", web: false, timeoutSeconds: 5 }, { abort: new AbortController(), timedOut: () => false }, undefined);
    let viaQuery: unknown; for await (const m of fakeQuery(priya)({ prompt, options: { systemPrompt: system, cwd: "/x", env: {} } })) if (m.type === "result") viaQuery = m.structured_output;
    if (viaProvider.type !== "finished" || JSON.stringify(viaProvider.answer) !== JSON.stringify(viaQuery)) { same = false; console.log("  differs:", skill); }
  }
  ok("1. the fake provider gives the same answer as the fake Claude for every role's skill", same); }

// 2. a whole job through the provider only
if (!findChrome()) { if (process.env.CVAPP_SKIP_BUILD_TEST === "1") { console.log("SKIP part 2 (CVAPP_SKIP_BUILD_TEST=1): no Chrome-based browser found"); process.exit(failures ? 1 : 0); } console.error("FAIL part 2 needs a Chrome-based browser (set CVAPP_CHROME), or set CVAPP_SKIP_BUILD_TEST=1"); process.exit(1); }
const settle = async (c: { queue: { snapshot(): { entries: { state: string }[]; blocked: boolean } } }) => { for (let t = 0; t < 1500; t++) { const q = c.queue.snapshot(); if (!q.entries.some((e) => e.state === "running" || (e.state === "queued" && !q.blocked))) break; await new Promise((r) => setTimeout(r, 20)); } await new Promise((r) => setTimeout(r, 30)); };
const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-fakeprov-")); mkdirSync(path.join(root, "tmp"));
try {
  const R = rig(root); let claudeCalls = 0;
  const base = { ...R.deps().base, provider: fakeProvider(priya) };
  const deps = { ...R.deps(), base, query: (() => { claudeCalls++; throw new Error("the Claude query must not be used when a provider is given"); }) as never, renderer: new ChromeCliRenderer(), fonts: await loadFonts() };
  const host = createHost({ start: () => startApp(deps), onReady: () => undefined }); await host.start();
  const h = createJobsHandlers({ host, push: () => undefined, fetchAd: async () => { throw new Error("no"); }, openPath: async () => "", reveal: () => undefined });
  const core = host.core()!; core.access.chooseMode("subscription"); core.access.acceptNotice(); core.profile.save(priya);
  const c = await h["jobs:create"]({ text: "A marketing role at a fictional shop with weekly emails and reporting. ".repeat(8), force: undefined }); if (c.outcome !== "created") throw new Error("create");
  await h["jobs:analyse"]({ id: c.job.id }); await settle(core);
  ok("2. analyse runs through the provider: the job is analysed", (await h["jobs:get"]({ id: c.job.id }))?.status === "analysed");
  await h["jobs:build"]({ id: c.job.id, layout: undefined, ignoreQuestions: undefined, refreshProfile: undefined }); await settle(core);
  const d = await h["jobs:get"]({ id: c.job.id }), job = await core.jobs.get(c.job.id);
  ok("3. Build CV runs the whole pipeline through the provider: built, and a real PDF exists", d?.status === "built" && readFileSync(path.join(job!.dir, "cv.pdf")).subarray(0, 5).toString() === "%PDF-");
  await h["jobs:extra"]({ id: c.job.id, kind: "cover-note" }); await settle(core);
  ok("4. a cover note is written through the provider too", ((await h["jobs:get"]({ id: c.job.id }))?.extras.length ?? 0) === 1);
  ok("5. the Claude query was never called", claudeCalls === 0);
  await core.shutdown({ finalBackup: false });
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(failures === 0 ? "\nall fake-provider tests passed" : `\n${failures} fake-provider test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
