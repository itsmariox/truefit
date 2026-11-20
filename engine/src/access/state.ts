// "Can I use Claude right now?" (phase 3c, PRD 09). A pure function from what we know to one state; the screens and the pause logic read the state, never raw errors.
import type { LoginStatus } from "./status.ts";

export type Mode = "subscription" | "apiKey";                    // for OpenAI, "subscription" means the ChatGPT plan
export type Provider = "claude" | "openai";
export const EXPIRING_SOON_DAYS = 3;
export type AccessState =
  | { kind: "not_chosen" }                                                      // the user has not picked a way to connect yet
  | { kind: "notice_needed" }                                                   // subscription chosen, the risk notice not yet accepted (PRD 09)
  | { kind: "not_connected"; mode: Mode }                                       // no login (subscription) or no key
  | { kind: "connected"; mode: "subscription"; plan: string | null; expiresAt: string | null; daysLeft: number | null }
  | { kind: "expiring_soon"; mode: "subscription"; plan: string | null; expiresAt: string; daysLeft: number }
  | { kind: "expired"; mode: "subscription" }                                   // the login ran out or was revoked: "Reconnect"
  | { kind: "key_saved"; mode: "apiKey" }                                       // a key is stored; it is proven only by a validation call
  | { kind: "key_invalid"; mode: "apiKey" }                                     // the key was refused (wrong, revoked)
  | { kind: "subscription_refused"; mode: "subscription" }                      // the account may not use Claude this way (organisation block, policy): switch to a key
  | { kind: "account_problem"; mode: Mode; why: "on_hold" | "billing" | "verification" }
  | { kind: "limited"; mode: Mode; resetsAt: string | null }                    // a usage limit: wait, never switch mode silently
  | { kind: "unknown"; mode: Mode; reason: "not_runnable" | "timeout" | "unreadable" | "keychain" | "other" };

// What the last failed call told us. `type` is the SDK's error type, `message` its text, `apiKeySource` what the session said it used.
export type LastError = { type?: string; status?: number | null; message?: string; apiKeySource?: string; resetsAt?: string | null; recordedAt?: string };

// Only these errors say something about ACCESS (the login, the key, the account, a usage limit). Anything else (an outage, an overloaded service, a wrong model name, an
// unknown failure) is a problem with that one call: it pauses the job, but it must never turn the whole app into "blocked", so it is not remembered as an access state.
const ACCESS_ERRORS = new Set(["authentication_failed", "oauth_org_not_allowed", "account_on_hold", "billing_error", "verification_required", "rate_limit"]);
export const isAccessError = (e: LastError) => ACCESS_ERRORS.has(e.type ?? "") || e.status === 401 || e.status === 429;
export const LIMIT_LAPSE_MS = 15 * 60_000; // a limit with no known reset time is forgotten after this, so the app never stays stuck on "limited"
// A remembered limit lapses at its reset time (or after LIMIT_LAPSE_MS when none is known); the user can then simply try again.
export function lapsed(e: LastError, now: Date): boolean {
  if (!(e.type === "rate_limit" || e.status === 429)) return false;
  const reset = e.resetsAt ? Date.parse(e.resetsAt) : e.recordedAt ? Date.parse(e.recordedAt) + LIMIT_LAPSE_MS : NaN;
  return Number.isFinite(reset) && now.getTime() >= reset;
}

export function stateFromError(e: LastError, mode: Mode): AccessState {
  const type = e.type ?? "", msg = e.message ?? "";
  if (type === "rate_limit" || e.status === 429) return { kind: "limited", mode, resetsAt: e.resetsAt ?? null };
  if (type === "oauth_org_not_allowed") return mode === "subscription" ? { kind: "subscription_refused", mode } : { kind: "unknown", mode, reason: "other" };
  if (type === "account_on_hold") return { kind: "account_problem", mode, why: "on_hold" };
  if (type === "billing_error") return { kind: "account_problem", mode, why: "billing" };
  if (type === "verification_required") return { kind: "account_problem", mode, why: "verification" };
  if (type === "authentication_failed" || e.status === 401) {
    if (mode === "apiKey" || e.apiKeySource === "ANTHROPIC_API_KEY" || /invalid api key/i.test(msg)) return { kind: "key_invalid", mode: "apiKey" };
    return { kind: "expired", mode: "subscription" };
  }
  return { kind: "unknown", mode, reason: "other" };
}

export type Inputs = {
  mode: Mode | null; noticeAccepted: boolean; now: Date;
  status: { ok: true; status: LoginStatus } | { ok: false; reason: "not_runnable" | "timeout" | "unreadable" } | null; // subscription mode
  hasKey: boolean | "unreadable";                                                                                   // API-key mode ("unreadable": the Keychain could not be read)
  lastError?: LastError | null;                                                                                     // the newest failed call, cleared by a later success
};
const DAY = 86400_000;

export function computeAccessState(i: Inputs): AccessState {
  const lastError = i.lastError && !lapsed(i.lastError, i.now) ? i.lastError : null;
  if (!i.mode) return { kind: "not_chosen" };
  if (i.mode === "apiKey") {
    if (i.hasKey === "unreadable") return { kind: "unknown", mode: "apiKey", reason: "keychain" };
    if (!i.hasKey) return { kind: "not_connected", mode: "apiKey" };
    return lastError ? stateFromError(lastError, "apiKey") : { kind: "key_saved", mode: "apiKey" };
  }
  if (!i.noticeAccepted) return { kind: "notice_needed" };
  // The newest failed call is more recent evidence than the free status check, which only reads the stored login and cannot know it was revoked: it wins until a success (or a finished sign-in) clears it.
  if (lastError) return stateFromError(lastError, "subscription");
  if (!i.status) return { kind: "unknown", mode: "subscription", reason: "other" };
  if (!i.status.ok) return { kind: "unknown", mode: "subscription", reason: i.status.reason };
  const st = i.status.status;
  if (!st.loggedIn) return st.expiresAt && Date.parse(st.expiresAt) <= i.now.getTime() ? { kind: "expired", mode: "subscription" } : { kind: "not_connected", mode: "subscription" };
  if (st.method && st.method !== "claude.ai" && st.method !== "chatgpt") return { kind: "unknown", mode: "subscription", reason: "other" }; // logged in some other way (for example a console login): not a subscription
  const ms = st.expiresAt ? Date.parse(st.expiresAt) : NaN;
  if (Number.isFinite(ms)) {
    if (ms <= i.now.getTime()) return { kind: "expired", mode: "subscription" };
    const daysLeft = Math.floor((ms - i.now.getTime()) / DAY);
    if (daysLeft < EXPIRING_SOON_DAYS) return { kind: "expiring_soon", mode: "subscription", plan: st.plan, expiresAt: st.expiresAt!, daysLeft };
    return { kind: "connected", mode: "subscription", plan: st.plan, expiresAt: st.expiresAt, daysLeft };
  }
  return { kind: "connected", mode: "subscription", plan: st.plan, expiresAt: null, daysLeft: null };
}
// Only these states let a job start.
export const usable = (s: AccessState) => s.kind === "connected" || s.kind === "expiring_soon" || s.kind === "key_saved";

// The session's first message says which credential it really used. A call whose source does not match the chosen mode is stopped at that first message (the answer is never read or used; NOTE: the program may already have sent the prompt, see PHASE3.md review: the real guard before sending is a preflight in the runner)
// (PRD 09: never switch silently). Step 3a: subscription is "none", an API key is "ANTHROPIC_API_KEY".
export function modeProblems(apiKeySource: string | undefined, mode: Mode | undefined): string[] {
  if (!mode) return [];
  const want = mode === "subscription" ? "none" : "ANTHROPIC_API_KEY";
  return apiKeySource === want ? [] : [`this call would use "${apiKeySource ?? "an unknown credential"}" but the chosen way to connect needs "${want}"`];
}

// States in which the user may press "Test connection" or Resume: they come from a remembered error that may be stale (a login fixed outside the app, a replaced key, a
// limit that has reset). Without this a blocked state could never clear itself, because a blocked state lets no call start.
export const retryable = (s: AccessState) => ["limited", "expired", "key_invalid", "subscription_refused", "account_problem", "unknown"].includes(s.kind);

// The guard that acts BEFORE the program is started (the first-message check cannot: the prompt has usually been sent by then). The chosen mode and the environment the
// program would get must agree: a key needs a key in the environment, the subscription needs none (or the key would silently win).
export function preflightProblems(mode: Mode | undefined, env: Record<string, string | undefined>): string[] {
  if (!mode) return [];
  const hasKey = !!env.ANTHROPIC_API_KEY;
  if (mode === "apiKey" && !hasKey) return ["the chosen way to connect is an API key but no key was given"];
  if (mode === "subscription" && hasKey) return ["the chosen way to connect is the subscription but an API key was given"];
  return [];
}
