// Writes every message of the access catalogue as a readable document for the owner to approve (PRD 09 open item). Generated from the code, so it cannot drift:
//   node evals/dump-messages.ts > ../prd/09-messages.md
const M = await import("../src/access/messages.ts");
type S = import("../src/access/state.ts").AccessState;
const NOW = new Date(2026, 10, 17, 10, 0, 0), at = (d: number, h: number, m = 0) => new Date(2026, 10, 17 + d, h, m, 0).toISOString();
const out: string[] = [];
const show = (when: string, m: import("../src/access/messages.ts").Message) => out.push(`**${when}**`, `- Title: ${m.title}`, `- Text: ${m.body}`, `- Buttons: ${m.actions.length ? m.actions.map((a) => `[${M.ACTION_LABELS[a]}]`).join(" ") : "(none)"}`, `- Colour: ${m.tone}`, "");
out.push("# Claude access: the words the user reads", "", "Status: APPROVED by the owner (2026-11-17), including the API-key pause message added after the first approval (also approved 2026-11-17). Any later wording change needs approval again. Generated from `engine/src/access/messages.ts` by `engine/evals/dump-messages.ts`; edit the code, then regenerate. Every message has a hidden Details text (technical, shown only behind a Details expander and in Copy diagnostics) that is not shown here. Example times use 17 November 2026, 10 am.", "",
  "Rules every message follows (tested): a short title, one to three plain sentences saying what happened and what to do next, no jargon, UK English, never a key, token, error code or account detail.", "");
out.push("## 1. The subscription notice (the user must tick it)", "", `**${M.SUBSCRIPTION_NOTICE.title}**`, "", M.SUBSCRIPTION_NOTICE.intro, "", ...M.SUBSCRIPTION_NOTICE.points.map((p) => `- **${p.heading}.** ${p.text}`), "", `[ ] ${M.SUBSCRIPTION_NOTICE.checkbox}`, "");
out.push("## 2. The state of the connection (Settings > Claude, and the banner)", "");
const states: [string, S][] = [
  ["Nothing chosen yet", { kind: "not_chosen" }], ["Subscription chosen, notice not ticked", { kind: "notice_needed" }],
  ["Subscription, not signed in", { kind: "not_connected", mode: "subscription" }], ["API key, none saved", { kind: "not_connected", mode: "apiKey" }],
  ["Signed in (Pro plan, ends 9 December)", { kind: "connected", mode: "subscription", plan: "pro", expiresAt: at(22, 12), daysLeft: 22 }], ["Signed in (end date unknown)", { kind: "connected", mode: "subscription", plan: null, expiresAt: null, daysLeft: null }],
  ["Sign-in runs out tomorrow at 3 pm", { kind: "expiring_soon", mode: "subscription", plan: "pro", expiresAt: at(1, 15), daysLeft: 1 }], ["Sign-in expired or ended", { kind: "expired", mode: "subscription" }],
  ["API key saved, not yet tested", { kind: "key_saved", mode: "apiKey" }], ["API key refused", { kind: "key_invalid", mode: "apiKey" }], ["Anthropic does not allow the subscription for this account", { kind: "subscription_refused", mode: "subscription" }],
  ["Account on hold", { kind: "account_problem", mode: "subscription", why: "on_hold" }], ["Billing problem", { kind: "account_problem", mode: "apiKey", why: "billing" }], ["Verification needed", { kind: "account_problem", mode: "subscription", why: "verification" }],
  ["Subscription usage limit, resets today at 3:40 pm", { kind: "limited", mode: "subscription", resetsAt: at(0, 15, 40) }], ["Subscription usage limit, reset time unknown", { kind: "limited", mode: "subscription", resetsAt: null }],
  ["API key being limited, reset time unknown", { kind: "limited", mode: "apiKey", resetsAt: null }],
  ["Claude's program will not start", { kind: "unknown", mode: "subscription", reason: "not_runnable" }], ["Claude did not answer in time", { kind: "unknown", mode: "subscription", reason: "timeout" }],
  ["The saved key cannot be read", { kind: "unknown", mode: "apiKey", reason: "keychain" }], ["Could not check (anything else)", { kind: "unknown", mode: "subscription", reason: "other" }],
];
for (const [w, s] of states) show(w, M.describeState(s, NOW));
out.push("## 3. A job that stopped (shown on the job, in a notification, and in Telegram)", "");
const pk = (k: Parameters<typeof M.describePause>[0], w: string, o: Partial<Parameters<typeof M.describePause>[1]> = {}) => show(w, M.describePause(k, { now: NOW, ...o }));
pk("auth", "Needs a new sign-in"); pk("auth", "A paused job for a user with an API key whose key was refused or is missing", { mode: "apiKey" }); pk("rate_limit", "Usage limit, reset known (today at 3 pm)", { resetsAt: at(0, 15) }); pk("rate_limit", "Usage limit, reset unknown"); pk("unavailable", "Claude cannot be reached"); pk("account", "Account or billing problem"); pk("timeout", "Claude took too long");
pk("cap", "Monthly spend limit reached (with amounts)", { capUsd: 10, spentUsd: 10.2 }); pk("cap", "Monthly spend limit reached (amounts unknown)"); pk("setup", "The app could not set Claude up"); pk("isolation", "A safety check stopped the job"); pk("other", "Anything else, job can be resumed"); pk("other", "Anything else, job could not be saved as paused", { pausable: false });
out.push("## 4. Signing in", "");
for (const e of [{ type: "starting" }, { type: "link", url: "https://claude.com/x" }, { type: "waiting_for_browser" }, { type: "code_requested" }, { type: "confirming" }, { type: "link_blocked" }] as const) show(`While signing in: ${e.type.replace(/_/g, " ")}`, M.describeSignInEvent(e));
for (const r of [{ ok: true }, { ok: false, reason: "cancelled" }, { ok: false, reason: "timeout" }, { ok: false, reason: "failed" }, { ok: false, reason: "not_confirmed" }, { ok: false, reason: "not_runnable" }, { ok: false, reason: "already_running" }] as const) show(`Sign-in result: ${r.ok ? "success" : r.reason.replace(/_/g, " ")}`, M.describeSignInResult(r));
out.push("## 5. Test connection and saving an API key", "");
show("Test passed (cost shown when there was one)", M.describeTest({ ok: true, costUsd: 0.0004, ms: 900 }, { now: NOW, mode: "apiKey" }));
show("Test: Claude could not be reached", M.describeTest({ ok: false, kind: "unreachable" }, { now: NOW, mode: "apiKey" }));
show("Test: spend limit reached", M.describeTest({ ok: false, kind: "cap" }, { now: NOW, mode: "apiKey" }));
show("Test: Claude used a different sign-in than chosen", M.describeTest({ ok: false, kind: "mode_mismatch" }, { now: NOW, mode: "apiKey" }));
show("Test: no key to test", M.describeTest({ ok: false, kind: "not_started" }, { now: NOW, mode: "apiKey" }));
show("Test: something unrecognised", M.describeTest({ ok: false, kind: "other" }, { now: NOW, mode: "apiKey" }));
show("Key saved and working", M.describeConnect({ ok: true }, { now: NOW })); show("Key does not look like a key", M.describeConnect({ ok: false, kind: "malformed" }, { now: NOW }));
show("Key refused by Claude", M.describeConnect({ ok: false, kind: "access", state: { kind: "key_invalid", mode: "apiKey" } }, { now: NOW })); show("Key could not be checked (no connection)", M.describeConnect({ ok: false, kind: "unreachable" }, { now: NOW }));
show("Key could not be checked (spend limit)", M.describeConnect({ ok: false, kind: "cap" }, { now: NOW })); show("Key could not be checked (anything else)", M.describeConnect({ ok: false, kind: "other" }, { now: NOW }));
out.push("## 6. Usage lines in Settings", "", "Examples:", "");
const z = (a: number, ac: number, s: number, cap: number | null, spent: number) => M.usageLines({ thisMonth: { apiKey: { usd: a, calls: ac }, subscription: { usd: 0, calls: s } }, cap: { capUsd: cap, spentUsd: spent, remainingUsd: cap === null ? null : Math.max(0, cap - spent), reached: cap !== null && spent >= cap } });
out.push(...z(7.5, 12, 0, 10, 7.5).map((l) => `- ${l}`), ...z(10, 3, 4, 10, 10).map((l) => `- ${l}`), ...z(0, 0, 9, null, 0).map((l) => `- ${l}`), "");
console.log(out.join("\n"));
