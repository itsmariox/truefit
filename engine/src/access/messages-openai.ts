// The words the user reads about OpenAI access (the ChatGPT plan or an OpenAI API key). The same shape and rules as messages.ts, which stays the approved Claude catalogue: a short
// title, one or two plain sentences, the buttons that make sense, and a Details text for the technical part. The user never sees a raw error, an error code, a token, a key or an
// account detail. UK English. DRAFT wording: like the Claude catalogue it is the owner's to approve (see docs/OPENAI-BUILD-ISSUES.md).
import { redact } from "../checks.ts";
import { ACTION_LABELS, formatWhen, type ActionId, type Message, type PauseKind, type Tone } from "./messages.ts";
import type { AccessState, Mode } from "./state.ts";
import type { TestResult } from "./connect.ts";
import type { OpenAISignInEvent, OpenAISignInResult } from "./openai-signin.ts";

// The words on the buttons, where they differ from the Claude ones.
export const OPENAI_ACTION_LABELS: Record<ActionId, string> = { ...ACTION_LABELS,
  choose_subscription: "Use my ChatGPT plan", choose_api_key: "Use an OpenAI API key", signin: "Continue with ChatGPT", reconnect: "Connect ChatGPT again", switch_to_subscription: "Use my ChatGPT plan instead",
  open_account: "Open ChatGPT usage settings", switch_to_key: "Use an API key instead" };

export const OPENAI_PLAN_NOTICE = {
  title: "Using your ChatGPT plan",
  intro: "This app can use your own ChatGPT plan to do its work. Before you connect, please read this.",
  points: [
    { heading: "What the app uses", text: "You sign in with your own ChatGPT account in your browser and allow this app to use your plan. The app never sees or stores your password. It keeps a sign-in token, encrypted, on this Mac. It cannot read your ChatGPT conversations." },
    { heading: "What it costs you", text: "Requests from this app use the same allowance as the rest of your ChatGPT usage, so they count towards your plan's limits. You can see and change what this app may use in ChatGPT settings, under Usage." },
    { heading: "What could change", text: "OpenAI decides what a plan may be used for, and this way of connecting is still in preview. It may limit or stop it at any time, and the risk to your account is yours." },
    { heading: "If it stops working", text: "Switch to an OpenAI API key in Settings. You pay for an API key as you go, and you can set a monthly limit." },
  ],
  checkbox: "I understand, and I want to use my ChatGPT plan.",
} as const;

const money = (n: number) => `$${n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;
const detail = (...parts: (string | number | null | undefined)[]) => redact(parts.filter((p) => p !== null && p !== undefined && p !== "").join("; "), 300);
const M = (id: string, tone: Tone, title: string, body: string, actions: ActionId[], details: string): Message => ({ id, tone, title, body, actions, details });

export function describeOpenAIState(s: AccessState, now: Date, extra: { details?: string } = {}): Message {
  const dt = (...p: (string | number | null | undefined)[]) => detail(`state=${s.kind}`, ...p, extra.details);
  switch (s.kind) {
    case "not_chosen": return M("oai.state.not_chosen", "info", "Choose how to connect to OpenAI", "This app uses an OpenAI model to read job ads and to write and check your CV. Use your own ChatGPT plan, or an OpenAI API key.", ["choose_subscription", "choose_api_key"], dt());
    case "notice_needed": return M("oai.state.notice_needed", "info", "Please read this first", "Before you use your ChatGPT plan here, please read the short notice and tick the box to say you understand it.", ["read_notice"], dt());
    case "not_connected": return s.mode === "subscription"
      ? M("oai.state.not_connected.subscription", "warn", "ChatGPT isn't connected", "Connect your ChatGPT account to get started. Your browser will open so you can approve it and allow this app to use your plan.", ["signin", "switch_to_key"], dt("mode=subscription"))
      : M("oai.state.not_connected.key", "warn", "No API key saved yet", "Paste your OpenAI API key to connect. You can create one in your OpenAI account.", ["enter_key", "switch_to_subscription"], dt("mode=apiKey"));
    case "connected": case "expiring_soon": return M("oai.state.connected", "ok", "Connected to ChatGPT", "Your ChatGPT plan is connected. Requests from this app count towards your plan's usage.", ["test", "open_account"], dt());
    case "expired": return M("oai.state.expired", "error", "ChatGPT needs you to connect again", "Your ChatGPT connection has ended, or it was removed in your ChatGPT settings. Nothing is lost: any job is paused, and you can press Resume after you connect again.", ["reconnect", "switch_to_key"], dt());
    case "key_saved": return M("oai.state.key_saved", "info", "Your API key is saved", "It's stored safely on this Mac. Press Test connection to check that it works.", ["test"], dt());
    case "key_invalid": return M("oai.state.key_invalid", "error", "OpenAI didn't accept your API key", "It may have been changed or removed in your OpenAI account. Paste a new key to carry on.", ["enter_key", "test"], dt());
    case "subscription_refused": return M("oai.state.subscription_refused", "error", "ChatGPT won't let this app use your plan", "Your account, workspace or region doesn't allow it. You can use an OpenAI API key instead, which you pay for as you go.", ["switch_to_key", "open_account"], dt());
    case "account_problem": return M("oai.state.account", "error", "There's a problem with your OpenAI account", s.why === "billing" ? "OpenAI couldn't take a payment or your credit has run out. Fix it in your account, then try again. Your jobs are paused, not lost." : "Check your account with OpenAI, then try again. Your jobs are paused, not lost.", ["open_account", "retry"], dt(s.mode, s.why));
    case "limited": return s.mode === "subscription"
      ? M("oai.state.limited.subscription", "warn", "You've reached your ChatGPT usage limit", "Either your plan's limit or the limit set for this app has been reached. Check Usage in your ChatGPT settings, then press Resume later. Your jobs are paused, not lost.", ["open_account", "retry"], dt("mode=subscription"))
      : M("oai.state.limited.key", "warn", "OpenAI is limiting requests for now", `${formatWhen(s.resetsAt, now) ? `It should ease ${formatWhen(s.resetsAt, now)}. ` : "Wait a few minutes. "}Your jobs are paused, not lost, and you can press Resume then.`, ["retry"], dt("mode=apiKey", s.resetsAt));
    case "unknown":
      return s.reason === "timeout" ? M("oai.state.unknown.timeout", "warn", "OpenAI didn't answer in time", "Check your internet connection, then try again.", ["retry"], dt(s.mode))
        : s.reason === "keychain" ? M("oai.state.unknown.keychain", "error", "Couldn't read your saved key", "Your Mac wouldn't let the app read it. Make sure your Mac is unlocked, then try again.", ["retry"], dt(s.mode))
        : s.reason === "unreadable" ? M("oai.state.unknown.unreadable", "error", "Couldn't read your saved ChatGPT connection", "Your Mac wouldn't let the app read it. Make sure your Mac is unlocked, then try again, or connect ChatGPT again.", ["retry", "reconnect"], dt(s.mode))
        : M("oai.state.unknown.other", "warn", "Couldn't check your OpenAI connection", "Try again. If it keeps happening, copy the diagnostics and ask for help.", ["retry", "copy_diagnostics"], dt(s.mode, s.reason));
  }
}

export function describeOpenAIPause(kind: PauseKind, o: { now: Date; mode?: Mode | null; resetsAt?: string | null; capUsd?: number | null; spentUsd?: number | null; details?: string; pausable?: boolean }): Message {
  const d = (...p: (string | number | null | undefined)[]) => detail(`pause=${kind}`, ...p, o.details);
  const safe = o.pausable === false ? "" : "Your job is paused and nothing is lost. ";
  switch (kind) {
    case "auth":
      if (o.mode === "apiKey") return M("oai.pause.auth.key", "error", "OpenAI didn't accept your API key", `${safe}Paste a working key in Settings, then press Resume.`, ["enter_key", "resume"], d("mode=apiKey"));
      return M("oai.pause.auth", "error", "ChatGPT needs you to connect again", `${safe}Connect ChatGPT again, then press Resume.`, ["reconnect", "resume"], d());
    case "rate_limit": return o.mode === "apiKey"
      ? M("oai.pause.rate_limit.key", "warn", "OpenAI is limiting requests", `${safe}${formatWhen(o.resetsAt, o.now) ? `It should ease ${formatWhen(o.resetsAt, o.now)}; press Resume then.` : "Press Resume in a few minutes."}`, ["resume"], d(o.resetsAt))
      : M("oai.pause.rate_limit", "warn", "You've reached your ChatGPT usage limit", `${safe}Check Usage in your ChatGPT settings, then press Resume later.`, ["open_account", "resume"], d());
    case "unavailable": return M("oai.pause.unavailable", "warn", "OpenAI couldn't be reached", `${safe}It may be an outage or your internet connection. Press Resume when it's back.`, ["resume"], d());
    case "account": return M("oai.pause.account", "error", "There's a problem with your OpenAI account or billing", `${safe}Fix it in your account, then press Resume.`, ["open_account", "resume"], d());
    case "timeout": return M("oai.pause.timeout", "warn", "OpenAI took too long to answer", `${safe}Press Resume to try again.`, ["resume"], d());
    case "cap": { const amounts = o.capUsd != null && o.spentUsd != null ? ` You've used ${money(o.spentUsd)} of your ${money(o.capUsd)} limit this month.` : ""; return M("oai.pause.cap", "warn", "Your monthly spend limit has been reached", `${safe.trim()}${amounts} Raise the limit in Settings, or wait until next month, then press Resume.`.trim().replace(/\s+/g, " "), ["raise_cap", "resume"], d(o.capUsd, o.spentUsd)); }
    case "setup": return M("oai.pause.setup", "error", "The app couldn't set OpenAI up properly", "Check the model names in the app's settings file, or copy the diagnostics and ask for help.", ["copy_diagnostics"], d());
    case "isolation": return M("oai.pause.isolation", "error", "A safety check stopped this job", "The connection wasn't the kind you chose, so nothing was sent. Copy the diagnostics and ask for help.", ["copy_diagnostics"], d());
    case "other": return M("oai.pause.other", "error", "Something went wrong", `${o.pausable === false ? "This job didn't finish. Try again; if it keeps happening, copy the diagnostics and ask for help." : "Your job is paused and nothing is lost. Press Resume to try again."}`, o.pausable === false ? ["retry", "copy_diagnostics"] : ["resume", "copy_diagnostics"], d());
  }
}

export function describeOpenAISignInEvent(e: OpenAISignInEvent): Message {
  switch (e.type) {
    case "starting": return M("oai.signin.starting", "info", "Opening your browser…", "A ChatGPT page will open so you can sign in and approve.", ["cancel"], "event=starting");
    case "link": return M("oai.signin.link", "info", "Approve in your browser", "If the page didn't open, use the link shown here. Come back to this window when you've approved.", ["cancel"], "event=link");
    case "waiting_for_browser": return M("oai.signin.waiting", "info", "Waiting for you to approve", "Approve in your browser and allow this app to use your ChatGPT plan, then come back here. This will update by itself.", ["cancel"], "event=waiting_for_browser");
    case "confirming": return M("oai.signin.confirming", "info", "Checking your sign-in…", "This takes a moment.", [], "event=confirming");
  }
}
export function describeOpenAISignInResult(r: OpenAISignInResult): Message {
  if (r.ok) return M("oai.signin.ok", "ok", "ChatGPT is connected", "You're using your ChatGPT plan. You can start a job now, and you can manage what this app may use in your ChatGPT settings, under Usage.", ["test"], "signin=ok");
  switch (r.reason) {
    case "cancelled": return M("oai.signin.cancelled", "info", "Connecting was cancelled", "Nothing was changed. Connect again whenever you're ready.", ["signin"], "signin=cancelled");
    case "denied": return M("oai.signin.denied", "info", "You didn't allow it", "Nothing was changed. Connect again if you change your mind, or use an OpenAI API key instead.", ["signin", "switch_to_key"], "signin=denied");
    case "timeout": return M("oai.signin.timeout", "warn", "It took too long", "It wasn't approved in time. Start again and approve it in your browser.", ["signin"], "signin=timeout");
    case "plan_not_enabled": return M("oai.signin.plan_not_enabled", "warn", "Your ChatGPT plan can't be used yet", "You signed in, but this app wasn't allowed to use your ChatGPT plan, or your workspace doesn't allow it. Connect again and allow it, or use an OpenAI API key instead.", ["signin", "switch_to_key"], "signin=plan_not_enabled");
    case "invalid_identity": return M("oai.signin.invalid_identity", "error", "That didn't match the connected account", "Truefit was connected to a different ChatGPT account on this Mac. To use another one, choose \"Use a different ChatGPT account\" first. If you didn't expect this, copy the diagnostics and ask for help.", ["copy_diagnostics"], "signin=invalid_identity");
    case "registration_incomplete": case "failed": return M("oai.signin.failed", "error", "The connection didn't work", "ChatGPT's sign-in page reported a problem. Try again; if it keeps happening, copy the diagnostics and ask for help.", ["signin", "copy_diagnostics"], `signin=${r.reason}`);
    case "not_runnable": return M("oai.signin.not_runnable", "error", "The sign-in couldn't start", "Check your internet connection and try again. If it keeps happening, copy the diagnostics and ask for help.", ["retry", "copy_diagnostics"], "signin=not_runnable");
    case "already_running": return M("oai.signin.already_running", "info", "A sign-in is already open", "Finish it in your browser, or cancel it and start again.", ["cancel"], "signin=already_running");
  }
}

export function describeOpenAITest(r: TestResult, o: { now: Date; mode: Mode }): Message {
  if (r.ok) return M("oai.test.ok", "ok", "OpenAI is working", `The test went through${r.costUsd > 0 ? ` (about ${money(r.costUsd)} of usage)` : ""}. You're ready to start a job.`, [], detail("test=ok", r.costUsd, r.ms));
  switch (r.kind) {
    case "access": return r.state ? describeOpenAIState(r.state, o.now, { details: r.why }) : M("oai.test.access", "error", "OpenAI didn't accept the connection", "Check your ChatGPT connection or your API key and try again.", ["retry"], detail("test=access", r.why));
    case "unreachable": return M("oai.test.unreachable", "warn", "Couldn't reach OpenAI", "It may be an outage or your internet connection. Try again in a minute.", ["retry"], detail("test=unreachable", r.why));
    case "cap": return M("oai.test.cap", "warn", "Test not run: spend limit reached", "You've reached your monthly spend limit for API keys. Raise it in Settings to test again.", ["raise_cap"], detail("test=cap", r.why));
    case "mode_mismatch": return M("oai.test.mode_mismatch", "error", "A different connection than you chose was about to be used", "Nothing was sent. Copy the diagnostics and ask for help.", ["copy_diagnostics"], detail("test=mode_mismatch", r.why));
    case "not_started": return M("oai.test.not_started", "error", "The test couldn't start", o.mode === "apiKey" ? "No API key was available to test. Paste your key and try again." : "ChatGPT isn't connected on this Mac. Connect it first.", o.mode === "apiKey" ? ["enter_key"] : ["signin"], detail("test=not_started", r.why));
    case "other": return M("oai.test.other", "warn", "The test didn't work", "OpenAI answered with a problem we don't recognise. Try again; if it keeps happening, copy the diagnostics and ask for help.", ["retry", "copy_diagnostics"], detail("test=other", r.why));
  }
}
export function describeOpenAIConnect(r: { ok: true } | { ok: false; kind: string; state?: AccessState }, o: { now: Date }): Message {
  if (r.ok) return M("oai.key.saved", "ok", "Your API key is working and saved", "It's stored safely on this Mac and only used to talk to OpenAI. You're ready to start a job.", ["test"], "key=saved");
  if (r.kind === "malformed") return M("oai.key.malformed", "warn", "That doesn't look like an API key", "A key is one long piece of text with no spaces. Copy it again from your OpenAI account and paste it here.", ["enter_key"], "key=malformed");
  if (r.kind === "access") return r.state ? describeOpenAIState(r.state, o.now) : M("oai.key.refused", "error", "OpenAI didn't accept that key", "Check that you copied all of it, or create a new key, and try again. Nothing was saved.", ["enter_key"], "key=access");
  if (r.kind === "unreachable") return M("oai.key.unreachable", "warn", "Couldn't check your key", "OpenAI couldn't be reached, so the key wasn't saved. Check your internet connection and try again.", ["enter_key"], "key=unreachable");
  if (r.kind === "cap") return M("oai.key.cap", "warn", "Couldn't check your key", "You've reached your monthly spend limit, so the key wasn't tested or saved. Raise the limit in Settings first.", ["raise_cap"], "key=cap");
  return M("oai.key.other", "warn", "Couldn't check your key", "Something unexpected happened, so the key wasn't saved. Try again; if it keeps happening, copy the diagnostics and ask for help.", ["enter_key", "copy_diagnostics"], `key=${r.kind}`);
}
