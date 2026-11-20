// Watching for recovery after a job paused (phase 3g, PRD 09 and 10). The watcher only TELLS the user ("you can resume"); it never resumes a job itself and has no way to: it holds
// no reference to the pipeline. What it can honestly know depends on why the job paused:
//   auth         the free status check: a real change from "not signed in" to "signed in" (or a new end date) proves a new login; a replaced key or a finished sign-in clears the
//                remembered error by itself. A login revoked elsewhere that the free check still shows as signed in can only be cleared by Test connection (the check cannot know).
//   rate_limit   waits until the reset time (or 15 minutes when unknown), then says so; no polling.
//   cap          the spend cap being raised, or a new month; checked on a slow poll and on recheck().
//   unavailable, timeout   nothing can detect an outage ending without a network call, so after a short wait it says "you can try again" (can_try), not "recovered".
//   account      nothing can be detected: it waits for the user to try again.
import type { Db } from "../store/db.ts";
import { capStatus } from "./ledger.ts";
import type { StatusResult } from "./status.ts";
import { LIMIT_LAPSE_MS, usable, type AccessState, type LastError } from "./state.ts";

export type WatchKind = "auth" | "rate_limit" | "cap" | "unavailable" | "timeout" | "account";
export type WatchEvent = { type: "waiting"; nextCheckAt: string | null } | { type: "recovered" } | { type: "can_try" };
export type Timers = { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void };
export type WatchDeps = {
  access: { state(): Promise<AccessState>; lastError(): LastError | null; signedIn(): void; mode(): "subscription" | "apiKey" | null };
  db: Db; checkStatus: () => Promise<StatusResult>; now?: () => Date; timers?: Timers;
  fastMs?: number; slowMs?: number; outageMs?: number;   // 3 s while the sign-in screen is open, 60 s otherwise, 60 s before "try again" after an outage
};
export type WatchHandle = { stop(): void; recheck(): Promise<void>; setScreenOpen(open: boolean): void };

// A reset time from whatever a rate-limit message carries: an ISO string, epoch seconds or epoch milliseconds, under one of a few likely field names. Anything else is null.
export function parseResetsAt(info: unknown): string | null {
  if (!info || typeof info !== "object") return null;
  const o = info as Record<string, unknown>;
  for (const k of ["resetsAt", "resets_at", "resetAt", "reset_at", "resetsAtMs", "reset"]) {
    const v = o[k]; let ms = NaN;
    if (typeof v === "number" && Number.isFinite(v)) ms = v > 1e12 ? v : v > 1e9 ? v * 1000 : NaN;
    else if (typeof v === "string" && v) ms = /^\d+$/.test(v) ? (Number(v) > 1e12 ? Number(v) : Number(v) * 1000) : Date.parse(v);
    if (Number.isFinite(ms) && ms > Date.UTC(2020, 0, 1) && ms < Date.UTC(2100, 0, 1)) return new Date(ms).toISOString();
  }
  return null;
}

export function createRecoveryWatcher(d: WatchDeps) {
  const now = () => d.now?.() ?? new Date(), timers: Timers = d.timers ?? { setTimeout: (f, ms) => { const t = setTimeout(f, ms); (t as { unref?: () => void }).unref?.(); return t; }, clearTimeout: (h) => clearTimeout(h as never) };
  const fast = d.fastMs ?? 3000, slow = d.slowMs ?? 60_000, outage = d.outageMs ?? 60_000;
  return {
    async watch(kind: WatchKind, onEvent: (e: WatchEvent) => void, opts: { screenOpen?: boolean } = {}): Promise<WatchHandle> {
      let stopped = false, handle: unknown = null, screenOpen = !!opts.screenOpen, busy = false;
      const emit = (e: WatchEvent) => { try { onEvent(e); } catch { /* a screen's handler must never break the watcher */ } };
      const stop = () => { stopped = true; if (handle !== null) timers.clearTimeout(handle); handle = null; };
      const schedule = (ms: number, fn: () => Promise<void>) => { if (stopped) return; if (handle !== null) timers.clearTimeout(handle); emit({ type: "waiting", nextCheckAt: new Date(now().getTime() + ms).toISOString() }); handle = timers.setTimeout(() => { handle = null; void fn(); }, ms); };
      const done = (e: WatchEvent) => { stop(); emit(e); };
      const baseline = kind === "auth" && d.access.mode() === "subscription" ? await d.checkStatus().catch(() => null) : null;
      const base = baseline && baseline.ok ? baseline.status : null;

      const check = async (): Promise<void> => {
        if (stopped || busy) return; busy = true;
        try {
          if (kind === "auth") {
            if (!d.access.lastError()) { const s = await d.access.state(); if (usable(s)) return done({ type: "recovered" }); }          // a sign-in or a new key cleared the error
            if (d.access.mode() === "subscription") {
              const s = await d.checkStatus().catch(() => null);
              if (s && s.ok && s.status.loggedIn && base && (!base.loggedIn || (s.status.expiresAt && base.expiresAt && s.status.expiresAt > base.expiresAt) || (!base.expiresAt && s.status.expiresAt))) { d.access.signedIn(); return done({ type: "recovered" }); } // a real change: a new login
            }
            return schedule(screenOpen ? fast : slow, check);
          }
          if (kind === "rate_limit") {
            const e = d.access.lastError(), at = e?.resetsAt ? Date.parse(e.resetsAt) : e?.recordedAt ? Date.parse(e.recordedAt) + LIMIT_LAPSE_MS : now().getTime() + LIMIT_LAPSE_MS;
            if (now().getTime() >= at) { const s = await d.access.state(); return done({ type: usable(s) ? "recovered" : "can_try" }); }
            return schedule(at - now().getTime() + 2000, check);
          }
          if (kind === "cap") {
            if (!capStatus(d.db, now()).reached) return done({ type: "recovered" });
            const n = now(), next = new Date(n.getFullYear(), n.getMonth() + 1, 1).getTime();
            return schedule(Math.min(slow, Math.max(1000, next - n.getTime())), check);
          }
          if (kind === "unavailable" || kind === "timeout") return done({ type: "can_try" });
          emit({ type: "waiting", nextCheckAt: null }); // account: nothing can be detected; the user fixes it and tries again
        } finally { busy = false; }
      };

      // first look: auth and cap may already be fine; limits and outages wait first
      if (kind === "auth" || kind === "cap") await check();
      else if (kind === "rate_limit") await check();
      else if (kind === "unavailable" || kind === "timeout") schedule(outage, async () => done({ type: "can_try" }));
      else emit({ type: "waiting", nextCheckAt: null });
      return { stop, recheck: async () => { if (!stopped) await check(); }, setScreenOpen: (o: boolean) => { screenOpen = o; } };
    },
  };
}
