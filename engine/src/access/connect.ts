// "Test connection" and API-key validation (phase 3e, PRD 09). ONE tiny call proves that the chosen way to connect works; nothing is called at launch. A new API key is proven
// BEFORE it is saved: a refused key is never stored. The call goes through the same guards as every other call (preflight, spend cap, isolation and mode check at the first
// message) and is written to the usage ledger like any other call. No key, token or account detail leaves this module.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { QueryFn } from "../agents/runner.ts";
import { isolatedOptions, isolationProblems, minimalEnv, type InitMessage } from "../agents/options.ts";
import { exitCodeFor } from "../agents/errors.ts";
import { redact } from "../checks.ts";
import type { Db } from "../store/db.ts";
import { capGate, recordUsage } from "./ledger.ts";
import { isAccessError, modeProblems, preflightProblems, stateFromError, type AccessState, type LastError, type Mode } from "./state.ts";

export const VALIDATION_MODEL = "claude-haiku-5-5"; // the cheapest model; its name is confirmed by a live call in step 3h
export type TestResult =
  | { ok: true; costUsd: number; ms: number }
  | { ok: false; kind: "not_started" | "cap" | "mode_mismatch" | "access" | "unreachable" | "other"; state?: AccessState; error?: LastError; why?: string };

export type TestDeps = {
  query: QueryFn; mode: Mode; apiKey?: string; env?: Record<string, string | undefined>; configDir?: string;
  db?: Db; now?: () => Date; model?: string; timeoutMs?: number; tmpRoot?: string;
};

export async function testConnection(d: TestDeps): Promise<TestResult> {
  const now = () => d.now?.() ?? new Date(), env = minimalEnv(d.env ?? process.env, { apiKey: d.apiKey, configDir: d.configDir });
  const pre = preflightProblems(d.mode, env);
  if (pre.length) return { ok: false, kind: "not_started", why: pre.join("; ") };
  const gate = d.db ? capGate(d.db, now(), d.mode) : null;
  if (gate) return { ok: false, kind: "cap", why: gate.log };
  const cwd = await mkdtemp(path.join(d.tmpRoot ?? os.tmpdir(), "cvapp-test-")), ac = new AbortController(), t0 = Date.now();
  let timedOut = false, init: InitMessage & { apiKeySource?: string } | null = null, result: any = null, assistantError: string | undefined, breach: string[] = [];
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, d.timeoutMs ?? 30_000);
  const model = d.model ?? VALIDATION_MODEL;
  try {
    const call = { role: "test", model, system: "Reply with the single word ok.", prompt: "ok?", schema: "coach" as const, web: false, timeoutSeconds: 30 };
    for await (const m of d.query({ prompt: call.prompt, options: isolatedOptions(call, cwd, env, ac) as never })) {
      if (m.type === "system" && m.subtype === "init") {
        init = m; breach = [...isolationProblems(m, [], cwd, (p) => p.replace(/^\/private(?=\/var\/)/, "")), ...modeProblems(m.apiKeySource, d.mode)];
        if (breach.length) { ac.abort(); break; }
      }
      if (m.type === "assistant" && m.error) assistantError = String(m.error);
      if (m.type === "result") result = m;
    }
  } catch (e) { if (!timedOut) result = result ?? { is_error: true, result: (e as Error).message }; }
  finally { clearTimeout(timer); await rm(cwd, { recursive: true, force: true }); }
  const ms = Date.now() - t0, cost = Number(result?.total_cost_usd) || 0, ok = !breach.length && !!result && !result.is_error;
  if (d.db) { try { recordUsage(d.db, { at: now().toISOString(), role: "test", model, mode: d.mode, provider: "claude", costUsd: cost, ok, errorCode: ok ? null : exitCodeFor(assistantError, String(result?.result ?? "")), ms }); } catch { /* the ledger must never break the test */ } }
  if (breach.length) return { ok: false, kind: "mode_mismatch", why: breach.join("; ") };
  if (timedOut && !result) return { ok: false, kind: "unreachable", why: "no answer in time" };
  if (ok) return { ok: true, costUsd: cost, ms };
  const text = redact(String(result?.result ?? result?.errors ?? ""), 200);
  const error: LastError = { type: assistantError, status: result?.api_error_status ?? null, message: text, apiKeySource: init?.apiKeySource };
  if (isAccessError(error)) return { ok: false, kind: "access", error, state: stateFromError(error, d.mode) };
  const code = exitCodeFor(assistantError, text);
  return { ok: false, kind: code === 5 ? "unreachable" : "other", error, why: text };
}

// A key the user typed or pasted: light shape check, then ONE call to prove it, and only a proven key is saved (and the mode set to the API key). A refused or unproven key
// changes nothing: the old key and the old state stay, and no error is remembered for a key that was never saved.
export type ConnectDeps = Omit<TestDeps, "mode" | "apiKey"> & { access: { saveApiKey(key: string): Promise<void>; chooseMode(m: Mode | null): unknown; recordSuccess(): void } };
export async function connectWithKey(key: string, d: ConnectDeps): Promise<{ ok: true } | { ok: false; kind: "malformed" | Extract<TestResult, { ok: false }>["kind"]; state?: AccessState }> {
  const k = typeof key === "string" ? key.trim() : "";
  if (k.length < 20 || k.length > 500 || /\s/.test(k)) return { ok: false, kind: "malformed" };
  const r = await testConnection({ ...d, mode: "apiKey", apiKey: k });
  if (!r.ok) return { ok: false, kind: r.kind, state: r.state };
  await d.access.saveApiKey(k); d.access.chooseMode("apiKey"); d.access.recordSuccess();
  return { ok: true };
}
