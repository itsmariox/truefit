// The in-process agent runner (phase 1 step 7a): same contract as the old Docker runner (jobDir, role, mode -> { code, log }), so the pipeline does not
// change shape. Everything it needs arrives as a parameter (profile, config, skills folder, tone); it keeps no global state, so jobs stay safe to run in
// parallel later. It reads the job's files, builds the prompt with the pure builders, makes ONE isolated Claude call and writes the answer file.
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { redact } from "../checks.ts";
import { profileToPersona } from "../profile.ts";
import type { Profile, ProfilePersona } from "../profile.ts";
import { EXIT, exitCodeFor } from "./errors.ts";
import type { ExitCode } from "./errors.ts";
import { minimalEnv } from "./options.ts";
import type { Mode } from "../access/state.ts";
import type { UsageRecord } from "../access/ledger.ts";
import type { LastError } from "../access/state.ts";
import type { ClaudeCall } from "./options.ts";
import { createClaudeProvider } from "./claude-provider.ts";
import type { ModelProvider, ProviderOutcome } from "./provider.ts";
import { analystPrompt, checkerPrompt, checkerTextPrompt, coachPrompt, importerPrompt, writerPrompt } from "./prompts.ts";
import type { CoachMode, PromptSpec, Tone } from "./prompts.ts";

// `error` (only on a failed call) tells the access layer what the Claude call said: the error type, the HTTP status, a redacted message, the credential source and, for a limit, the reset time.
export type RunResult = { code: number; log: string; error?: LastError };
export type AgentRunner = (jobDir: string, role: string, mode?: string) => Promise<RunResult>;
export type QueryFn = (args: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<any>;
export type AgentConfig = { models: { analyst: string; writer: string; checker: string; coach: string }; openaiModels?: { analyst: string; writer: string; checker: string; coach: string }; agentTimeoutSeconds: number; researchTimeoutSeconds: number; maxAdChars: number };
export type RunnerDeps = {
  profile: Profile; tone: Tone; config: AgentConfig; skillsDir: string;
  query?: QueryFn;                    // the Claude SDK's `query` in the app; a fake in tests (the real one is imported only where a live call is intended). Not needed when `provider` is given
  provider?: ModelProvider;           // the AI service behind the runner (provider.ts); default: Claude through `query`
  configDir?: string;                 // a separate Claude login folder (tests and live checks); never set in the product
  apiKey?: string; env?: Record<string, string | undefined>; tmpRoot?: string; now?: () => Date;
  ctx?: ProfilePersona;               // computed once per runner if not given
  beforeCall?: () => { code: ExitCode; log: string } | null; // asked before every call (the app shell passes the spend-cap gate): a refusal pauses the job and nothing is started
  onUsage?: (r: UsageRecord) => void; // told after every call that was started, including failed and timed-out ones (the app shell writes the usage ledger)
  mode?: Mode;                        // the chosen way to connect: when given, a session whose credential source does not match is stopped at its first message (PRD 09: never switch silently; the prompt may already have been sent, see PHASE3.md). The app shell always passes it.
  writerMode?: "choose-and-order" | "reword"; // must equal the pipeline's mode: the runner picks the Writer skill and schema, the pipeline validates the answer
};

const read = (dir: string, f: string) => readFile(path.join(dir, f), "utf8");
const readOpt = (dir: string, f: string) => read(dir, f).catch(() => null);
const OUT: Record<string, (mode?: string) => string> = { analyst: () => "analysis.json", writer: () => "selection-raw.json", checker: (m) => (m === "text" ? "checker-text.json" : "checker.json"), coach: (m) => `coach-${m}.json`, importer: () => "import.json" };
const NEEDS_AD: CoachMode[] = ["cover-note", "interview-prep", "recruiter-message", "company-brief"];
const WITH_PROBLEMS: CoachMode[] = ["cover-note", "recruiter-message", "interview-prep"];

const need = <T>(v: T | undefined): T => { if (v === undefined) throw new Error("the runner needs a `query` or a `provider`"); return v; };

export function createSdkRunner(d: RunnerDeps): AgentRunner {
  const ctx = d.ctx ?? profileToPersona(d.profile, d.now?.());
  const provider: ModelProvider = d.provider ?? createClaudeProvider({ query: need(d.query), env: minimalEnv(d.env ?? process.env, { apiKey: d.apiKey, configDir: d.configDir }), tmpRoot: d.tmpRoot });
  // The chosen way to connect: given by the shell, or inferred from the key (a key means API-key mode). Checked BEFORE the program is started (below) and again at its first message.
  const chosenMode: Mode | undefined = d.mode ?? (d.apiKey ? "apiKey" : undefined);
  const validFocus = (f: unknown): number | null => (typeof f === "number" && ctx.archetypes.some((a) => a.id === f) ? f : ctx.archetypes[0]?.id ?? null);

  async function spec(dir: string, role: string, mode?: string): Promise<PromptSpec> {
    const skillsDir = d.skillsDir;
    const ad = async () => (await read(dir, "ad.md"));
    if (role === "importer") return importerPrompt({ skillsDir, cvText: await read(dir, "cv-source.txt") });
    if (role === "analyst") return analystPrompt({ skillsDir, ctx, adText: (await ad()).slice(0, d.config.maxAdChars) });
    if (role === "writer") {
      const analysis = await read(dir, "analysis.json");
      const forced = await readOpt(dir, "writer-focus.json"); // the pipeline writes the focus the selection will be judged against (the Writer may change it on a retry)
      const focus = forced ? validFocus(JSON.parse(forced).focus) : validFocus(JSON.parse(analysis).focus_id);
      return writerPrompt({ skillsDir, ctx, profile: d.profile, adText: (await ad()).slice(0, d.config.maxAdChars), analysisJson: analysis, focus, problemsJson: await readOpt(dir, "writer-problems.json"), now: d.now?.(), mode: d.writerMode });
    }
    if (role === "checker" && mode === "text") return checkerTextPrompt({ skillsDir, ctx, text: await read(dir, "check-text.txt"), hideNames: [d.profile.identity.name] });
    if (role === "checker") {
      const sel = JSON.parse(await read(dir, "selection.json"));
      const orig = new Map(ctx.bullets.map((b) => [b.id, b.text]));
      const rewrites = ((sel.rewrites ?? []) as { id: string; text: string }[]).filter((r) => orig.has(r.id)).map((r) => ({ id: r.id, original: orig.get(r.id)!, reworded: r.text })); // the final selection: only bullets still on the CV
      return checkerPrompt({ skillsDir, ctx, summary: String(sel.summary ?? ""), cvText: await read(dir, "cv-text.txt"), hideNames: [d.profile.identity.name], rewrites });
    }
    if (role === "coach") {
      const m = mode as CoachMode;
      return coachPrompt({ skillsDir, mode: m, ctx, tone: d.tone, teamJson: await read(dir, "team.json"), adText: NEEDS_AD.includes(m) ? (await ad()).slice(0, d.config.maxAdChars) : undefined, problemsJson: WITH_PROBLEMS.includes(m) ? await readOpt(dir, "extra-problems.json") : null });
    }
    throw new Error(`unknown role "${role}"`);
  }

  type Meter = { started: boolean; model: string | null; costUsd: number; inTokens: number; outTokens: number };
  const exec = async (dir: string, role: string, mode: string | undefined, meter: Meter): Promise<RunResult> => {
    const label = `${role}${mode ? ":" + mode : ""}`;
    // PREFLIGHT: the one guard that acts before anything is sent. The first-message check cannot: the program has already sent the prompt by then (phase 3 review).
    const pre = provider.preflight(chosenMode);
    if (pre.length) return { code: EXIT.isolation, log: `call not started: ${pre.join("; ")}` };
    const gate = d.beforeCall?.(); if (gate) return gate; // for example the monthly spend cap: the job pauses, nothing is started
    let timedOut = false;
    const started = Date.now();
    try {
      const s = await spec(dir, role, mode);
      const call: ClaudeCall = { role: label, model: d.config.models[role as keyof RunnerDeps["config"]["models"]] ?? d.config.models.writer, system: s.system, prompt: s.prompt, schema: s.schema, web: s.web, timeoutSeconds: s.research ? d.config.researchTimeoutSeconds : d.config.agentTimeoutSeconds };
      meter.started = true; meter.model = call.model;
      const ac = new AbortController();
      const timer = setTimeout(() => { timedOut = true; ac.abort(); }, call.timeoutSeconds * 1000);
      let out: ProviderOutcome;
      try { out = await provider.run(call, { abort: ac, timedOut: () => timedOut }, chosenMode); } finally { clearTimeout(timer); }
      if (out.type === "breach") return { code: EXIT.isolation, log: `isolation check failed, call stopped: ${out.problems.join("; ")}` };
      if (out.type === "timeout") return { code: EXIT.timeout, log: `${label} took longer than ${call.timeoutSeconds}s and was stopped` };
      if (out.usage) {
        meter.costUsd = out.usage.costUsd; meter.inTokens = out.usage.inTokens; meter.outTokens = out.usage.outTokens;
        await appendFile(path.join(dir, "usage.jsonl"), JSON.stringify({ ts: (d.now?.() ?? new Date()).toISOString(), role: label, model: call.model, in: out.usage.inTokens, out: out.usage.outTokens, usd: out.usage.costUsd, ms: Date.now() - started }) + "\n");
      }
      if (out.failure) {
        const f = out.failure;
        return { code: exitCodeFor(f.type, f.msg), log: redact(f.msg, 2000), error: { type: f.type, status: f.status ?? null, message: f.text, apiKeySource: f.apiKeySource, resetsAt: f.resetsAt } };
      }
      await writeFile(path.join(dir, OUT[role](mode)), JSON.stringify(out.answer, null, 2), "utf8");
      return { code: EXIT.ok, log: "" };
    } catch (e) {
      if (timedOut) return { code: EXIT.timeout, log: `${label} took longer than ${d.config.agentTimeoutSeconds}s and was stopped` };
      const msg = redact((e as Error).message, 600);
      return { code: exitCodeFor(undefined, msg) as ExitCode, log: msg };
    }
  };
  // Every call that was actually started is reported to the ledger, whatever its outcome; a call refused before it started (preflight, spend cap) is not.
  return async (dir, role, mode) => {
    const meter: Meter = { started: false, model: null, costUsd: 0, inTokens: 0, outTokens: 0 }, t0 = Date.now();
    const res = await exec(dir, role, mode, meter);
    if (meter.started && d.onUsage) {
      try { d.onUsage({ at: (d.now?.() ?? new Date()).toISOString(), job: path.basename(dir), role: `${role}${mode ? ":" + mode : ""}`, model: meter.model, mode: chosenMode ?? null, inTokens: meter.inTokens, outTokens: meter.outTokens, costUsd: meter.costUsd, ok: res.code === EXIT.ok, errorCode: res.code === EXIT.ok ? null : res.code, ms: Date.now() - t0 }); } catch { /* the ledger must never break a job */ }
    }
    return res;
  };
}
