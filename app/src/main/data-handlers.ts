// History, Settings and your data (phase 7). The main process owns every path and dialog: the page only asks. Settings are checked as a WHOLE by the engine. "Delete everything"
// needs the exact typed phrase here as well as on the page.
import path from "node:path";
import type { Handlers } from "./ipc.ts";
import type { Host } from "./core/host.ts";
import type { UiSettings, UiSummary } from "../shared/contract.ts";
import { toRow } from "./jobs-handlers.ts";
import { TONES } from "../../../engine/src/agents/prompts.ts";
import { ACCENTS } from "../../../engine/src/cv/html.ts";
import { exportAll, importExport, inspectExport } from "../../../engine/src/store/export.ts";
import { deleteJobsAndCvs, jobFolders, runningJobs } from "../../../engine/src/store/delete.ts";
import { writeFile } from "node:fs/promises";
import { EXTENSION, buildDocx, safeName, textToHtml, type TextFormat } from "./export-text.ts";
import { usageLines } from "../../../engine/src/access/messages.ts";
import { usageSummary } from "../../../engine/src/access/ledger.ts";
import { BACKUPS_DIR } from "../../../engine/src/store/open.ts";
import { historySummary, searchJobs } from "../../../engine/src/store/jobs-index.ts";

export const DELETE_PHRASE = "delete everything";
type Deps = { host: Host; now?: () => Date; version: string; chooseExportFile: () => Promise<string | null>; chooseTextFile?: (suggested: string, format: TextFormat) => Promise<string | null>; renderPdf?: (html: string) => Promise<Buffer>; chooseImportFile?: () => Promise<string | null>; jobsChanged?: () => void; setLoginItem: (on: boolean) => void; setAppearance?: (v: string) => void; afterDelete: () => void };
export function createDataHandlers(d: Deps): Pick<Handlers, "history:search" | "history:summary" | "settings:get" | "settings:set" | "data:export" | "data:saveText" | "data:delete" | "data:deleteJobs" | "data:importPick" | "data:importConfirm"> {
  const now = () => d.now?.() ?? new Date();
  const core = () => { const c = d.host.core(); if (!c) throw new Error("not ready"); return c; };
  let picked: string | null = null;
  // A restore or a delete shuts the core down first. If the engine then REFUSES (for example a job is still running), the app must carry on as before: close the old store and start the core again.
  // The commonest refusal (a job is running) is checked BEFORE anything is shut down; restarting a core while a job runs would mark that job as stuck.
  const jobRunning = async (c: { jobsDir: string; queue: { idle: () => boolean } }) => !c.queue.idle() || runningJobs((await jobFolders(c.jobsDir)).jobs).length > 0;
  const revive = async (c: { db: { close: () => void } }) => { try { c.db.close(); } catch { /* already closed */ } await d.host.start(); };
  const view = (): UiSettings => { const c = core(), s = c.settings.get().settings; return { onboardingDone: s["onboarding.done"], usage: usageLines(usageSummary(c.db, now()) as never), tone: s.tone, accent: s.accent, appearance: s.appearance, showRightToWork: s.showRightToWork, notify: { analysed: s["notify.analysed"], cvReady: s["notify.cvReady"], needsInput: s["notify.needsInput"], failed: s["notify.failed"] }, updateCheck: s.updateCheck, startAtLogin: s.startAtLogin, capUsd: s["spend.monthlyCapUsd"], tones: [...TONES], accents: Object.keys(ACCENTS), version: d.version }; };
  return {
    "history:search": ({ text, verdict, sort, offset }) => {
      const r = searchJobs(core().db, { text: text || undefined, verdict: verdict ? [verdict] : undefined, sort, limit: 200, offset: offset && /^\d{1,7}$/.test(offset) ? Number(offset) : 0 });
      return { rows: r.rows.filter((x) => x.id).map((x) => toRow({ id: x.id!, dir: "", status: x.status, created: x.created, updated: x.updated, source: x.source === "link" ? "link" : "text", company: x.company ?? undefined, role: x.role ?? undefined, verdict: x.verdict ?? undefined, fit: x.fit ?? undefined } as never)), total: r.total };
    },
    "history:summary": (): UiSummary => { const s = historySummary(core().db); return { jobs: s.jobs, analysed: s.analysed, built: s.built, avgFit: s.averageFit === null ? null : Math.round(s.averageFit), apply: s.verdicts.apply ?? 0, long_shot: s.verdicts.long_shot ?? 0, skip: s.verdicts.skip ?? 0 }; },
    "settings:get": () => view(),
    "settings:set": ({ patch }) => {
      const p: Record<string, unknown> = {}, map: Record<string, string> = { tone: "tone", accent: "accent", appearance: "appearance", showRightToWork: "showRightToWork", updateCheck: "updateCheck", startAtLogin: "startAtLogin", capUsd: "spend.monthlyCapUsd", notifyAnalysed: "notify.analysed", notifyCvReady: "notify.cvReady", notifyNeedsInput: "notify.needsInput", notifyFailed: "notify.failed", onboardingDone: "onboarding.done" };
      for (const [k, v] of Object.entries(patch)) { if (!Object.hasOwn(map, k)) return { ok: false, errors: ["That setting can't be changed here."] }; p[map[k]] = v; }
      const r = core().settings.set(p as never);
      if (!r.ok) return { ok: false, errors: ["One of those values isn't allowed, so nothing was changed."] };
      if (typeof patch.startAtLogin === "boolean") d.setLoginItem(patch.startAtLogin);
      if (typeof patch.appearance === "string") d.setAppearance?.(patch.appearance);
      return { ok: true, settings: view() };
    },
    "data:export": async () => {
      const c = core(); const file = await d.chooseExportFile(); if (!file) return { status: "cancelled" };
      const r = await exportAll(c.db, c.jobsDir, file, { now: now() }); return r.ok ? { status: "saved", jobs: r.jobs, files: r.files, bytes: r.bytes } : { status: "failed" };
    },
    "data:saveText": async ({ name, text, format }) => {
      if (!d.chooseTextFile) return { status: "failed" };
      const fmt: TextFormat = format ?? "txt", ext = EXTENSION[fmt];
      const file = await d.chooseTextFile(safeName(name) + ext, fmt); if (!file) return { status: "cancelled" };
      try {
        const target = file.toLowerCase().endsWith(ext) ? file : `${file}${ext}`;
        if (fmt === "txt") await writeFile(target, text.endsWith("\n") ? text : `${text}\n`, "utf8");
        else if (fmt === "docx") await writeFile(target, buildDocx(text));
        else { if (!d.renderPdf) return { status: "failed" }; await writeFile(target, await d.renderPdf(textToHtml(text))); }
        return { status: "saved" };
      } catch { return { status: "failed" }; }
    },
    "data:deleteJobs": async ({ phrase }) => {
      if (phrase.trim().toLowerCase() !== "delete jobs") return { deleted: false, jobs: 0 };
      const c = core(), r = await deleteJobsAndCvs(c.db, c.jobsDir, { confirmed: true }); if (!r.ok) return { deleted: false, jobs: 0 };
      d.jobsChanged?.(); return { deleted: true, jobs: r.jobs };
    },
    "data:importPick": async () => {
      picked = null; // a new pick (even a cancelled or invalid one) forgets the earlier copy
      const f = await d.chooseImportFile?.(); if (!f) return { status: "cancelled" };
      const r = await inspectExport(f); if (!r.ok) return { status: "invalid" };
      picked = f; return { status: "picked", jobs: r.summary.jobs, createdAt: r.summary.createdAt, hasProfile: r.summary.hasProfile };
    },
    "data:importConfirm": async ({ phrase }) => {
      if (!picked || phrase.trim().toLowerCase() !== "replace everything") return { imported: false };
      const c = core(); if (await jobRunning(c)) return { imported: false }; await c.shutdown({ finalBackup: true, keepDb: true });
      const r = await importExport({ zipFile: picked, db: c.db, jobsDir: c.jobsDir, backupsDir: path.join(c.dataDir, BACKUPS_DIR), now: now(), confirmReplace: true }); picked = null;
      if (r.ok) setTimeout(d.afterDelete, 1500); else await revive(c); return { imported: r.ok };
    },
    "data:delete": async ({ phrase }) => {
      if (phrase.trim().toLowerCase() !== DELETE_PHRASE) return { deleted: false, warnings: [] };
      const c = core(); if (await jobRunning(c)) return { deleted: false, warnings: [] }; const r = await c.deleteEverything(true); if (!r.ok) { await revive(c); return { deleted: false, warnings: [] }; }
      setTimeout(d.afterDelete, 1500); return { deleted: true, warnings: r.warnings };
    },
  };
}
