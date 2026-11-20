// LIVE (opt-in, never part of npm test): the app core and the job handlers with the REAL Claude program and the real login, on a FICTIONAL profile and a FICTIONAL ad, in a temporary
// data folder. It uses about two model calls (the Analyst and the Coach) from the subscription's quota. Nothing real is read or written: the data folder is deleted at the end.
//   CVAPP_LIVE=1 node e2e/live-analysis.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
if (process.env.CVAPP_LIVE !== "1") { console.log("set CVAPP_LIVE=1 (uses about two real model calls)"); process.exit(0); }
const here = path.dirname(fileURLToPath(import.meta.url)), engine = path.join(here, "..", "..", "engine");
const { realDeps } = await import("../src/main/core/boot.ts"); const { startApp } = await import("../src/main/core/app-core.ts"); const { createHost } = await import("../src/main/core/host.ts");
const { createJobsHandlers } = await import("../src/main/jobs-handlers.ts"); const { MemorySecretStore } = await import("../../engine/src/store/secrets.ts");
const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-live-")); mkdirSync(path.join(root, "tmp"));
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
try {
  const real = await realDeps({ engineDir: engine, userDataDir: root, appName: "CVAppLive", tmpDir: path.join(root, "tmp"), safeStorage: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async (s: string) => Buffer.from(s), decryptStringAsync: async (b: Buffer) => ({ shouldReEncrypt: false, result: b.toString() }) } });
  const host = createHost({ start: () => startApp({ ...real, secrets: new MemorySecretStore() }), onReady: () => undefined }); await host.start();
  const core = host.core(); if (!core) throw new Error("the core did not start: " + host.status().phase);
  core.access.chooseMode("subscription"); core.access.acceptNotice(); core.profile.save(JSON.parse(readFileSync(path.join(engine, "tests", "fixtures", "profile-priya.json"), "utf8")));
  const h = createJobsHandlers({ host, push: () => undefined, fetchAd: async () => { throw new Error("no links in this run"); } });
  const ad = "Marketing Executive at Brightwell Home (a fictional company). Leeds, hybrid, £34,000 to £38,000. You will run weekly email campaigns, write social posts and report on results in Google Analytics. Two years of marketing experience required. ".repeat(2);
  const c = await h["jobs:create"]({ text: ad, force: undefined }); if (c.outcome !== "created") throw new Error("not created: " + JSON.stringify(c));
  const t0 = Date.now(); await h["jobs:analyse"]({ id: c.job.id });
  let d = null as Awaited<ReturnType<typeof h["jobs:get"]>>; for (let i = 0; i < 600; i++) { d = await h["jobs:get"]({ id: c.job.id }); if (d && d.status !== "analysing" && core.queue.idle()) break; /* the job is saved as "analysed" BEFORE the Coach step: wait for the queue to finish */ await new Promise((r) => setTimeout(r, 1000)); }
  console.log(`   took ${Math.round((Date.now() - t0) / 1000)} s; status ${d?.status}; verdict ${d?.verdict?.verdict} fit ${d?.verdict?.fit}; rules ${d?.verdict?.rules.map((r) => r.rule + ":" + r.status).join(" ")}`);
  ok("the real Claude analysed the fictional ad: the job is 'analysed' with a verdict, a fit between 0 and 100, a title and a plain note from the Coach", d?.status === "analysed" && !!d.verdict && d.verdict.fit >= 0 && d.verdict.fit <= 100 && d.title.includes("Brightwell") && typeof d.coach === "string" && d.coach.length > 10);
  const rows = db(core); console.log("   ledger:", JSON.stringify(core.db.all("SELECT role, ok, mode, cost_usd, error_code FROM usage")));
  ok("the usage ledger recorded the calls (subscription mode, none failed)", rows.length >= 2 && rows.every((r) => r.ok === 1 && r.mode === "subscription"));
  ok("no folder path reached the page's view of the job", !JSON.stringify(d).includes(root));
  await core.shutdown({ finalBackup: false });
} finally { rmSync(root, { recursive: true, force: true }); }
function db(core: { db: { all<T>(sql: string): T[] } }) { return core.db.all<{ ok: number; mode: string }>("SELECT ok, mode FROM usage"); }
console.log(failures === 0 ? "\nlive analysis passed" : `\n${failures} check(s) FAILED`); process.exit(failures === 0 ? 0 : 1);
