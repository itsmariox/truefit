// Shared by the app-core and handlers tests: the REAL engine and core on real files, with fakes only for Claude, the login status, the clock, the timers and the Keychain.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CoreDeps } from "../src/main/core/app-core.ts";
import { MemorySecretStore } from "../../engine/src/store/secrets.ts";
import { profileToPersona, type Profile } from "../../engine/src/profile.ts";
import { DB_FILE } from "../../engine/src/store/open.ts";
export const here = path.dirname(fileURLToPath(import.meta.url)), engine = path.join(here, "..", "..", "engine");
export const priya: Profile = JSON.parse(readFileSync(path.join(engine, "tests", "fixtures", "profile-priya.json"), "utf8")), ctx = profileToPersona(priya, new Date());
export const T0 = new Date(2026, 10, 17, 10, 0, 0).getTime();
export const analysis = (company: string) => ({ company, role: "Marketing Executive", location: "Leeds", work_mode: "hybrid", salary_text: null, salary_min_gbp: null, seniority: "mid", years_required: 2, experience: { years: 8, basis: "d" }, requirements: [{ text: "r", priority: "must", rating: "strong", evidence_quote: ctx.bullets[1].text.slice(0, 60), note: "" }], constraint_checks: [], focus_id: 1, focus_note: "", fit_percent: 70, fit_note: "", verdict: "apply", strengths: [], gaps: [], unverified_needed: [], injection_suspected: false, summary: "" });
const flush = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); };
export class FakeTimers { t = 0; q: { id: number; at: number; fn: () => void }[] = []; n = 0;
  setTimeout(fn: () => void, ms: number) { const id = ++this.n; this.q.push({ id, at: this.t + ms, fn }); return id; }
  clearTimeout(h: unknown) { this.q = this.q.filter((x) => x.id !== h); }
  async advance(ms: number) { const target = this.t + ms; for (;;) { const due = this.q.filter((x) => x.at <= target).sort((a, b) => a.at - b.at)[0]; if (!due) break; this.q = this.q.filter((x) => x !== due); this.t = due.at; due.fn(); await flush(); } this.t = target; await flush(); }
}
export type Script = { next: "ok" | "auth"; company: string; calls: number; gateCalls: number }; // calls = analysis/coach calls; gateCalls = the small "is this a job ad?" checks (kept apart on purpose)
export function rig(root: string, secrets = new MemorySecretStore()) {
  const ft = new FakeTimers(), script: Script = { next: "ok", company: "Acme Retail", calls: 0, gateCalls: 0 }; const clock = () => new Date(T0 + ft.t);
  const removed: string[] = [], order: string[] = [];
  const query = (a: { options: any; prompt?: string }) => { const system = String(a.options.systemPrompt), gate = /# Job ad check/.test(system); if (gate) script.gateCalls++; else script.calls++; const role = gate ? "adcheck" : /# Fit analysis/.test(system) ? "analyst" : "coach", out = script.next, isAd = /\b(role|job|position|vacancy|responsibilit\w*|requirements?|experience|salary|apply|candidate)\b/i.test(String(a.prompt ?? ""));
    return (async function* () {
      yield { type: "system", subtype: "init", tools: ["StructuredOutput"], mcp_servers: [], plugins: [], skills: [], cwd: a.options.cwd, permissionMode: "default", apiKeySource: a.options.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : "none" };
      if (out === "ok") { yield { type: "result", subtype: "success", is_error: false, structured_output: role === "analyst" ? analysis(script.company) : role === "adcheck" ? { is_job_ad: isAd, confidence: "high", kind: isAd ? "job_ad" : "question_or_chat", reason: "pretend" } : { message: "ok" }, total_cost_usd: 0.02, modelUsage: { m: { inputTokens: 100, outputTokens: 20 } }, errors: [] }; return; }
      yield { type: "assistant", error: "authentication_failed" }; yield { type: "result", subtype: "success", is_error: true, api_error_status: null, result: "Not logged in · Please run /login", total_cost_usd: 0, modelUsage: {}, errors: [] };
      throw new Error("Claude Code returned an error result: Not logged in · Please run /login"); // like the real program: failed result first, then it throws
    })(); };
  const status = { loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro", loginExpiresAt: new Date(T0 + 30 * 86400_000).toISOString() };
  const deps = (): CoreDeps => ({ dataDir: path.join(root, "data"), now: clock, secrets, query: query as never, claudeBinary: null, timers: ft, backupEveryMs: 3_600_000, tmpDir: path.join(root, "tmp"),
    statusRunner: async () => ({ code: 0, stdout: JSON.stringify(status), timedOut: false, failedToStart: false }), renderer: {} as never, fonts: {} as never,
    base: { tone: "friendly", config: { models: { analyst: "m", writer: "m", checker: "m", coach: "m" }, agentTimeoutSeconds: 5, researchTimeoutSeconds: 5, maxAdChars: 30000 }, skillsDir: path.join(engine, "skills"), tmpRoot: path.join(root, "tmp"), env: { PATH: "/usr/bin" }, now: clock },
    pipelineConfig: { accent: "oxford", showRightToWork: true, resumeProfile: "snapshot" }, keychainKey: { async remove() { order.push(existsSync(path.join(root, "data", DB_FILE)) ? "keychain-before-files" : "keychain-after-files"); removed.push("item"); return null; } } });
  return { ft, script, deps, removed, order, secrets, clock };
}
