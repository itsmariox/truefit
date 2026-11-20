// The words the user reads about Claude access (phase 3f, PRD 09 and 10). ONE catalogue: every state, sign-in result, paused-job reason, test result and key result has a
// plain message: a short title, one or two plain sentences saying what happened and what to do next, the buttons that make sense, and a Details text for the technical part
// (shown behind a "Details" expander and in "Copy diagnostics", never in the title or body). The user never sees a raw error, an error code, a token, a key or an account
// detail. UK English. The wording is the owner's to approve (PRD 09 open item): it is also written out as a readable document by evals/dump-messages.ts.
import { redact } from "../checks.ts";
import type { AccessState, Mode } from "./state.ts";
import type { SignInEvent, SignInResult } from "./signin.ts";
import type { TestResult } from "./connect.ts";

export type ActionId = "choose_subscription" | "choose_api_key" | "read_notice" | "signin" | "reconnect" | "enter_key" | "test" | "resume" | "retry" | "switch_to_key" | "switch_to_subscription"
  | "raise_cap" | "open_account" | "open_settings" | "update_app" | "copy_diagnostics" | "cancel";
// The words on the buttons.
export const ACTION_LABELS: Record<ActionId, string> = {
  choose_subscription: "Use my Claude subscription", choose_api_key: "Use an API key", read_notice: "Read the notice", signin: "Sign in", reconnect: "Reconnect", enter_key: "Enter API key",
  test: "Test connection", resume: "Resume", retry: "Try again", switch_to_key: "Use an API key instead", switch_to_subscription: "Use my subscription instead", raise_cap: "Change the limit",
  open_account: "Open my Claude account", open_settings: "Open Settings", update_app: "Update the app", copy_diagnostics: "Copy diagnostics", cancel: "Cancel",
};
export type Tone = "ok" | "info" | "warn" | "error";
export type Message = { id: string; tone: Tone; title: string; body: string; actions: ActionId[]; details: string };

// ---------- time, in the Mac's own time zone, the way people say it ----------
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function formatWhen(at: Date | string | null | undefined, now: Date): string | null {
  const d = at ? new Date(at) : null; if (!d || Number.isNaN(d.getTime())) return null;
  const h = d.getHours(), m = d.getMinutes(), clock = `${h % 12 === 0 ? 12 : h % 12}${m ? ":" + String(m).padStart(2, "0") : ""} ${h < 12 ? "am" : "pm"}`;
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), days = Math.round((startOf(d) - startOf(now)) / 86400_000);
  if (days === 0) return `today at ${clock}`;
  if (days === 1) return `tomorrow at ${clock}`;
  if (days > 1 && days < 7) return `on ${DAYS[d.getDay()]} at ${clock}`;
  return `on ${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? " " + d.getFullYear() : ""}`;
}
export function formatDate(at: Date | string | null | undefined, now: Date): string | null {
  const d = at ? new Date(at) : null; if (!d || Number.isNaN(d.getTime())) return null;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? " " + d.getFullYear() : ""}`;
}
const money = (n: number) => `$${n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`; // a fraction of a cent keeps its digits, so a tiny test cost is not shown as "$0.00"
const detail = (...parts: (string | number | null | undefined)[]) => redact(parts.filter((p) => p !== null && p !== undefined && p !== "").join("; "), 300);
const plan = (p: string | null) => (p ? `${p.charAt(0).toUpperCase()}${p.slice(1)} plan` : "plan");

const M = (id: string, tone: Tone, title: string, body: string, actions: ActionId[], details: string): Message => ({ id, tone, title, body, actions, details });

// ---------- the state of the connection ----------
export function describeState(s: AccessState, now: Date, extra: { details?: string } = {}): Message {
  const dt = (...p: (string | number | null | undefined)[]) => detail(`state=${s.kind}`, ...p, extra.details);
  switch (s.kind) {
    case "not_chosen": return M("state.not_chosen", "info", "Choose how to connect to Claude", "This app uses Claude to read job ads and to write and check your CV. Use your own Claude subscription, or an API key.", ["choose_subscription", "choose_api_key"], dt());
    case "notice_needed": return M("state.notice_needed", "info", "Please read this first", "Before you use your subscription here, please read the short notice and tick the box to say you understand it.", ["read_notice"], dt());
    case "not_connected": return s.mode === "subscription"
      ? M("state.not_connected.subscription", "warn", "You're not signed in to Claude", "Sign in with your Claude account to get started. Your browser will open so you can approve it.", ["signin", "switch_to_key"], dt("mode=subscription"))
      : M("state.not_connected.key", "warn", "No API key saved yet", "Paste your API key to connect. You can copy it from your Anthropic account.", ["enter_key", "switch_to_subscription"], dt("mode=apiKey"));
    case "connected": { const until = formatDate(s.expiresAt, now); return M("state.connected", "ok", "Connected to Claude", `You're signed in with your ${plan(s.plan)}${until ? `. Your sign-in lasts until ${until}` : ""}.`, ["test"], dt(s.plan, s.expiresAt, s.daysLeft)); }
    case "expiring_soon": return M("state.expiring_soon", "warn", "Your Claude sign-in runs out soon", `It runs out ${formatWhen(s.expiresAt, now) ?? "soon"}. Sign in again before then so your jobs don't stop.`, ["reconnect"], dt(s.plan, s.expiresAt, s.daysLeft));
    case "expired": return M("state.expired", "error", "Claude needs you to sign in again", "Your sign-in has run out or was ended. Nothing is lost: any job is paused, and you can press Resume after you sign in.", ["reconnect", "switch_to_key"], dt());
    case "key_saved": return M("state.key_saved", "info", "Your API key is saved", "It's stored safely on this Mac. Press Test connection to check that it works.", ["test"], dt());
    case "key_invalid": return M("state.key_invalid", "error", "Claude didn't accept your API key", "It may have been changed or removed in your Anthropic account. Paste a new key to carry on.", ["enter_key", "test"], dt());
    case "subscription_refused": return M("state.subscription_refused", "error", "Claude won't let this app use your subscription", "Your account or organisation doesn't allow it. You can use an API key instead, which you pay for as you go.", ["switch_to_key", "open_account"], dt());
    case "account_problem":
      return s.why === "on_hold" ? M("state.account.on_hold", "error", "There's a problem with your Claude account", "Anthropic has put your account on hold. Check your email from Anthropic or your account page, then try again.", ["open_account", "retry"], dt(s.mode))
        : s.why === "billing" ? M("state.account.billing", "error", "There's a billing problem with your Claude account", "Anthropic couldn't take a payment. Fix it in your account, then try again. Your jobs are paused, not lost.", ["open_account", "retry"], dt(s.mode))
        : M("state.account.verification", "error", "Claude needs you to verify your account", "Open your Claude account, finish the check it asks for, then try again.", ["open_account", "retry"], dt(s.mode));
    case "limited": { const when = formatWhen(s.resetsAt, now); return s.mode === "subscription"
      ? M("state.limited.subscription", "warn", "You've reached your Claude usage limit", `${when ? `It resets ${when}. ` : "Try again a little later. "}Your jobs are paused, not lost, and you can press Resume then.`, ["retry"], dt("mode=subscription", s.resetsAt))
      : M("state.limited.key", "warn", "Claude is limiting requests for now", `${when ? `It should ease ${when}. ` : "Wait a few minutes. "}Your jobs are paused, not lost, and you can press Resume then.`, ["retry"], dt("mode=apiKey", s.resetsAt)); }
    case "unknown":
      return s.reason === "not_runnable" ? M("state.unknown.not_runnable", "error", "Claude's program couldn't start", "Quit and reopen the app. If it keeps happening, copy the diagnostics and ask for help.", ["retry", "copy_diagnostics"], dt(s.mode))
        : s.reason === "timeout" ? M("state.unknown.timeout", "warn", "Claude didn't answer in time", "Check your internet connection, then try again.", ["retry"], dt(s.mode))
        : s.reason === "keychain" ? M("state.unknown.keychain", "error", "Couldn't read your saved API key", "Your Mac wouldn't let the app read it. Make sure your Mac is unlocked, then try again.", ["retry"], dt(s.mode))
        : M("state.unknown.other", "warn", "Couldn't check your Claude connection", "Try again. If it keeps happening, copy the diagnostics and ask for help.", ["retry", "copy_diagnostics"], dt(s.mode, s.reason));
  }
}

// ---------- a paused or failed job ----------
export type PauseKind = "auth" | "rate_limit" | "unavailable" | "account" | "timeout" | "cap" | "setup" | "isolation" | "other";
export function describePause(kind: PauseKind, o: { now: Date; mode?: Mode | null; resetsAt?: string | null; capUsd?: number | null; spentUsd?: number | null; details?: string; pausable?: boolean }): Message {
  const d = (...p: (string | number | null | undefined)[]) => detail(`pause=${kind}`, ...p, o.details);
  const safe = o.pausable === false ? "" : "Your job is paused and nothing is lost. ";
  switch (kind) {
    case "auth":
      // An API-key user is never told to "sign in" (found live in step 3h: a refused key paused the job with the subscription wording).
      if (o.mode === "apiKey") return M("pause.auth.key", "error", "Claude didn't accept your API key", `${safe}Paste a working key in Settings, then press Resume.`, ["enter_key", "resume"], d("mode=apiKey"));
      return M("pause.auth", "error", "Claude needs you to sign in again", `${safe}Sign in again, then press Resume.`, ["reconnect", "resume"], d());
    case "rate_limit": { const when = formatWhen(o.resetsAt, o.now); return M("pause.rate_limit", "warn", "You've reached your Claude usage limit", `${safe}${when ? `It resets ${when}; press Resume then.` : "Try again a little later by pressing Resume."}`, ["resume"], d(o.resetsAt)); }
    case "unavailable": return M("pause.unavailable", "warn", "Claude couldn't be reached", `${safe}It may be an outage or your internet connection. Press Resume when it's back.`, ["resume"], d());
    case "account": return M("pause.account", "error", "There's a problem with your Claude account or billing", `${safe}Fix it in your account, then press Resume.`, ["open_account", "resume"], d());
    case "timeout": return M("pause.timeout", "warn", "Claude took too long to answer", `${safe}Press Resume to try again.`, ["resume"], d());
    case "cap": { const amounts = o.capUsd != null && o.spentUsd != null ? ` You've used ${money(o.spentUsd)} of your ${money(o.capUsd)} limit this month.` : ""; return M("pause.cap", "warn", "Your monthly spend limit has been reached", `${safe.trim()}${amounts} Raise the limit in Settings, or wait until next month, then press Resume.`.trim().replace(/\s+/g, " "), ["raise_cap", "resume"], d(o.capUsd, o.spentUsd)); }
    case "setup": return M("pause.setup", "error", "The app couldn't set Claude up properly", "Quit and reopen the app. If it keeps happening, copy the diagnostics and ask for help.", ["copy_diagnostics"], d());
    case "isolation": return M("pause.isolation", "error", "A safety check stopped this job", "Claude's program wasn't set up the way this app requires, so nothing was used. Copy the diagnostics and ask for help.", ["copy_diagnostics"], d());
    case "other": return M("pause.other", "error", "Something went wrong", `${o.pausable === false ? "This job didn't finish. Try again; if it keeps happening, copy the diagnostics and ask for help." : "Your job is paused and nothing is lost. Press Resume to try again."}`, o.pausable === false ? ["retry", "copy_diagnostics"] : ["resume", "copy_diagnostics"], d());
  }
}

// ---------- signing in ----------
export function describeSignInEvent(e: SignInEvent): Message {
  switch (e.type) {
    case "starting": return M("signin.starting", "info", "Opening your browser…", "A Claude page will open so you can sign in and approve.", ["cancel"], "event=starting");
    case "link": return M("signin.link", "info", "Approve in your browser", "If the page didn't open, use the link shown here. Come back to this window when you've approved.", ["cancel"], "event=link");
    case "link_blocked": return M("signin.link_blocked", "warn", "We didn't open that link", "It didn't look like a Claude page, so it was ignored to keep you safe.", ["cancel"], "event=link_blocked");
    case "waiting_for_browser": return M("signin.waiting", "info", "Waiting for you to approve", "Approve in your browser, then come back here. This will update by itself.", ["cancel"], "event=waiting_for_browser");
    case "code_requested": return M("signin.code", "info", "If your browser shows a code", "Copy it and paste it here. If it doesn't, you don't need to do anything.", ["cancel"], "event=code_requested");
    case "confirming": return M("signin.confirming", "info", "Checking your sign-in…", "This takes a moment.", [], "event=confirming");
  }
}
export function describeSignInResult(r: SignInResult): Message {
  if (r.ok) return M("signin.ok", "ok", "You're signed in", "Claude is connected. You can start a job now.", ["test"], "signin=ok");
  switch (r.reason) {
    case "cancelled": return M("signin.cancelled", "info", "Sign-in cancelled", "Nothing was changed. Sign in again whenever you're ready.", ["signin"], "signin=cancelled");
    case "timeout": return M("signin.timeout", "warn", "The sign-in took too long", "It wasn't approved in time. Start again and approve it in your browser.", ["signin"], "signin=timeout");
    case "failed": return M("signin.failed", "error", "The sign-in didn't work", "Claude's sign-in page reported a problem. Try again.", ["signin", "copy_diagnostics"], "signin=failed");
    case "not_confirmed": return M("signin.not_confirmed", "warn", "We couldn't confirm your sign-in", "Your browser said you were done, but Claude doesn't show you as signed in yet. Try again.", ["signin", "copy_diagnostics"], "signin=not_confirmed");
    case "not_runnable": return M("signin.not_runnable", "error", "Claude's program couldn't start", "Quit and reopen the app. If it keeps happening, copy the diagnostics and ask for help.", ["retry", "copy_diagnostics"], "signin=not_runnable");
    case "already_running": return M("signin.already_running", "info", "A sign-in is already open", "Finish it in your browser, or cancel it and start again.", ["cancel"], "signin=already_running");
  }
}

// ---------- "Test connection" and saving a key ----------
export function describeTest(r: TestResult, o: { now: Date; mode: Mode }): Message {
  if (r.ok) return M("test.ok", "ok", "Claude is working", `The test went through${r.costUsd > 0 ? ` and cost about ${money(r.costUsd)}` : ""}. You're ready to start a job.`, [], detail("test=ok", r.costUsd, r.ms));
  switch (r.kind) {
    case "access": return r.state ? describeState(r.state, o.now, { details: r.why }) : M("test.access", "error", "Claude didn't accept the connection", "Check your sign-in or your API key and try again.", ["retry"], detail("test=access", r.why));
    case "unreachable": return M("test.unreachable", "warn", "Couldn't reach Claude", "It may be an outage or your internet connection. Your key or sign-in isn't the problem as far as we can tell. Try again in a minute.", ["retry"], detail("test=unreachable", r.why));
    case "cap": return M("test.cap", "warn", "Test not run: spend limit reached", "You've reached your monthly spend limit for the API key. Raise it in Settings to test again.", ["raise_cap"], detail("test=cap", r.why));
    case "mode_mismatch": return M("test.mode_mismatch", "error", "Claude used a different sign-in than you chose", `This app wanted to use your ${o.mode === "apiKey" ? "API key" : "subscription"}, but Claude used something else, so the result was thrown away. Copy the diagnostics and ask for help.`, ["copy_diagnostics"], detail("test=mode_mismatch", r.why));
    case "not_started": return M("test.not_started", "error", "The test couldn't start", o.mode === "apiKey" ? "No API key was available to test. Paste your key and try again." : "Something is set up the wrong way round. Copy the diagnostics and ask for help.", o.mode === "apiKey" ? ["enter_key"] : ["copy_diagnostics"], detail("test=not_started", r.why));
    case "other": return M("test.other", "warn", "The test didn't work", "Claude answered with a problem we don't recognise. Try again; if it keeps happening, copy the diagnostics and ask for help.", ["retry", "copy_diagnostics"], detail("test=other", r.why));
  }
}
export function describeConnect(r: { ok: true } | { ok: false; kind: string; state?: AccessState }, o: { now: Date }): Message {
  if (r.ok) return M("key.saved", "ok", "Your API key is working and saved", "It's stored safely on this Mac and only used to talk to Claude. You're ready to start a job.", ["test"], "key=saved");
  if (r.kind === "malformed") return M("key.malformed", "warn", "That doesn't look like an API key", "A key is one long piece of text with no spaces. Copy it again from your Anthropic account and paste it here.", ["enter_key"], "key=malformed");
  if (r.kind === "access") return r.state ? describeState(r.state, o.now) : M("key.refused", "error", "Claude didn't accept that key", "Check that you copied all of it, or create a new key, and try again. Nothing was saved.", ["enter_key"], "key=access");
  if (r.kind === "unreachable") return M("key.unreachable", "warn", "Couldn't check your key", "Claude couldn't be reached, so the key wasn't saved. Check your internet connection and try again.", ["enter_key"], "key=unreachable");
  if (r.kind === "cap") return M("key.cap", "warn", "Couldn't check your key", "You've reached your monthly spend limit, so the key wasn't tested or saved. Raise the limit in Settings first.", ["raise_cap"], "key=cap");
  return M("key.other", "warn", "Couldn't check your key", "Something unexpected happened, so the key wasn't saved. Try again; if it keeps happening, copy the diagnostics and ask for help.", ["enter_key", "copy_diagnostics"], `key=${r.kind}`);
}

// ---------- the subscription notice the user must tick (PRD 09) ----------
export const SUBSCRIPTION_NOTICE = {
  title: "Using your Claude subscription",
  intro: "This app can use your own Claude subscription to do its work. Before you connect, please read this.",
  points: [
    { heading: "What the app uses", text: "You sign in with your own Claude account in your browser. The app never sees or stores your password or your sign-in: Claude's own program keeps it on this Mac." },
    { heading: "What could change", text: "Anthropic, the company behind Claude, decides what a subscription may be used for. It may limit or stop this at any time, and the risk to your account is yours." },
    { heading: "If it stops working", text: "Switch to an API key in Settings. You pay for an API key as you go, and you can set a monthly limit." },
  ],
  checkbox: "I understand, and I want to use my subscription.",
} as const;

// ---------- usage lines for Settings ----------
type Month = { apiKey: { usd: number; calls: number }; subscription: { usd: number; calls: number } };
type CapView = { capUsd: number | null; spentUsd: number; remainingUsd: number | null; reached: boolean };
const req = (n: number) => `${n} ${n === 1 ? "request" : "requests"}`;
export function usageLines(u: { thisMonth: Month; byService?: { claude: Month; openai: Month }; cap: CapView }): string[] {
  const out: string[] = [];
  // With only Claude in use the lines read as they always have. Once OpenAI has been used this month each service gets its own lines (the plan line says ChatGPT plan for OpenAI).
  const openaiUsed = !!u.byService && (u.byService.openai.apiKey.calls > 0 || u.byService.openai.subscription.calls > 0);
  if (!openaiUsed) {
    if (u.thisMonth.apiKey.calls > 0 || u.cap.capUsd !== null) out.push(`API key, this month: ${money(u.thisMonth.apiKey.usd)} (${req(u.thisMonth.apiKey.calls)})`);
  } else {
    for (const [name, m, plan] of [["Claude", u.byService!.claude, "Subscription"], ["OpenAI", u.byService!.openai, "ChatGPT plan"]] as const) {
      if (m.apiKey.calls > 0) out.push(`${name} API key, this month: ${money(m.apiKey.usd)} (${req(m.apiKey.calls)})`);
      if (m.subscription.calls > 0) out.push(`${plan}, this month: ${req(m.subscription.calls)} (not billed per request)`);
    }
  }
  if (u.cap.capUsd !== null) out.push(u.cap.reached ? `Monthly limit of ${money(u.cap.capUsd)} reached` : `${money(u.cap.remainingUsd ?? 0)} left of your ${money(u.cap.capUsd)} monthly limit${openaiUsed ? " (across Claude and OpenAI)" : ""}`);
  if (!openaiUsed && u.thisMonth.subscription.calls > 0) out.push(`Subscription, this month: ${req(u.thisMonth.subscription.calls)} (not billed per request)`);
  return out;
}
