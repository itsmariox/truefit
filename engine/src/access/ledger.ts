// The usage ledger and the monthly spend cap (phase 3e, PRD 09). Every Claude call is recorded in the database (cost, tokens, outcome), including failed and timed-out calls,
// so the total survives deleting jobs and importing. It holds no ad, CV or profile text and no secret. The cap applies to the API-key mode only (a subscription call is not
// billed per call); it is checked BEFORE each call and a call that starts under the cap may finish a little over it (one call is the unit).
import type { Db } from "../store/db.ts";
import { getSettings } from "../store/settings-store.ts";
import { EXIT, type ExitCode } from "../agents/errors.ts";
import type { Mode, Provider } from "./state.ts";

export type UsageRecord = { at: string; job?: string | null; role: string; model?: string | null; mode?: Mode | null; provider?: Provider | null; inTokens?: number; outTokens?: number; costUsd?: number; ok: boolean; errorCode?: number | null; ms?: number | null };

const clampInt = (n: unknown) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.min(Math.round(Number(n)), 2_000_000_000) : 0);
export function recordUsage(db: Db, r: UsageRecord): void {
  const cost = Number.isFinite(Number(r.costUsd)) && Number(r.costUsd) > 0 ? Number(r.costUsd) : 0; // never negative, never NaN
  db.run("INSERT INTO usage(at, job, role, model, mode, provider, input_tokens, output_tokens, cost_usd, ok, error_code, ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    r.at, r.job ?? null, r.role, r.model ?? null, r.mode ?? null, r.provider ?? null, clampInt(r.inTokens), clampInt(r.outTokens), cost, r.ok ? 1 : 0, r.errorCode ?? null, r.ms === undefined || r.ms === null ? null : clampInt(r.ms));
}

// The calendar month of the Mac's own time zone (what the user means by "this month").
export function monthRange(now: Date): { from: string; to: string } {
  return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString() };
}
export function spent(db: Db, now: Date, mode: Mode | null = "apiKey", provider: Provider | null = null): { usd: number; calls: number } {
  const { from, to } = monthRange(now);
  const r = db.get<{ usd: number | null; n: number }>(`SELECT SUM(cost_usd) AS usd, COUNT(*) AS n FROM usage WHERE at >= ? AND at < ? ${mode ? "AND mode = ?" : ""} ${provider ? "AND provider = ?" : ""}`, ...[from, to, ...(mode ? [mode] : []), ...(provider ? [provider] : [])])!;
  return { usd: Math.round((Number(r.usd) || 0) * 1e6) / 1e6, calls: Number(r.n) };
}

export type CapStatus = { capUsd: number | null; spentUsd: number; remainingUsd: number | null; reached: boolean };
export function capStatus(db: Db, now: Date): CapStatus {
  const cap = getSettings(db).settings["spend.monthlyCapUsd"], s = spent(db, now, "apiKey").usd;
  return { capUsd: cap, spentUsd: s, remainingUsd: cap === null ? null : Math.max(0, Math.round((cap - s) * 1e6) / 1e6), reached: cap !== null && s >= cap };
}

// Asked before every call. Only the API-key mode can be stopped by the cap. A refusal is a PAUSE (exit code `cap`): the user raises the cap or waits for next month, then Resume.
export function capGate(db: Db, now: Date, mode: Mode | undefined): { code: ExitCode; log: string } | null {
  if (mode !== "apiKey") return null;
  const c = capStatus(db, now);
  return c.reached ? { code: EXIT.cap, log: `call not started: the monthly spend cap of $${c.capUsd!.toFixed(2)} for the API key has been reached ($${c.spentUsd.toFixed(2)} spent this month)` } : null;
}

// For Settings: the running total this month and in all, per way of connecting. The subscription figure is the API-equivalent cost the SDK reports, not a bill.
export function usageSummary(db: Db, now: Date) {
  const all = (mode: Mode) => { const r = db.get<{ usd: number | null; n: number }>("SELECT SUM(cost_usd) AS usd, COUNT(*) AS n FROM usage WHERE mode = ?", mode)!; return { usd: Number(r.usd) || 0, calls: Number(r.n) }; };
  const month = (p: Provider) => ({ apiKey: spent(db, now, "apiKey", p), subscription: spent(db, now, "subscription", p) });
  // The cap is ONE monthly limit on all API-key spend, whichever service made the call; the per-service figures are for the screen only.
  return { thisMonth: { apiKey: spent(db, now, "apiKey"), subscription: spent(db, now, "subscription") }, byService: { claude: month("claude"), openai: month("openai") }, allTime: { apiKey: all("apiKey"), subscription: all("subscription") }, cap: capStatus(db, now) };
}
