// A job is carried on only by the service that started it: the marker file, the legacy rule, the words, and the runner's backstop (nothing is sent).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const { readJobService, markJobService, otherService, describeOtherService } = await import("../src/access/job-service.ts");
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const tmp = mkdtempSync(path.join(os.tmpdir(), "cvapp-jobsvc-")), mk = () => mkdtempSync(path.join(tmp, "job-"));
{ const d = mk(); ok("a new job has no service yet, so either may start it", readJobService(d) === null && otherService(d, "claude") === null && otherService(d, "openai") === null);
  markJobService(d, "openai"); markJobService(d, "claude");
  ok("the first service to touch a job is recorded, and a later mark never changes it", readJobService(d) === "openai" && otherService(d, "claude") === "openai" && otherService(d, "openai") === null); }
{ const d = mk(); writeFileSync(path.join(d, "analysis.json"), "{}");
  ok("a job from before this existed (an analysis, no marker) counts as started with Claude", readJobService(d) === "claude" && otherService(d, "openai") === "claude"); }
{ const d = mk(); writeFileSync(path.join(d, "ai-service.txt"), "something else"); ok("a damaged marker is ignored", readJobService(d) === null); }
{ const t = describeOtherService("claude", "openai"); ok("the words name both services and say what to do, with no code or path", /started with Claude/.test(t) && /OpenAI is chosen now/.test(t) && /Switch back to Claude in Settings/.test(t) && /new job/.test(t) && !/\//.test(t)); }
rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? "\nall job-service tests passed" : `\n${failures} job-service test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
