// Notifications (phase 4g). macOS notifications cannot work from an unsigned app (PRD 07), so the notifications ARE: the menu-bar state, an in-app banner, a Dock badge and, when the
// window is hidden, one Dock bounce. This module decides WHEN (from job status changes it sees live, never from the state found at start-up) and WHAT; the Electron objects are
// passed in, so it is tested with fakes. Wording: DRAFT (see ISSUES.md).
import type { JobState } from "../../../../engine/src/pipeline.ts";
import type { Settings } from "../../../../engine/src/store/settings-store.ts";
import type { UiBanner } from "../../shared/contract.ts";

export type TrayState = "idle" | "working" | "needs_you";
export type NotifierDeps = {
  settings: () => Settings; windowVisible: () => boolean; now?: () => Date;
  push: (n: UiBanner) => void;                       // the in-app banner
  tray: (state: TrayState, needsYou: number, working: number) => void;
  dock: { bounce(): void; badge(text: string): void };
  max?: number;
  storage?: { read(): UiBanner[]; write(list: UiBanner[]): void }; // banners kept across restarts (a list on disk); loaded once at the first seed, never announced again
};
const NEEDS = new Set(["paused", "needs_input", "interrupted", "failed"]);
export const NOTICE_COPY = {
  analysed: (t: string, v?: string, fit?: number) => ({ title: "Job analysed", body: `${t}${v ? `: ${v}${typeof fit === "number" ? `, fit ${fit}%` : ""}` : ""}` }),
  built: (t: string) => ({ title: "Your CV is ready", body: t }),
  needs_input: (t: string) => ({ title: "A job needs your answer", body: t }),
  paused: (t: string) => ({ title: "A job is paused", body: `${t}. Open it to see why.` }),
  failed: (t: string) => ({ title: "A job didn't finish", body: t }),
};
const VERDICT = { apply: "Apply", long_shot: "Long shot", skip: "Skip" } as Record<string, string>;
const titleOf = (j: JobState) => [j.company, j.role].filter(Boolean).join(", ") || "New job";

export function createNotifier(d: NotifierDeps) {
  const seen = new Map<string, string>(), notices: UiBanner[] = [], max = d.max ?? 8; let working = 0, seq = 0, loaded = false;
  const setting = (k: "notify.analysed" | "notify.cvReady" | "notify.needsInput" | "notify.failed") => { try { return d.settings()[k] !== false; } catch { return true; } };
  const needs = () => [...seen.values()].filter((s) => NEEDS.has(s)).length;
  const refresh = () => {
    const n = needs(), state: TrayState = n > 0 ? "needs_you" : working > 0 ? "working" : "idle";
    d.tray(state, n, working); d.dock.badge(n > 0 ? String(n) : "");
  };
  const save = () => { try { d.storage?.write(notices.slice()); } catch { /* a banner that is not saved is only lost at the next restart */ } };
  function add(kind: UiBanner["kind"], jobId: string, copy: { title: string; body: string }, allowed: boolean) {
    if (!allowed) return;
    const n: UiBanner = { id: `n${++seq}`, kind, jobId, title: copy.title, body: copy.body, at: (d.now?.() ?? new Date()).toISOString() };
    notices.unshift(n); notices.length = Math.min(notices.length, max); save();
    d.push(n); if (!d.windowVisible()) d.dock.bounce();
  }
  return {
    // Start-up: remember where every job is, without announcing anything.
    seed(jobs: JobState[]) {
      seen.clear(); for (const j of jobs) seen.set(j.id, j.status);
      if (!loaded) { loaded = true; let old: UiBanner[] = []; try { old = d.storage?.read() ?? []; } catch { old = []; }
        for (const b of old) { notices.push(b); const k = /^n(\d+)$/.exec(b.id); if (k) seq = Math.max(seq, Number(k[1])); }
        notices.length = Math.min(notices.length, max); }
      const before = notices.length; for (let i = notices.length - 1; i >= 0; i--) if (!seen.has(notices[i].jobId)) notices.splice(i, 1); // a banner for a job that no longer exists goes away
      if (notices.length !== before) save();
      refresh();
    },
    onJob(j: JobState) {
      const prev = seen.get(j.id); seen.set(j.id, j.status);
      if (prev !== undefined && prev !== j.status) {
        const t = titleOf(j);
        if (j.status === "analysed" && prev === "analysing") add("analysed", j.id, NOTICE_COPY.analysed(t, VERDICT[j.verdict ?? ""], j.fit), setting("notify.analysed"));
        else if (j.status === "built") add("built", j.id, NOTICE_COPY.built(t), setting("notify.cvReady"));
        else if (j.status === "needs_input") add("needs_input", j.id, NOTICE_COPY.needs_input(t), setting("notify.needsInput"));
        else if (j.status === "paused") add("paused", j.id, NOTICE_COPY.paused(t), setting("notify.failed"));
        else if (j.status === "failed") add("failed", j.id, NOTICE_COPY.failed(t), setting("notify.failed"));
      }
      refresh();
    },
    onQueue(running: number) { working = running; refresh(); },
    list: () => notices.slice(),
    dismiss(id: string) { const i = notices.findIndex((n) => n.id === id); if (i >= 0) { notices.splice(i, 1); save(); } return i >= 0; },
    dismissJob(jobId: string) { const before = notices.length; for (let i = notices.length - 1; i >= 0; i--) if (notices[i].jobId === jobId) notices.splice(i, 1); if (notices.length !== before) save(); },
  };
}
export type Notifier = ReturnType<typeof createNotifier>;
