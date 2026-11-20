// Phase 9: with 300 jobs on disk the app must stay quick: the sidebar list, a History search and a restart (which rebuilds the index from the folders). Generous limits, real files.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startApp } from "../src/main/core/app-core.ts";
import { createHost } from "../src/main/core/host.ts";
import { createJobsHandlers } from "../src/main/jobs-handlers.ts";
import { createDataHandlers } from "../src/main/data-handlers.ts";
import { rig, priya } from "./core-rig.ts";
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-perf-")); mkdirSync(path.join(root, "tmp"));
const time = async <T,>(f: () => Promise<T> | T) => { const t = performance.now(); const r = await f(); return { r, ms: Math.round(performance.now() - t) }; };
try {
  const R = rig(root); let host = createHost({ start: () => startApp(R.deps()), onReady: () => undefined }); await host.start(); let core = host.core()!;
  core.access.chooseMode("subscription"); core.access.acceptNotice(); core.profile.save(priya);
  const made = await time(async () => { for (let i = 0; i < 300; i++) { const r = await core.jobs.create(`Job number ${i} at Company${i % 40}: weekly campaigns, reporting and events for a team in city ${i}. `.repeat(6)); if (!r.ok) throw new Error("create " + i); } });
  console.log(`   created 300 jobs in ${made.ms} ms`);
  const jobs = createJobsHandlers({ host, push: () => undefined, fetchAd: async () => { throw new Error("no"); } });
  const data = createDataHandlers({ host, version: "1", chooseExportFile: async () => null, setLoginItem: () => undefined, afterDelete: () => undefined });
  const list = await time(() => jobs["jobs:list"](undefined)); const search = await time(() => data["history:search"]({ text: "Company7", verdict: undefined, sort: "newest", offset: undefined })); const sum = await time(() => data["history:summary"](undefined));
  console.log(`   list ${list.ms} ms, search ${search.ms} ms, summary ${sum.ms} ms`);
  ok("the sidebar list of 300 jobs is built in under 1.5 s", list.r.length === 300 && list.ms < 1500);
  const p1 = await data["history:search"]({ text: "", verdict: undefined, sort: "newest", offset: undefined }), p2 = await data["history:search"]({ text: "", verdict: undefined, sort: "newest", offset: "200" }), p3 = await data["history:search"]({ text: "", verdict: undefined, sort: "newest", offset: "300" }), pbad = await data["history:search"]({ text: "", verdict: undefined, sort: "newest", offset: "abc" });
  ok("History pages: 200 rows, then the other 100 starting at offset 200 with no row twice, then none; a non-numeric offset means the first page", p1.rows.length === 200 && p2.rows.length === 100 && p3.rows.length === 0 && p1.total === 300 && p2.total === 300 && new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size === 300 && pbad.rows[0].id === p1.rows[0].id);
  ok("a History search and summary over 300 jobs take under 200 ms and count all 300", search.ms < 200 && sum.ms < 200 && sum.r.jobs === 300 && (await data["history:search"]({ text: "", verdict: undefined, sort: undefined, offset: undefined })).total === 300); // jobs not analysed yet have no company, so a company search finds none: that is expected
  await core.shutdown({ finalBackup: false });
  const restart = await time(async () => { host = createHost({ start: () => startApp(R.deps()), onReady: () => undefined }); await host.start(); core = host.core()!; });
  console.log(`   restart with 300 jobs ${restart.ms} ms`);
  ok("a restart with 300 jobs (index rebuilt from the folders) takes under 4 s", host.status().phase === "ready" && restart.ms < 4000);
  await core.shutdown({ finalBackup: false });
} finally { rmSync(root, { recursive: true, force: true }); }
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); } else console.log("\nALL PASS");
