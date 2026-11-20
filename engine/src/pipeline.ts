// The orchestrator (phase 1 step 7b): plain code, no AI. It runs the agents in a fixed order through an AgentRunner, checks every result in code,
// renders and checks the CV, and keeps each job's status in its own folder. Everything it needs arrives as a parameter (jobs folder, profile,
// runner, renderer): no environment variable, no global.
//   analyse(job) -> Analyst, code checks, Coach "verdict"                  (then the user presses Build CV or Skip)
//   build(job)   -> Writer, rules (1 retry), render + fit + ATS checks, Checker (1 fix round), Coach "delivered"
//   extra(job)   -> Coach with one on-request skill; texts the user will send or say are fact-checked and scanned for Do-not-use items
// A transient failure (login, limit, outage, account, timeout) PAUSES the job and keeps every finished step; asking again resumes where it stopped.
import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { EXIT, PAUSABLE } from "./agents/errors.ts";
import type { AgentRunner } from "./agents/runner.ts";
import { normalise, oneLine, quoteExists, scanForInjection } from "./checks.ts";
import { makeCv } from "./cv/fit.ts";
import type { Accent, FontUrls } from "./cv/html.ts";
import type { PdfRenderer } from "./cv/render.ts";
import { scanText, validateCvSelection } from "./cv/selection.ts";
import type { CvSelection, WriterMode } from "./cv/selection.ts";
import { extraLines, profileToPersona } from "./profile.ts";
import { describePause } from "./access/messages.ts";
import type { Profile, ProfilePersona, Rules } from "./profile.ts";

export const ENGINE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export const EXTRAS = ["cover-note", "interview-prep", "recruiter-message", "company-brief"] as const;
export type Extra = (typeof EXTRAS)[number];
// Texts the user will send or say about themselves are fact-checked and scanned; the company brief carries sources instead.
export const CHECKED_EXTRAS: Extra[] = ["cover-note", "recruiter-message", "interview-prep"];
export type JobStatus = "analysing" | "analysed" | "building" | "needs_input" | "paused" | "interrupted" | "built" | "failed" | "skipped";
export type JobState = {
  id: string; dir: string; status: JobStatus; created: string; updated: string; source: "text" | "link"; url?: string;
  company?: string; role?: string; verdict?: string; fit?: number; note?: string;
  resumeAt?: "analyse" | "build"; needs?: "fact" | "layout";
};
export type PipelineConfig = { accent: Accent; showRightToWork: boolean; resumeProfile: "snapshot" | "current"; writerMode?: WriterMode }; // writerMode must equal the runner's (default choose-and-order)
export type PipelineDeps = {
  jobsDir: string;                                  // REQUIRED: never guessed, so a run can never write jobs into the wrong place
  profile: Profile;                                 // the user's current profile; each job keeps its own snapshot (see config.resumeProfile)
  runnerFor: (profile: Profile) => AgentRunner;     // a runner bound to ONE profile (the job's)
  renderer: PdfRenderer; fonts: FontUrls; config: PipelineConfig; now?: () => Date;
  onStep?: (e: { jobId: string; scope: string; name: string; phase: "start" | "done" }) => void; // a step of a run begins or ends (the app shows which agent is working); never called for a kept step; an error in it never breaks a job
  onJobChange?: (job: JobState) => void;           // called after every saved job state (the History index listens); an error in it never breaks a job
};

// ---- errors ----
export type StepKind = "auth" | "rate_limit" | "unavailable" | "account" | "timeout" | "cap" | "setup" | "isolation" | "other";
const KIND_BY_CODE: Record<number, StepKind> = { [EXIT.setup]: "setup", [EXIT.auth]: "auth", [EXIT.rate_limit]: "rate_limit", [EXIT.unavailable]: "unavailable", [EXIT.account]: "account", [EXIT.isolation]: "isolation", [EXIT.timeout]: "timeout", [EXIT.cap]: "cap" };
export class StepError extends Error {
  kind: StepKind; pausable: boolean; job?: JobState;
  constructor(kind: StepKind, message: string, pausable = false) { super(message); this.kind = kind; this.pausable = pausable; }
}
// The note on a paused job is the TITLE of the matching message in the access catalogue (src/access/messages.ts): one set of words for the whole app.
const PLAIN: Record<string, string> = Object.fromEntries((["auth", "rate_limit", "unavailable", "account", "timeout", "cap"] as const).map((k) => [k, describePause(k, { now: new Date(0) }).title + "."]));

// ---- job folders, status, progress ----
const readJson = async (f: string) => JSON.parse(await readFile(f, "utf8"));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "x";
// The folder path is NEVER saved in a job's files (it holds the user name and breaks when the data folder moves, is restored or is imported on another Mac): the state is
// written without it and loadState puts back the folder it was read from.
export const loadState = async (dir: string): Promise<JobState> => ({ ...(await readJson(path.join(dir, "status.json"))), dir });
export async function saveStateFile(s: JobState, now = new Date()): Promise<JobState> {
  const next = { ...s, updated: now.toISOString() };
  const { dir: _dir, ...onDisk } = next; void _dir;
  await writeFile(path.join(s.dir, "status.json"), JSON.stringify(onDisk, null, 2), "utf8");
  return next;
}
export const saveState = saveStateFile;
type Progress = { steps: Record<string, unknown> };
const progressFile = (dir: string) => path.join(dir, "progress.json");
const loadProgress = async (dir: string): Promise<Progress> => readJson(progressFile(dir)).catch(() => ({ steps: {} }));
// A step runs once and its (small, JSON) result is kept in the job folder: asking again after a pause returns the kept result instead of running it again.
function stepper(getDir: () => string, scope: string, notify?: (name: string, phase: "start" | "done") => void) {
  const key = (n: string) => `${scope}:${n}`;
  return {
    async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
      const p = await loadProgress(getDir());
      if (key(name) in p.steps) return p.steps[key(name)] as T;
      try { notify?.(name, "start"); } catch { /* display only */ }
      const value = await fn();
      const q = await loadProgress(getDir()); q.steps[key(name)] = value; await writeFile(progressFile(getDir()), JSON.stringify(q, null, 2));
      try { notify?.(name, "done"); } catch { /* display only */ }
      return value;
    },
    async clear(onlyPrefix = "") { const p = await loadProgress(getDir()); for (const k of Object.keys(p.steps)) if (k.startsWith(key(onlyPrefix))) delete p.steps[k]; await writeFile(progressFile(getDir()), JSON.stringify(p, null, 2)); },
    async has(name: string) { return key(name) in (await loadProgress(getDir())).steps; },
  };
}
// A hash of the CONTENT: object keys are sorted first, so the same profile in a different key order (for example after schema v2 re-serialised it) hashes the same.
const canonical = (x: unknown): unknown => (Array.isArray(x) ? x.map(canonical) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonical((x as Record<string, unknown>)[k])])) : x);
const hashOf = (x: unknown) => createHash("sha256").update(JSON.stringify(canonical(x))).digest("hex").slice(0, 16);

// ---- code checks on the Analyst's answer ----
export function checkAnalysis(a: any, ctx: ProfilePersona, rules: Rules, adText: string): { analysis: any; notes: string[] } {
  const notes: string[] = [];
  for (const r of a.requirements ?? []) {
    if ((r.rating === "strong" || r.rating === "moderate") && !quoteExists(ctx.text, String(r.evidence_quote ?? ""))) {
      notes.push(`"${oneLine(r.text, 60)}": the evidence quote is not in the profile, so it was downgraded to weak`);
      r.rating = "weak"; r.note = `${r.note ?? ""} (evidence quote not found in the profile; downgraded by code)`.trim();
    }
  }
  const floor = rules.salaryFloor;
  if (floor && floor.currency === "GBP" && typeof a.salary_min_gbp === "number" && a.salary_min_gbp > 0 && a.salary_min_gbp < floor.amount) {
    const note = `stated salary from £${a.salary_min_gbp.toLocaleString("en-GB")} is below your £${floor.amount.toLocaleString("en-GB")} floor`;
    const c = (a.constraint_checks ?? []).find((x: any) => x.rule === "salary");
    if (c) { c.status = "fail"; c.note = note; } else (a.constraint_checks ??= []).push({ rule: "salary", status: "fail", note });
  }
  const failed = (a.constraint_checks ?? []).filter((c: any) => c.status === "fail");
  if (failed.length && a.verdict === "apply") { a.verdict = "long_shot"; notes.push(`verdict lowered from apply to long shot: a hard rule fails (${failed.map((c: any) => c.rule).join(", ")})`); }
  a.fit_percent = Math.max(0, Math.min(100, Math.round(Number(a.fit_percent) || 0)));
  const fallback = ctx.archetypes[0]?.id ?? null;
  if (a.focus_id !== null && !ctx.archetypes.some((x) => x.id === a.focus_id)) { notes.push(`focus type ${a.focus_id} does not exist; using ${fallback ?? "none"}`); a.focus_id = fallback; }
  else if (a.focus_id === null && fallback !== null) a.focus_id = fallback;
  const scan = scanForInjection(adText);
  a.injection_code = scan;
  if (scan.length && !a.injection_suspected) notes.push(`the ad contains wording aimed at AI systems (${scan.join(", ")}); it was treated as data`);
  return { analysis: a, notes };
}

export function analysisMd(a: any): string {
  const rows = (a.requirements ?? []).map((r: any) => `| ${oneLine(r.text, 120)} | ${r.priority} | ${r.rating} | ${oneLine(r.evidence_quote, 140) || "-"} |`);
  return [`# Fit analysis: ${oneLine(a.role, 120)} at ${oneLine(a.company, 80)}`, "", `**Verdict:** ${String(a.verdict).replace("_", " ")} · **fit** ${a.fit_percent}% · focus type ${a.focus_id ?? "none"}`, "",
    `Location: ${oneLine(a.location, 120)} (${oneLine(a.work_mode, 40)}) · Salary: ${oneLine(a.salary_text, 80) || "not stated"} · Years asked: ${a.years_required ?? "-"} · Years (employment only): ${a.experience?.years ?? "-"} (${oneLine(a.experience?.basis, 200)})`, "",
    "| Requirement | Priority | Rating | Evidence (quoted from the profile) |", "|---|---|---|---|", ...rows, "",
    "## Hard rules", ...(a.constraint_checks ?? []).map((c: any) => `- ${c.rule}: **${c.status}** ${oneLine(c.note, 200)}`), "",
    "## Gaps", ...(a.gaps ?? []).map((g: any) => `- **${oneLine(g.gap, 60)}** (${oneLine(g.requirement, 100)}): ${oneLine(g.handle, 240)}`), "",
    "## Notes", `- ${oneLine(a.fit_note, 400)}`, ...(a.code_notes ?? []).map((n: string) => `- Code check: ${n}`), ""].join("\n");
}

// ---- the Checker's answer, verified in code ----
// `guaranteed` = text that code itself put on the CV: the headlines, the bullets word for word, the skills, the role titles, companies, dates and places, the
// education lines and the allowed location lines. A complaint about that text is a Checker mistake, not a CV problem.
export function isGuaranteed(claim: string, guaranteed: string): boolean {
  const g = normalise(guaranteed);
  const quoted = [...claim.matchAll(/['"‘“]([^'"’”]{6,})['"’”]/g)].map((m) => m[1]);
  const after = claim.includes(":") ? claim.slice(claim.indexOf(":") + 1) : "";
  return [...quoted, after].map((x) => normalise(x).replace(/^[\s'"]+|[\s'".]+$/g, "")).some((x) => x.length >= 6 && g.includes(x));
}
export function guaranteedText(profile: Profile, ctx: ProfilePersona, rewordedIds: string[] = []): string {
  // Text code printed WORD FOR WORD. A reworded bullet is never guaranteed (its overlap with the original must not excuse a complaint), and the original of a
  // reworded bullet is not printed at all.
  const reworded = new Set(rewordedIds);
  const roles = profile.roles.filter((r) => r.status === "verified").flatMap((r) => [r.title, r.company, r.location, `${r.title}, ${r.company}`]);
  return [...ctx.archetypes.map((a) => a.headline), ...ctx.bullets.filter((b) => !reworded.has(b.id)).map((b) => b.text), ...ctx.skills.allowed, ...roles, ...profile.education.filter((e) => e.status === "verified").map((e) => e.text), ...Object.values(extraLines(profile.extras)).flat(), ...profile.rules.location.cvLocationLines].join("\n");
}
export function verifyChecker(ch: any, profileText: string, guaranteed = "", rewriteIds: string[] = []): { pass: boolean; problems: string[] } {
  const problems: string[] = [];
  // Light-rewording mode: the Checker must give a verdict for EVERY reworded bullet that is printed; a missing verdict is a failure, never a pass.
  for (const id of rewriteIds) {
    const v = (ch?.rewrite_checks ?? []).find((x: any) => x?.id === id);
    if (!v) problems.push(`reworded bullet ${id}: the Checker did not review it`);
    else if (!v.supported) problems.push(`reworded bullet ${id}: ${oneLine(v.problem, 260) || "it says more than the original"}`);
  }
  for (const c of ch?.claims ?? []) {
    if (!c.supported && guaranteed && isGuaranteed(String(c.claim ?? ""), guaranteed)) continue;
    if (!c.supported) problems.push(`${oneLine(c.claim, 160)}: ${oneLine(c.problem, 260) || "not supported by the profile"}`);
    else if (!quoteExists(profileText, String(c.evidence_quote ?? ""))) problems.push(`${oneLine(c.claim, 120)}: the Checker's evidence quote is not in the profile`);
  }
  for (const r of ch?.rule_breaks ?? []) problems.push(`rule: ${oneLine(r, 200)}`);
  if (!Array.isArray(ch?.claims) || ch.claims.length < 2) problems.push("the Checker returned too few claims to have checked the summary");
  // Code decides: the Checker's own "fail" counts only through the problems that survive the filter above.
  return { pass: problems.length === 0, problems: problems.slice(0, 12) };
}

export async function coachMessage(dir: string, mode: string): Promise<string> {
  const msg = String((await readJson(path.join(dir, `coach-${mode}.json`)).catch(() => ({}))).message ?? "").trim();
  if (msg.length >= 10) return msg;
  // The Coach returned nothing usable: say the facts plainly instead (a channel may refuse an empty message).
  const t = await readJson(path.join(dir, "team.json")).catch(() => ({} as any));
  const head = `${String(t.verdict ?? "?").replace("_", " ")}, ${t.fit_percent ?? "?"}%: ${oneLine(t.role, 100) || "the role"} at ${oneLine(t.company, 60) || "the company"}`;
  const gaps = (t.gaps ?? []).slice(0, 3).map((g: any) => `⚠️ ${oneLine(g.gap, 60)}: ${oneLine(g.handle, 160)}`);
  const lines: Record<string, string[]> = {
    verdict: [head, ...gaps], delivered: ["📎 CV ready.", ...gaps], question: ["I need a fact that isn't in your profile:", ...(t.questions ?? []).map((q: string) => "• " + oneLine(q, 200)), "Answer it, or build without it."],
    failed: ["⚠️ No CV this time. It didn't pass the checks:", ...(t.failed ?? []).slice(0, 4).map((x: string) => "• " + oneLine(x, 200))],
  };
  return `${(lines[mode] ?? [`The ${mode.replace("-", " ")} came back empty. Press the button again to retry.`]).join("\n")}\n\n(Plain version: the Coach's reply was empty.)`;
}

async function writeTeam(dir: string, extra: Record<string, unknown>) {
  const a = await readJson(path.join(dir, "analysis.json")).catch(() => ({}));
  const t = {
    company: a.company, role: a.role, location: a.location, work_mode: a.work_mode, salary: a.salary_text, verdict: a.verdict, fit_percent: a.fit_percent, fit_note: a.fit_note,
    experience: a.experience, strengths: a.strengths, gaps: a.gaps, hard_rule_problems: (a.constraint_checks ?? []).filter((c: any) => c.status !== "ok"),
    unverified_needed: a.unverified_needed, injection: !!a.injection_suspected || (a.injection_code ?? []).length > 0, code_notes: a.code_notes ?? [], ...extra,
  };
  await writeFile(path.join(dir, "team.json"), JSON.stringify(t, null, 2), "utf8");
}
async function nextVersion(dir: string, base: string, ext: string): Promise<number> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const used = names.map((n) => n.match(new RegExp(`^${base}-v(\\d+)\\.${ext}$`))?.[1]).filter(Boolean).map(Number);
  return (used.length ? Math.max(...used) : 0) + 1;
}

export function createPipeline(d: PipelineDeps) {
  const saveState = async (st: JobState, at = new Date()): Promise<JobState> => { const r = await saveStateFile(st, at); try { d.onJobChange?.(r); } catch { /* the index is only a convenience */ } return r; };
  const now = () => d.now?.() ?? new Date();

  async function agent(run: AgentRunner, dir: string, role: string, mode?: string) {
    const r = await run(dir, role, mode);
    if (r.code === 0) return;
    const kind = KIND_BY_CODE[r.code] ?? "other";
    throw new StepError(kind, `${role}${mode ? " (" + mode + ")" : ""} failed: ${r.log.split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 400)}`, PAUSABLE.includes(r.code as never));
  }
  // A pausable error PAUSES the job (every finished step kept). Any other error marks the job FAILED with a plain note and discards the kept steps (a kept
  // step may be the very thing that was wrong, such as an unreadable answer), so pressing the button again really starts over. Either way the job is never
  // left looking busy, and the error is rethrown with the job attached.
  async function guard<T>(current: () => JobState, resumeAt: JobState["resumeAt"], fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (e) {
      const cur = current();
      const latest = { ...(await loadState(cur.dir).catch(() => cur)), dir: cur.dir };
      if (e instanceof StepError && e.pausable) e.job = await saveState({ ...latest, status: "paused", resumeAt, note: PLAIN[e.kind] ?? e.message }, now());
      else if (e instanceof Error) {
        const failed = await saveState({ ...latest, status: "failed", resumeAt: undefined, needs: undefined, note: oneLine(e.message, 200) }, now()).catch(() => undefined);
        await rm(progressFile(cur.dir), { force: true }).catch(() => undefined);
        if (e instanceof StepError) e.job = failed;
        else (e as Error & { job?: JobState }).job = failed;
      }
      throw e;
    }
  }

  async function createJob(adText: string, source: "text" | "link", url?: string, at = now()): Promise<JobState> {
    const id = randomBytes(4).toString("hex");
    const dir = path.join(d.jobsDir, `_incoming-${at.toISOString().slice(0, 10)}-${id}`);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "ad.md"), adText, "utf8");
    await writeFile(path.join(dir, "profile-snapshot.json"), JSON.stringify(d.profile, null, 2), "utf8"); // the profile as it was when the job started
    return saveState({ id, dir, status: "analysing", created: at.toISOString(), updated: at.toISOString(), source, ...(url ? { url } : {}) }, at);
  }
  async function nameJob(s: JobState, company: string, role: string): Promise<JobState> {
    const base = `${slug(company)}-${slug(role)}-${s.created.slice(0, 10)}`;
    let name = base;
    for (let i = 2; i < 50; i++) { try { await stat(path.join(d.jobsDir, name)); name = `${base}-${i}`; } catch { break; } }
    const dir = path.join(d.jobsDir, name);
    await rename(s.dir, dir);
    return { ...s, dir };
  }
  // The profile a job uses: its own snapshot (default), or the current profile (the setting), in which case a changed profile discards the kept steps.
  async function context(job: JobState) {
    const snap = path.join(job.dir, "profile-snapshot.json");
    let profile: Profile = await readJson(snap).catch(() => d.profile);
    if (d.config.resumeProfile === "current" && hashOf(profile) !== hashOf(d.profile)) {
      profile = d.profile; await writeFile(snap, JSON.stringify(profile, null, 2), "utf8"); await rm(progressFile(job.dir), { force: true });
    } else if (!(await stat(snap).catch(() => null))) await writeFile(snap, JSON.stringify(profile, null, 2), "utf8");
    return { profile, ctx: profileToPersona(profile, d.now?.()), run: d.runnerFor(profile) };
  }

  // ---- step 1: analyse ----
  async function analyse(job: JobState): Promise<{ job: JobState; message: string }> {
    let cur = job;
    return guard(() => cur, "analyse", async () => {
      const { profile, ctx, run } = await context(cur);
      const P = stepper(() => cur.dir, "analyse", (name, phase) => d.onStep?.({ jobId: cur.id, scope: "analyse", name, phase }));
      await P.step("analyst", async () => { await agent(run, cur.dir, "analyst"); return true; });
      const named = await P.step("check", async () => {
        const adText = await readFile(path.join(cur.dir, "ad.md"), "utf8");
        const { analysis, notes } = checkAnalysis(await readJson(path.join(cur.dir, "analysis.json")), ctx, profile.rules, adText);
        analysis.code_notes = notes;
        await writeFile(path.join(cur.dir, "analysis.json"), JSON.stringify(analysis, null, 2), "utf8");
        await writeFile(path.join(cur.dir, "fit-analysis.md"), analysisMd(analysis), "utf8");
        const renamed = await nameJob(cur, String(analysis.company || "company"), String(analysis.role || "role"));
        cur = renamed; // the folder was renamed: the kept progress moves with it, and every later path must use the new name
        return { folder: path.basename(renamed.dir), company: oneLine(analysis.company, 80), role: oneLine(analysis.role, 120), verdict: analysis.verdict as string, fit: analysis.fit_percent as number };
      });
      cur = await saveState({ ...cur, dir: path.join(d.jobsDir, named.folder ?? path.basename((named as { dir?: string }).dir ?? cur.dir)), status: "analysed", resumeAt: undefined, needs: undefined, company: named.company, role: named.role, verdict: named.verdict, fit: named.fit, note: undefined }, now());
      await P.step("coach", async () => { await writeTeam(cur.dir, {}); await agent(run, cur.dir, "coach", "verdict"); return true; });
      const message = await coachMessage(cur.dir, "verdict");
      await P.clear();
      return { job: cur, message };
    });
  }

  // ---- step 2: build ----
  type Built = { job: JobState; status: "built" | "needs_input" | "failed"; message: string; pdf?: string };
  async function build(job: JobState, o: { ignoreQuestions?: boolean; layout?: "shorter" | "anyway"; restart?: boolean; refreshProfile?: boolean } = {}): Promise<Built> {
    let cur = job;
    return guard(() => cur, "build", async () => {
      // refreshProfile: the user updated their profile (for example answered a missing fact) and wants THIS job to use it: new snapshot, build starts over.
      if (o.refreshProfile) { await writeFile(path.join(cur.dir, "profile-snapshot.json"), JSON.stringify(d.profile, null, 2), "utf8"); await rm(progressFile(cur.dir), { force: true }); }
      const { profile, ctx, run } = await context(cur);
      const dir = () => cur.dir;
      const P = stepper(dir, "build", (name, phase) => d.onStep?.({ jobId: cur.id, scope: "build", name, phase }));
      if (o.restart) await P.clear();
      if (o.layout) for (const pre of ["render", "checker", "w2", "coach"]) await P.clear(pre); // the user chose a layout: keep what the Writer did, redo the rendering and what follows
      cur = await saveState({ ...cur, status: "building", needs: undefined, note: undefined }, now());
      const validFocus = (f: unknown) => (typeof f === "number" && ctx.archetypes.some((a) => a.id === f) ? f : null);

      await P.step("init", async () => { await rm(path.join(dir(), "writer-problems.json"), { force: true }); await rm(path.join(dir(), "writer-focus.json"), { force: true }); return true; });
      // One Writer turn plus, if code rejects it, one retry with code's exact reasons. The retry's limits are computed for the focus the Writer chose.
      type Chosen = { sel: CvSelection | null; errors: string[]; focus: number | null };
      const runWriter = async (): Promise<Chosen> => {
        await agent(run, dir(), "writer");
        const raw = await readJson(path.join(dir(), "selection-raw.json"));
        const v = validateCvSelection(raw, ctx, { mode: d.config.writerMode ?? "choose-and-order" });
        return { sel: v.selection ?? null, errors: v.errors, focus: validFocus(raw?.focus_id) };
      };
      const choose = async (tag: string, earlier: string[]): Promise<Chosen> => {
        const a = await P.step(`${tag}a`, runWriter);
        if (a.sel) return a;
        await writeFile(path.join(dir(), "writer-problems.json"), JSON.stringify({ source: earlier.length ? "Checker, then code rules" : "code rules", problems: [...earlier, ...a.errors] }, null, 2));
        const analysisFocus = validFocus((await readJson(path.join(dir(), "analysis.json")).catch(() => ({}))).focus_id);
        await writeFile(path.join(dir(), "writer-focus.json"), JSON.stringify({ focus: a.focus ?? analysisFocus }));
        return P.step(`${tag}b`, runWriter);
      };
      const fail = async (problems: string[]): Promise<Built> => {
        const st = await saveState({ ...cur, status: "failed", needs: undefined, note: oneLine(problems[0], 200) }, now());
        cur = st; await writeTeam(st.dir, { failed: problems });
        let message = `⚠️ No CV this time. It didn't pass the checks:\n${problems.slice(0, 4).map((x) => "• " + oneLine(x, 200)).join("\n")}`;
        try { await agent(run, st.dir, "coach", "failed"); message = await coachMessage(st.dir, "failed"); } catch { /* the plain version above is enough */ }
        await P.clear();
        return { job: st, status: "failed", message };
      };
      const render = (tag: string, sel: CvSelection) => P.step(`render:${tag}`, async () => {
        const m = await makeCv(profile, sel, { renderer: d.renderer, fonts: d.fonts, accent: d.config.accent, showRightToWork: d.config.showRightToWork, shorter: o.layout === "shorter", allowMultiPage: o.layout === "anyway" });
        if (m.report.ok) {
          await writeFile(path.join(dir(), "cv.pdf"), m.fit.pdf); await writeFile(path.join(dir(), "cv-text.txt"), m.text, "utf8");
          await writeFile(path.join(dir(), "selection.json"), JSON.stringify(m.fit.selection, null, 2));
        } else await rm(path.join(dir(), "cv.pdf"), { force: true });
        return { ok: m.report.ok, errors: m.report.errors, warnings: m.report.warnings, pages: m.report.pages, overflow: m.report.overflow, dropped: m.fit.droppedBullets, droppedSkills: m.fit.droppedSkills, fitReason: m.fit.reason ?? null };
      });
      const check = (tag: string) => P.step(`checker:${tag}`, async () => {
        await agent(run, dir(), "checker");
        const printed = await readJson(path.join(dir(), "selection.json")).catch(() => ({} as CvSelection));
        const rewordedIds = ((printed.rewrites ?? []) as { id: string }[]).map((r) => r.id);
        return verifyChecker(await readJson(path.join(dir(), "checker.json")), ctx.text, guaranteedText(profile, ctx, rewordedIds), rewordedIds);
      });

      const c1 = await choose("w1", []);
      if (!c1.sel) return fail([`the CV selection broke the rules twice: ${c1.errors.slice(0, 4).join("; ")}`]);
      let sel = c1.sel;
      await writeFile(path.join(dir(), "selection.json"), JSON.stringify(sel, null, 2));
      if (sel.questions.length && !o.ignoreQuestions) {
        cur = await saveState({ ...cur, status: "needs_input", needs: "fact", note: oneLine(sel.questions[0], 200) }, now());
        await P.step("coach:question", async () => { await writeTeam(dir(), { questions: sel.questions }); await agent(run, dir(), "coach", "question"); return true; });
        return { job: cur, status: "needs_input", message: await coachMessage(dir(), "question") };
      }

      // Render, fit and check on the user's Mac, then the Checker; one fix round.
      type R = { ok: boolean; errors: string[]; warnings: string[]; pages: number; overflow: boolean; dropped: string[]; droppedSkills: string[]; fitReason: string | null };
      const layoutChoice = async (r: R): Promise<Built | null> => {
        if (r.ok) return null;
        const onlyOverflow = r.overflow && r.errors.length === 1 && /pages; one page is the target/.test(r.errors[0]);
        if (onlyOverflow && o.layout !== "anyway") {
          const why = r.fitReason ?? `the CV runs to ${r.pages} pages`;
          cur = await saveState({ ...cur, status: "needs_input", needs: "layout", note: oneLine(why, 200) }, now());
          return { job: cur, status: "needs_input", message: `The CV does not fit on one page (${why}). You can try a shorter version, which drops the least relevant bullets, or deliver it anyway as a longer CV.` };
        }
        return fail(r.errors);
      };
      let r1 = await render("1", sel) as R;
      const lc1 = await layoutChoice(r1); if (lc1) return lc1;
      let v1 = await check("1");
      let finalR = r1;
      if (!v1.pass) {
        await P.step("w2prep", async () => { await writeFile(path.join(dir(), "writer-problems.json"), JSON.stringify({ source: "Checker", problems: v1.problems }, null, 2)); await writeFile(path.join(dir(), "writer-focus.json"), JSON.stringify({ focus: sel.focus_id })); return true; });
        const c2 = await choose("w2", v1.problems);
        if (!c2.sel) return fail([...v1.problems, ...c2.errors].slice(0, 6));
        sel = c2.sel;
        const r2 = await render("2", sel) as R;
        const lc2 = await layoutChoice(r2); if (lc2) return lc2;
        const v2 = await check("2");
        if (!v2.pass) { await rm(path.join(dir(), "cv.pdf"), { force: true }); return fail(v2.problems); }
        finalR = r2;
      }
      const headline = ctx.archetypes.find((a) => a.id === sel.focus_id)?.headline ?? profile.roles.find((r) => r.id === sel.roles[0]?.role)?.title;
      const byId = new Map(ctx.bullets.map((b) => [b.id, b.text]));
      await P.step("coach:delivered", async () => {
        const printedSel: CvSelection = await readJson(path.join(dir(), "selection.json")).catch(() => sel);
        const rewrites = (printedSel.rewrites ?? []).map((r) => ({ id: r.id, original: byId.get(r.id) ?? "", reworded: r.text })); // for the "How this CV was built" panel: original and reworded, side by side
        await writeTeam(dir(), { cv: { headline, writer_mode: d.config.writerMode ?? "choose-and-order", rewrites, writer_notes: sel.notes, pages: finalR.pages, trimmed_to_fit: [...finalR.dropped.map((id) => byId.get(id)), ...finalR.droppedSkills], warnings: finalR.warnings, checker: "every claim matched to a profile fact" } });
        await agent(run, dir(), "coach", "delivered");
        return true;
      });
      const n = await nextVersion(dir(), "cv", "pdf");
      await copyFile(path.join(dir(), "cv.pdf"), path.join(dir(), `cv-v${n}.pdf`)); // every built version is kept
      cur = await saveState({ ...cur, status: "built", resumeAt: undefined, needs: undefined, note: undefined }, now());
      const message = await coachMessage(dir(), "delivered");
      await P.clear();
      return { job: cur, status: "built", message, pdf: path.join(dir(), "cv.pdf") };
    });
  }

  // ---- extras, on request only ----
  async function extra(job: JobState, kind: Extra): Promise<string> {
    if (!EXTRAS.includes(kind)) throw new Error(`unknown extra "${kind}"`);
    const { ctx, run } = await context(job);
    const dir = job.dir, P = stepper(() => dir, `extra:${kind}`, (name, phase) => d.onStep?.({ jobId: job.id, scope: `extra:${kind}`, name, phase })), problemsFile = path.join(dir, "extra-problems.json");
    if (!(await P.has("write:1"))) await rm(problemsFile, { force: true });
    const write = (tag: string) => P.step(`write:${tag}`, async () => { await agent(run, dir, "coach", kind); return coachMessage(dir, kind); });
    let msg = await write("1");
    if (CHECKED_EXTRAS.includes(kind)) {
      // Two checks on every text the user will send or say: code scans it for what the profile forbids (the Coach never sees that list), then the Checker
      // checks every claim. A hit gets ONE rewrite with the exact problems; if it still has problems the user gets it WITH a clear warning.
      const verify = (tag: string, text: string) => P.step(`verify:${tag}`, async () => {
        const scan = scanText(text, ctx, kind.replace("-", " "), false); // not strict: see forbiddenTermProblems
        if (scan.length) return { problems: scan };
        await writeFile(path.join(dir, "check-text.txt"), text, "utf8");
        await agent(run, dir, "checker", "text");
        return { problems: verifyChecker(await readJson(path.join(dir, "checker-text.json")), ctx.text).problems };
      });
      let v = await verify("1", msg);
      if (v.problems.length) {
        await P.step("problems", async () => { await writeFile(problemsFile, JSON.stringify({ source: "code scan and Checker", problems: v.problems }, null, 2), "utf8"); return true; });
        msg = await write("2");
        v = await verify("2", msg);
        await rm(problemsFile, { force: true });
      }
      msg += v.problems.length ? `\n\n⚠️ This still has claims your profile does not back. Edit them before you send it:\n${v.problems.slice(0, 4).map((x) => "• " + oneLine(x, 400)).join("\n")}` : "\n\n✅ Every claim about you checked against your profile.";
    }
    const n = await nextVersion(dir, kind, "md");
    await writeFile(path.join(dir, `${kind}.md`), msg + "\n", "utf8");
    await writeFile(path.join(dir, `${kind}-v${n}.md`), msg + "\n", "utf8"); // every version is kept, newest first
    await P.clear();
    return msg;
  }

  async function skip(job: JobState): Promise<JobState> { return saveState({ ...job, status: "skipped", needs: undefined }, now()); }
  async function listJobs(): Promise<JobState[]> {
    const out: JobState[] = [];
    for (const n of await readdir(d.jobsDir).catch(() => [] as string[])) {
      try { const s = await loadState(path.join(d.jobsDir, n)); out.push({ ...s, dir: path.join(d.jobsDir, n) }); } catch { /* a folder without a status file */ }
    }
    return out.sort((a, b) => b.created.localeCompare(a.created));
  }
  // After a crash, quit or restart: a job that was running becomes "interrupted"; nothing resumes by itself (PRD 10). Its finished steps are kept.
  async function recoverInterrupted(): Promise<JobState[]> {
    const out: JobState[] = [];
    for (const j of await listJobs()) if (j.status === "analysing" || j.status === "building") out.push(await saveState({ ...j, status: "interrupted", resumeAt: j.status === "building" ? "build" : "analyse", note: "interrupted by a restart" }, now()));
    return out;
  }
  const resume = (job: JobState) => (job.resumeAt === "build" ? build(job) : analyse(job));
  return { createJob, analyse, build, extra, skip, listJobs, recoverInterrupted, resume };
}
export type Pipeline = ReturnType<typeof createPipeline>;
