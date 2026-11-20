// Phase 4d: the job queue. Tasks are controllable promises, so every ordering is exact.
import { createQueue, type QueueTask, type TaskOutcome } from "../src/main/core/queue.ts";
let failures = 0;
const check = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const tick = () => new Promise<void>((r) => setImmediate(r));
function task(id: string) { let finish!: (o: TaskOutcome) => void; let runs = 0; const t: QueueTask & { release: (o: TaskOutcome) => void; runs: () => number } = { id, label: id.toUpperCase(), run: () => { runs++; return new Promise<TaskOutcome>((r) => { finish = r; }); }, release: (o) => finish(o), runs: () => runs }; return t; }
const states = (q: ReturnType<typeof createQueue>) => q.snapshot().entries.map((e) => `${e.id}:${e.state}`).join(" ");

{
  const q = createQueue(); const a = task("a"), b = task("b"), c = task("c");
  q.enqueue(a); q.enqueue(b); q.enqueue(c); await tick();
  check("one job runs at a time; the others wait in order with positions", states(q) === "a:running b:queued c:queued" && q.snapshot().entries.filter((e) => e.position).map((e) => e.position).join() === "1,2");
  a.release({ status: "done" }); await tick(); check("when it finishes the next one starts (first in, first out)", states(q) === "a:done b:running c:queued");
  b.release({ status: "failed", reason: "x" }); await tick(); c.release({ status: "done" }); await tick();
  check("a failed job does not stop the queue; the reason is kept", states(q) === "a:done b:failed c:done" && q.snapshot().entries[1].reason === "x" && q.idle());
}
{
  const q = createQueue({ concurrency: 2 }); const a = task("a"), b = task("b"), c = task("c"); q.enqueue(a); q.enqueue(b); q.enqueue(c); await tick();
  check("with a setting of 2, two run together (parallel jobs are a setting, not a rewrite)", states(q) === "a:running b:running c:queued" && q.snapshot().running === 2);
}
{
  const q = createQueue(); const a = task("a"), b = task("b"); q.enqueue(a); q.enqueue(b); await tick();
  a.release({ status: "paused", kind: "limit" }); await tick();
  check("a paused job BLOCKS the queue: the next one does not start", states(q) === "a:paused b:queued" && q.snapshot().blocked && b.runs() === 0);
  check("Resume runs the SAME task again, in front, and unblocks", q.resume("a") && (await tick(), states(q) === "a:running b:queued") && a.runs() === 2 && !q.snapshot().blocked);
  a.release({ status: "done" }); await tick(); check("then the waiting job starts", states(q) === "a:done b:running");
}
{
  const q = createQueue(); const a = task("a"), b = task("b"); q.enqueue(a); q.enqueue(b); await tick(); a.release({ status: "paused", kind: "login" }); await tick();
  check("Skip finishes the paused job as skipped and the queue moves on", q.skip("a") && (await tick(), states(q) === "a:skipped b:running"));
  check("resume/skip of something that is not waiting do nothing", !q.resume("zzz") && !q.resume("b") && !q.skip("zzz") && !q.skip("a"));
}
{
  const q = createQueue(); const a = task("a"), b = task("b"); q.enqueue(a); q.enqueue(b); await tick(); a.release({ status: "needs_input" }); await tick();
  check("a job that needs the user's answer does NOT block the others", states(q) === "a:needs_input b:running" && !q.snapshot().blocked);
}
{
  const q = createQueue(); const a = task("a"), b = task("b"); q.enqueue(a); q.enqueue(b); await tick();
  check("cancel works on a waiting job only (never on a running one)", q.cancel("b") && !q.cancel("a") && states(q) === "a:running b:cancelled");
  const again = q.enqueue(task("a")); check("the same job is not queued twice while active", !again.accepted && again.state === "running");
  a.release({ status: "done" }); await tick(); const re = task("a"); const r2 = q.enqueue(re); await tick();
  check("after it finished, the same job can be queued again and replaces the old entry", r2.accepted && states(q) === "b:cancelled a:running");
}
{
  const q = createQueue({ onError: () => undefined }); const bad: QueueTask = { id: "x", label: "X", run: async () => { throw new Error("secret detail /Users/someone/ad.md"); } }; const after = task("y");
  q.enqueue(bad); q.enqueue(after); await tick();
  const e = q.snapshot().entries[0];
  check("an unexpected exception becomes a failed job with a plain sentence (no error text, no path) and the queue continues", e.state === "failed" && e.reason === "The job stopped unexpectedly." && states(q) === "x:failed y:running");
}
{
  let errors = 0; const q = createQueue({ onChange: () => { throw new Error("screen broke"); }, onError: () => { errors++; } }); const a = task("a"); q.enqueue(a); await tick(); a.release({ status: "done" }); await tick();
  check("a listener that throws never breaks the queue", states(q) === "a:done" && errors > 0);
}
{
  const q = createQueue(); const a = task("a"), b = task("b"); q.adopt(a, "paused", "unknown"); q.enqueue(b); await tick();
  check("an entry adopted as paused (from before a restart) blocks the queue until resumed", states(q) === "a:paused b:queued" && b.runs() === 0 && q.snapshot().entries[0].kind === "unknown");
  q.resume("a"); await tick(); check("resuming it runs it first", a.runs() === 1 && states(q) === "a:running b:queued");
  q.clearFinished(); check("clearing keeps what is still active", states(q) === "a:running b:queued");
  a.release({ status: "done" }); await tick(); b.release({ status: "done" }); await tick(); q.clearFinished(); check("clearing drops finished entries", q.snapshot().entries.length === 0);
}
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); } else console.log("\nALL PASS");
