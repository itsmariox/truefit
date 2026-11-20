// The handlers for jobs (phase 4f). The main process turns engine data into what the page shows (rows, a verdict card, a pause message in the approved catalogue's words).
// A link is fetched here (never in the page) by an injected function; any failure becomes the plain reason "link_failed". Nothing is sent to Claude when a job is created.
import { existsSync } from "node:fs";
import path from "node:path";
import type { Handlers } from "./ipc.ts";
import type { Host } from "./core/host.ts";
import type { AppCore } from "./core/app-core.ts";
import type { CreateJobOutcome, UiBuild, UiExtra, UiJobDetail, UiJobRow, UiRule, UiVerdict } from "../shared/contract.ts";
import type { JobState } from "../../../engine/src/pipeline.ts";
import { toUi } from "./handlers.ts";

const VERDICTS = new Set(["apply", "long_shot", "skip"]);
const str = (x: unknown, max = 600) => (typeof x === "string" ? x.slice(0, max) : "");
export const titleOf = (j: JobState) => [j.company, j.role].filter(Boolean).join(", ") || "New job";
export const toRow = (j: JobState): UiJobRow => ({ id: j.id, title: titleOf(j), status: j.status, verdict: VERDICTS.has(j.verdict ?? "") ? (j.verdict as UiJobRow["verdict"]) : null, fit: typeof j.fit === "number" ? j.fit : null,
  needsYou: j.status === "paused" || j.status === "needs_input" || j.status === "interrupted" || j.status === "failed", updated: j.updated });

export function toVerdict(a: Record<string, any> | null): UiVerdict | null {
  if (!a || !VERDICTS.has(a.verdict) || typeof a.fit_percent !== "number") return null;
  const rules: UiRule[] = (Array.isArray(a.constraint_checks) ? a.constraint_checks : []).filter((r: any) => r && ["ok", "fail", "unclear"].includes(r.status)).map((r: any) => ({ rule: str(r.rule, 40), status: r.status, note: str(r.note, 300) }));
  return { verdict: a.verdict, fit: Math.max(0, Math.min(100, Math.round(a.fit_percent))), fitNote: str(a.fit_note), summary: str(a.summary, 900), location: str(a.location, 120), workMode: str(a.work_mode, 40), salary: a.salary_text ? str(a.salary_text, 120) : null, seniority: str(a.seniority, 60),
    rules, strengths: (Array.isArray(a.strengths) ? a.strengths : []).slice(0, 8).map((x: any) => str(x?.text, 300)).filter(Boolean), gaps: (Array.isArray(a.gaps) ? a.gaps : []).slice(0, 8).map((x: any) => ({ gap: str(x?.gap, 300), handle: str(x?.handle, 300) })).filter((g: { gap: string }) => g.gap) };
}

// Which core events make the page re-read the lists. A recovery signal and a step starting or ending change nothing the lists show (an engine run has about ten steps).
export const eventChangesLists = (e: { type: string }) => e.type !== "recovery" && e.type !== "step";
export function createJobsHandlers(d: { host: Host; now?: () => Date; fetchAd: (url: string) => Promise<{ url: string; text: string }>; push: (rows: UiJobRow[]) => void; openPath?: (file: string) => Promise<string>; reveal?: (file: string) => void }): Pick<Handlers, "jobs:list" | "jobs:get" | "jobs:create" | "jobs:analyse" | "jobs:resume" | "jobs:skip" | "jobs:build" | "jobs:extra" | "jobs:openPdf" | "jobs:reveal"> {
  const now = () => d.now?.() ?? new Date();
  const core = (): AppCore => { const c = d.host.core(); if (!c) throw new Error("not ready"); return c; };
  const rows = async () => (await core().jobs.states()).sort((a, b) => b.updated.localeCompare(a.updated)).map(toRow);
  let wired: AppCore | null = null;
  // One listener per core: any job or queue change tells the page to re-read (a short delay merges bursts).
  const wire = (c: AppCore) => { if (wired === c) return; wired = c; let t: ReturnType<typeof setTimeout> | null = null; c.onEvent((e) => { if (!eventChangesLists(e) || t) return; t = setTimeout(async () => { t = null; try { d.push(await rows()); } catch { /* the core was closed */ } }, 50); }); };
  const refuse = (reason: Extract<CreateJobOutcome, { outcome: "refused" }>["reason"], missing: string[] = []): CreateJobOutcome => ({ outcome: "refused", reason, missing });
  const lookup = async (id: string) => { const j = await core().jobs.get(id); if (!j) throw new Error("no such job"); return j; };
  return {
    "jobs:list": () => { wire(core()); return rows(); },
    "jobs:get": async ({ id }): Promise<UiJobDetail | null> => {
      const c = core(); wire(c); const x = await c.jobs.detail(id); if (!x) return null;
      const q = c.queue.snapshot().entries.find((e) => e.id === id);
      const pause = x.job.status === "paused" ? toUi(c.access.describePause(c.jobs.pauseKind(x.job))) : null;
      const st = x.job.status; const build: UiBuild = { state: st === "building" ? "building" : st === "needs_input" && x.job.needs === "fact" ? "needs_fact" : st === "needs_input" && x.job.needs === "layout" ? "needs_layout" : st === "built" ? "built" : st === "failed" && x.pdf === false && x.job.resumeAt === undefined && /CV|checks|rules|selection/i.test(x.job.note ?? "") ? "failed" : "none",
        question: x.question ? str(x.question, 1500) : null, layoutWhy: st === "needs_input" && x.job.needs === "layout" ? str(x.job.note, 300) : null, pdf: x.pdf, versions: x.versions };
      const extras: UiExtra[] = Object.entries(x.extras).map(([kind, text]) => ({ kind: kind as UiExtra["kind"], text: str(text, 6000) }));
      // note: a failure note may quote a file path, so paths are scrubbed (the page never gets one)
      return { build, extras, id, title: titleOf(x.job), status: x.job.status, source: x.job.source, url: x.job.url ?? null, note: x.job.note ? x.job.note.replace(/(?:\/[^\s/'"]+){2,}/g, "[path]") : null, verdict: toVerdict(x.analysis), coach: x.coach ? str(x.coach, 1500) : null, pause, queue: q && (q.state === "queued" || q.state === "running") ? { state: q.state, position: q.position, blocked: q.state === "queued" && c.queue.snapshot().blocked } : null };
    },
    "jobs:create": async ({ text, force }): Promise<CreateJobOutcome> => {
      const c = core(); wire(c); let ad = text.trim(), url: string | undefined, source: "text" | "link" = "text";
      if (/^https?:\/\/\S+$/i.test(ad)) { // one link on its own: read the page (the main process does this, with its own safety checks)
        try { const f = await d.fetchAd(ad); url = f.url; ad = f.text; source = "link"; } catch { return refuse("link_failed"); }
      }
      const r = await c.jobs.create(ad, source, url, { force: force === true });
      if (r.ok) return { outcome: "created", job: toRow(r.job) };
      if (r.reason === "duplicate") return { outcome: "duplicate", existing: toRow(r.existing) };
      return refuse(r.reason, r.missing ?? []);
    },
    "jobs:analyse": async ({ id }) => { const c = core(), j = await lookup(id); const r = c.jobs.analyse(j); return { queued: r.ok, reason: r.ok ? null : r.reason, note: r.ok ? null : r.note ?? null }; },
    "jobs:resume": async ({ id }) => { const c = core(), j = await lookup(id); const r = c.jobs.resume(j); return { queued: r.ok, reason: r.ok ? null : r.reason, note: r.ok ? null : r.note ?? null }; },
    "jobs:build": async ({ id, layout, ignoreQuestions, refreshProfile }) => { const c = core(), j = await lookup(id); const r = c.jobs.build(j, { layout, ignoreQuestions, refreshProfile }); return { queued: r.ok, reason: r.ok ? null : r.reason, note: r.ok ? null : r.note ?? null }; },
    "jobs:extra": async ({ id, kind }) => { const c = core(), j = await lookup(id); const r = c.jobs.extra(j, kind); return { queued: r.ok, reason: r.ok ? null : r.reason, note: r.ok ? null : r.note ?? null }; },
    "jobs:openPdf": async ({ id }) => { const j = await lookup(id), file = path.join(j.dir, "cv.pdf"); if (!existsSync(file) || !d.openPath) return { opened: false }; return { opened: (await d.openPath(file)) === "" }; },
    "jobs:reveal": async ({ id }) => { const j = await lookup(id), file = path.join(j.dir, "cv.pdf"); if (!existsSync(file) || !d.reveal) return { shown: false }; d.reveal(file); return { shown: true }; },
    "jobs:skip": async ({ id }) => { const c = core(), j = await lookup(id); await c.jobs.skip(j); void now; return { skipped: true }; },
  };
}
