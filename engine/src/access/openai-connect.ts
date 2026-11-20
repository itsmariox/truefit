// "Test connection" and API-key validation for OpenAI: the same promises as connect.ts. ONE tiny call proves the chosen way to connect works; nothing is called at launch; a new key is
// proven BEFORE it is saved; the call goes through the same guards (spend cap, credential-kind check) and is written to the usage ledger. No key or token leaves this module.
import { redact } from "../checks.ts";
import { exitCodeFor } from "../agents/errors.ts";
import type { ModelProvider } from "../agents/provider.ts";
import type { Db } from "../store/db.ts";
import { capGate, recordUsage } from "./ledger.ts";
import { isAccessError, stateFromError, type LastError, type Mode } from "./state.ts";
import type { TestResult } from "./connect.ts";

export const OPENAI_VALIDATION_MODEL = "gpt-6-luna"; // the cheapest model in OpenAI's list; whether a ChatGPT plan can use it is unverified until a real run (docs/OPENAI-BUILD-ISSUES.md)
export type OpenAITestDeps = { provider: ModelProvider; mode: Mode; db?: Db; now?: () => Date; model?: string; timeoutMs?: number };

export async function testOpenAIConnection(d: OpenAITestDeps): Promise<TestResult> {
  const now = () => d.now?.() ?? new Date(), model = d.model ?? OPENAI_VALIDATION_MODEL;
  const pre = d.provider.preflight(d.mode); if (pre.length) return { ok: false, kind: "not_started", why: pre.join("; ") };
  const gate = d.db ? capGate(d.db, now(), d.mode) : null; if (gate) return { ok: false, kind: "cap", why: gate.log };
  const ac = new AbortController(), t0 = Date.now(); let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, d.timeoutMs ?? 30_000);
  let out: Awaited<ReturnType<ModelProvider["run"]>> | null = null, thrown: string | null = null;
  try { out = await d.provider.run({ role: "test", model, system: "Reply with a JSON object whose message is the single word ok.", prompt: "ok?", schema: "coach", web: false, timeoutSeconds: 30 }, { abort: ac, timedOut: () => timedOut }, d.mode); }
  catch (e) { thrown = redact((e as Error)?.message, 200); } finally { clearTimeout(timer); }
  const ms = Date.now() - t0;
  const record = (ok: boolean, code: number | null, usage?: { costUsd: number } | null) => { if (!d.db) return; try { recordUsage(d.db, { at: now().toISOString(), role: "test", model, mode: d.mode, provider: "openai", costUsd: usage?.costUsd ?? 0, ok, errorCode: ok ? null : code, ms }); } catch { /* the ledger must never break the test */ } };
  if (thrown !== null) { record(false, 5, null); return { ok: false, kind: "unreachable", why: thrown }; }
  if (!out || out.type === "timeout") { record(false, 8, null); return { ok: false, kind: "unreachable", why: "no answer in time" }; }
  if (out.type === "breach") { return { ok: false, kind: "mode_mismatch", why: out.problems.join("; ") }; } // nothing was sent: not a call, not in the ledger
  const f = out.failure;
  if (!f && out.answer) { record(true, null, out.usage); return { ok: true, costUsd: out.usage?.costUsd ?? 0, ms }; }
  const error: LastError = { type: f?.type, status: f?.status ?? null, message: f?.text ?? "no answer", apiKeySource: f?.apiKeySource, resetsAt: f?.resetsAt ?? null };
  const code = exitCodeFor(error.type, error.message ?? ""); record(false, code, out.usage);
  if (isAccessError(error)) return { ok: false, kind: "access", error, state: stateFromError(error, d.mode) };
  return { ok: false, kind: code === 5 ? "unreachable" : "other", error, why: error.message };
}

// A key the user pasted: a light shape check, then ONE call to prove it, and only a proven key is saved (and the way to connect set to the API key). A refused or unproven key changes
// nothing: the old key and the old state stay, and no error is remembered for a key that was never saved.
export type OpenAIConnectDeps = Omit<OpenAITestDeps, "mode" | "provider"> & { makeProvider: (apiKey: string) => ModelProvider; access: { saveApiKey(key: string): Promise<void>; chooseMode(m: Mode | null): unknown; recordSuccess(): void } };
export async function connectWithOpenAIKey(key: string, d: OpenAIConnectDeps): Promise<{ ok: true } | { ok: false; kind: "malformed" | Extract<TestResult, { ok: false }>["kind"]; state?: import("./state.ts").AccessState }> {
  const k = typeof key === "string" ? key.trim() : "";
  if (k.length < 20 || k.length > 500 || /\s/.test(k)) return { ok: false, kind: "malformed" };
  const r = await testOpenAIConnection({ ...d, mode: "apiKey", provider: d.makeProvider(k) });
  if (!r.ok) return { ok: false, kind: r.kind, state: r.state };
  await d.access.saveApiKey(k); d.access.chooseMode("apiKey"); d.access.recordSuccess();
  return { ok: true };
}
