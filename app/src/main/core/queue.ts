// The job queue (phase 4d, PRD 00 and 10): one job at a time with a visible queue, built for a concurrency setting so parallel jobs are a setting, not a rewrite. Each task is
// isolated; the queue knows nothing about the pipeline (a task is a function). A job that PAUSES (login, limit, outage, spend cap) BLOCKS the queue: nothing new starts until the
// user resumes it or skips it, because the same problem would stop every later job too. A job that needs the user's answer (a missing fact) or was interrupted does NOT block.
export type TaskOutcome = { status: "done" } | { status: "paused"; kind: string } | { status: "needs_input" } | { status: "failed"; reason: string };
export type QueueTask = { id: string; label: string; run: () => Promise<TaskOutcome> };
export type EntryState = "queued" | "running" | "paused" | "needs_input" | "done" | "failed" | "skipped" | "cancelled";
export type QueueEntry = { id: string; label: string; state: EntryState; position: number | null; kind?: string; reason?: string };
export type QueueSnapshot = { entries: QueueEntry[]; blocked: boolean; running: number; concurrency: number };

export function createQueue(o: { concurrency?: number; onChange?: (s: QueueSnapshot) => void; onError?: (e: unknown) => void } = {}) {
  const concurrency = Math.max(1, Math.floor(o.concurrency ?? 1));
  type E = { task: QueueTask; state: EntryState; kind?: string; reason?: string };
  const entries: E[] = []; let pumping = false;
  const active = () => entries.filter((e) => e.state === "running").length, blocked = () => entries.some((e) => e.state === "paused");
  const snapshot = (): QueueSnapshot => { let pos = 0; return { entries: entries.map((e) => ({ id: e.task.id, label: e.task.label, state: e.state, position: e.state === "queued" ? ++pos : null, ...(e.kind ? { kind: e.kind } : {}), ...(e.reason ? { reason: e.reason } : {}) })), blocked: blocked(), running: active(), concurrency }; };
  const changed = () => { try { o.onChange?.(snapshot()); } catch (e) { o.onError?.(e); } }; // a screen's handler must never break the queue

  async function runEntry(e: E): Promise<void> {
    e.state = "running"; delete e.kind; delete e.reason; changed();
    try {
      const r = await e.task.run();
      if (r.status === "done") e.state = "done"; else if (r.status === "paused") { e.state = "paused"; e.kind = r.kind; } else if (r.status === "needs_input") e.state = "needs_input"; else { e.state = "failed"; e.reason = r.reason; }
    } catch (err) { e.state = "failed"; e.reason = "The job stopped unexpectedly."; o.onError?.(err); } // the reason is a plain sentence, never the error text
    changed();
  }
  function pump(): void {
    if (pumping) return; pumping = true;
    try {
      for (;;) {
        if (blocked() || active() >= concurrency) break;
        const next = entries.find((e) => e.state === "queued"); if (!next) break;
        void runEntry(next).then(() => pump());
      }
    } finally { pumping = false; }
  }
  const find = (id: string) => entries.find((e) => e.task.id === id);
  return {
    // The same job id is never queued twice at once: asking again returns what is there.
    enqueue(task: QueueTask): { accepted: boolean; state: EntryState } {
      const ex = find(task.id);
      if (ex && (ex.state === "queued" || ex.state === "running" || ex.state === "paused")) return { accepted: false, state: ex.state };
      if (ex) entries.splice(entries.indexOf(ex), 1); // an earlier finished entry of the same job is replaced by the new one
      entries.push({ task, state: "queued" }); changed(); pump(); return { accepted: true, state: find(task.id)!.state };
    },
    // Put back an entry that was already paused or waiting before a restart: it is shown, a paused one blocks the queue, and nothing runs until the user resumes it.
    adopt(task: QueueTask, state: "paused" | "needs_input", kind?: string): void { if (find(task.id)) return; entries.push({ task, state, ...(kind ? { kind } : {}) }); changed(); },
    // Resume a paused (or needs-input) entry: the SAME task runs again (the pipeline continues from its kept steps); it goes to the front of the line.
    resume(id: string): boolean { const e = find(id); if (!e || (e.state !== "paused" && e.state !== "needs_input")) return false; e.state = "queued"; delete e.kind; entries.splice(entries.indexOf(e), 1); entries.unshift(e); changed(); pump(); return true; },
    // Skip a paused or waiting entry: it is finished as skipped and the queue moves on.
    skip(id: string): boolean { const e = find(id); if (!e || (e.state !== "paused" && e.state !== "needs_input" && e.state !== "queued")) return false; e.state = "skipped"; changed(); pump(); return true; },
    cancel(id: string): boolean { const e = find(id); if (!e || e.state !== "queued") return false; e.state = "cancelled"; changed(); return true; },
    // Finished entries are dropped from view (History keeps the jobs).
    clearFinished(): void { for (let i = entries.length - 1; i >= 0; i--) if (["done", "failed", "skipped", "cancelled"].includes(entries[i].state)) entries.splice(i, 1); changed(); },
    snapshot,
    idle: () => !entries.some((e) => e.state === "running" || e.state === "queued"),
  };
}
