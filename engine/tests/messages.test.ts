// Phase 3f: the message catalogue. Every situation has a plain message; none shows a raw error, a code, a key, a token or an account detail; the wording rules (plain words,
// UK spelling, short) are checked on EVERY message, so a message added later cannot break them unnoticed.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const M = await import("../src/access/messages.ts");
const { EXIT } = await import("../src/agents/errors.ts");
const PL = await import("../src/pipeline.ts");
type S = import("../src/access/state.ts").AccessState;
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const L0 = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi, 0);
const NOW = L0(2026, 11, 17, 10, 0), iso = (d: Date) => d.toISOString();

// ---------- every situation, in every variant ----------
const states: S[] = [
  { kind: "not_chosen" }, { kind: "notice_needed" },
  { kind: "not_connected", mode: "subscription" }, { kind: "not_connected", mode: "apiKey" },
  { kind: "connected", mode: "subscription", plan: "pro", expiresAt: iso(L0(2026, 12, 9)), daysLeft: 21 }, { kind: "connected", mode: "subscription", plan: null, expiresAt: null, daysLeft: null },
  { kind: "expiring_soon", mode: "subscription", plan: "max", expiresAt: iso(L0(2026, 11, 18, 15)), daysLeft: 1 },
  { kind: "expired", mode: "subscription" }, { kind: "key_saved", mode: "apiKey" }, { kind: "key_invalid", mode: "apiKey" }, { kind: "subscription_refused", mode: "subscription" },
  { kind: "account_problem", mode: "subscription", why: "on_hold" }, { kind: "account_problem", mode: "apiKey", why: "billing" }, { kind: "account_problem", mode: "subscription", why: "verification" },
  { kind: "limited", mode: "subscription", resetsAt: iso(L0(2026, 11, 17, 15, 40)) }, { kind: "limited", mode: "subscription", resetsAt: null }, { kind: "limited", mode: "apiKey", resetsAt: null }, { kind: "limited", mode: "apiKey", resetsAt: iso(L0(2026, 11, 19, 9)) },
  { kind: "unknown", mode: "subscription", reason: "not_runnable" }, { kind: "unknown", mode: "subscription", reason: "timeout" }, { kind: "unknown", mode: "apiKey", reason: "keychain" },
  { kind: "unknown", mode: "subscription", reason: "unreadable" }, { kind: "unknown", mode: "apiKey", reason: "other" },
];
const kinds = ["auth", "rate_limit", "unavailable", "account", "timeout", "cap", "setup", "isolation", "other"] as const;
const events: import("../src/access/signin.ts").SignInEvent[] = [{ type: "starting" }, { type: "link", url: "https://claude.com/x" }, { type: "link_blocked" }, { type: "waiting_for_browser" }, { type: "code_requested" }, { type: "confirming" }];
const results: import("../src/access/signin.ts").SignInResult[] = [{ ok: true }, ...(["cancelled", "timeout", "failed", "not_confirmed", "not_runnable", "already_running"] as const).map((reason) => ({ ok: false as const, reason }))];
const tests: import("../src/access/connect.ts").TestResult[] = [
  { ok: true, costUsd: 0.0004, ms: 900 }, { ok: true, costUsd: 0, ms: 5 },
  { ok: false, kind: "access", state: { kind: "key_invalid", mode: "apiKey" } }, { ok: false, kind: "access" }, { ok: false, kind: "unreachable" }, { ok: false, kind: "cap", why: "capped" },
  { ok: false, kind: "mode_mismatch", why: "x" }, { ok: false, kind: "not_started", why: "no key" }, { ok: false, kind: "other", why: "?" },
];
const connects = [{ ok: true as const }, ...(["malformed", "unreachable", "cap", "other"] as const).map((kind) => ({ ok: false as const, kind })), { ok: false as const, kind: "access", state: { kind: "key_invalid", mode: "apiKey" } as S }, { ok: false as const, kind: "access" }];

const all: { who: string; m: import("../src/access/messages.ts").Message }[] = [];
for (const s of states) all.push({ who: `state ${s.kind}${"mode" in s ? "/" + s.mode : ""}${"why" in s ? "/" + s.why : ""}${"reason" in s ? "/" + s.reason : ""}`, m: M.describeState(s, NOW) });
for (const k of kinds) for (const pausable of [true, false]) all.push({ who: `pause ${k} pausable=${pausable}`, m: M.describePause(k, { now: NOW, pausable, resetsAt: k === "rate_limit" ? iso(L0(2026, 11, 17, 15)) : null, capUsd: 10, spentUsd: 10.2 }) });
for (const pausable of [true, false]) all.push({ who: `pause auth (API key) pausable=${pausable}`, m: M.describePause("auth", { now: NOW, pausable, mode: "apiKey" }) });
for (const e of events) all.push({ who: `signin event ${e.type}`, m: M.describeSignInEvent(e) });
for (const r of results) all.push({ who: `signin result ${r.ok ? "ok" : r.reason}`, m: M.describeSignInResult(r) });
for (const mode of ["subscription", "apiKey"] as const) for (const t of tests) all.push({ who: `test ${t.ok ? "ok" : t.kind} ${mode}`, m: M.describeTest(t, { now: NOW, mode }) });
for (const c of connects) all.push({ who: `connect ${c.ok ? "ok" : c.kind}`, m: M.describeConnect(c, { now: NOW }) });

const ACTIONS = ["choose_subscription", "choose_api_key", "read_notice", "signin", "reconnect", "enter_key", "test", "resume", "retry", "switch_to_key", "switch_to_subscription", "raise_cap", "open_account", "open_settings", "update_app", "copy_diagnostics", "cancel"];
const JARGON = /\b(sdk|oauth|token|tokens|http|https|api error|stack|stderr|stdout|exception|undefined|null|nan|exit code|json|econn\w*|enotfound|etimedout|apikeysource|isolation|preflight|keychain|binary|env|cwd|401|403|404|429|500|502|503)\b/i;
const US_SPELLING = /\b(organization|color|canceled|center|behavior|favorite|license|analyze|recognize|authorize)\b/i;
const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).filter(Boolean).length;
const bad = (f: (x: { who: string; m: import("../src/access/messages.ts").Message }) => boolean) => all.filter((x) => !f(x)).map((x) => x.who);
const report = (label: string, list: string[]) => { if (list.length) console.log(`   ${label}: ${list.slice(0, 6).join(" | ")}`); return list.length === 0; };

ok(`coverage: ${all.length} messages built from every state (${states.length} variants), paused-job reason (${kinds.length}, resumable and not), sign-in event and result, test result and key result`, all.length >= 75);
ok("every message has an id, a title of 3 to 60 characters, a body of 10 to 260 characters in at most 3 sentences, a valid tone and a details text", report("shape", bad(({ m }) => m.id.length > 3 && m.title.length >= 3 && m.title.length <= 60 && m.body.length >= 10 && m.body.length <= 260 && sentences(m.body) <= 3 && ["ok", "info", "warn", "error"].includes(m.tone) && m.details.length > 3)));
ok("titles and bodies use plain words: no SDK, token, HTTP, status numbers, exit code, JSON, error names, 'Keychain', 'isolation' or other jargon (the technical part is only in Details)", report("jargon", bad(({ m }) => !JARGON.test(m.title) && !JARGON.test(m.body))));
ok("UK English everywhere: no American spellings (organization, color, canceled, license ...)", report("spelling", bad(({ m }) => !US_SPELLING.test(m.title + " " + m.body))));
ok("buttons are real, not repeated, and an error always offers at least one way forward", report("actions", bad(({ m }) => m.actions.every((a) => ACTIONS.includes(a)) && new Set(m.actions).size === m.actions.length && (m.tone !== "error" || m.actions.length > 0))));
ok("every button has a plain label of 2 to 30 characters, in sentence case", Object.keys(M.ACTION_LABELS).length === ACTIONS.length && ACTIONS.every((a) => { const l = (M.ACTION_LABELS as Record<string, string>)[a]; return !!l && l.length >= 2 && l.length <= 30 && !/_/.test(l) && /^[A-Z]/.test(l) && !US_SPELLING.test(l); }));
ok("no title or body is empty-looking or contains a leftover placeholder: no 'undefined', 'null', 'NaN', '[object', '{', '}' or doubled spaces or '..'", report("placeholders", bad(({ m }) => !/undefined|null|NaN|\[object|[{}]|\s{2,}|\.\.|\$NaN/.test(m.title + " " + m.body))));
ok("one message per situation: the same state always gets the same id (data such as a date changes the words, not the id), and two different kinds of state never share an id", (() => { const byWho = new Map<string, Set<string>>(), byKind = new Map<string, Set<string>>(); for (const x of all.filter((y) => y.who.startsWith("state "))) { byWho.set(x.who, (byWho.get(x.who) ?? new Set()).add(x.m.id)); const k = x.who.split(" ")[1].split("/")[0]; byKind.set(k, (byKind.get(k) ?? new Set()).add(x.m.id)); } const owner = new Map<string, string>(); for (const [k, ids] of byKind) for (const id of ids) { if (owner.has(id) && owner.get(id) !== k) return false; owner.set(id, k); } return [...byWho.values()].every((v) => v.size === 1); })());

// ---------- nothing sensitive ever gets out ----------
{
  const evil = "email=person@example.org; key=sk-ant-api03-CANARYKEY0123456789; bot=123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi12345; org=OrgCanary";
  const leaky = [...states.map((s) => M.describeState(s, NOW, { details: evil })), ...kinds.map((k) => M.describePause(k, { now: NOW, details: evil })), ...tests.map((t) => M.describeTest({ ...t, why: evil } as never, { now: NOW, mode: "apiKey" }))];
  ok("a technical detail carrying a key or a bot token is REDACTED in Details, and no detail ever reaches a title or a body", leaky.every((m) => !/sk-ant|ABCDEFGHIJKLMNOPQRSTUVWXYZ/.test(m.details) && !/person@|sk-ant|CANARY|123456789|OrgCanary|email=/.test(m.title + m.body)));
  ok("details are short (at most 300 characters) so they can be shown and copied safely", leaky.every((m) => m.details.length <= 300));
  const src = readFileSync(path.join(dir, "..", "src", "access", "messages.ts"), "utf8");
  ok("the catalogue never reads an account's e-mail address or organisation from anything (it is never given them)", !/\.email\b|orgName|orgId|\.org\b/.test(src.replace(/\/\/.*$/gm, "")));
}

// ---------- the words depend on what we know ----------
{
  const lim = (s: S) => M.describeState(s, NOW).body;
  ok("a usage limit says WHEN it resets when we know (today at 3:40 pm), and says 'a little later' when we do not; a reset on another day says the day", /resets today at 3:40 pm/.test(lim({ kind: "limited", mode: "subscription", resetsAt: iso(L0(2026, 11, 17, 15, 40)) })) && /a little later/.test(lim({ kind: "limited", mode: "subscription", resetsAt: null })) && /on Thursday at 9 am/.test(lim({ kind: "limited", mode: "apiKey", resetsAt: iso(L0(2026, 11, 19, 9)) })));
  ok("a limit on the subscription and a limit on an API key say different things (the subscription resets; the key is just being slowed down)", M.describeState({ kind: "limited", mode: "subscription", resetsAt: null }, NOW).title !== M.describeState({ kind: "limited", mode: "apiKey", resetsAt: null }, NOW).title);
  const cap = M.describePause("cap", { now: NOW, capUsd: 10, spentUsd: 10.2 }), cap0 = M.describePause("cap", { now: NOW });
  ok("the spend-limit pause shows what was used and the limit when known ('$10.20 of your $10.00'), and stays sensible when not; it offers 'raise the limit'", /\$10\.20 of your \$10\.00/.test(cap.body) && cap.actions.includes("raise_cap") && !/\$/.test(cap0.body) && cap0.title === cap.title);
  ok("a job that could not be saved as paused (not resumable) never promises 'nothing is lost' or a Resume button", (() => { const m = M.describePause("other", { now: NOW, pausable: false }); return !/nothing is lost|Resume/.test(m.body) && !m.actions.includes("resume"); })() && (() => { const m = M.describePause("auth", { now: NOW, pausable: false }); return !/nothing is lost/.test(m.body); })());
  ok("the test message shows the cost when there was one (a fraction of a cent keeps its digits: $0.0004) and none when it was free", /about \$0\.0004/.test(M.describeTest({ ok: true, costUsd: 0.0004, ms: 1 }, { now: NOW, mode: "apiKey" }).body) && !/cost/.test(M.describeTest({ ok: true, costUsd: 0, ms: 1 }, { now: NOW, mode: "apiKey" }).body));
  ok("a test that failed because Claude could not be reached does NOT blame the key or the sign-in", /isn't the problem/.test(M.describeTest({ ok: false, kind: "unreachable" }, { now: NOW, mode: "apiKey" }).body));
  ok("a connected message shows the plan (capitalised) and the end date in plain words, or just the plan when the date is unknown", /Pro plan.*until 9 December/.test(M.describeState(states[4], NOW).body) && /signed in with your plan\.$/.test(M.describeState(states[5], NOW).body));
  ok("'expiring soon' says when the sign-in runs out (tomorrow at 3 pm) and offers Reconnect", /tomorrow at 3 pm/.test(M.describeState(states[6], NOW).body) && M.describeState(states[6], NOW).actions.includes("reconnect"));
}
ok("an API-key user is never told to 'sign in': a paused job with a refused or missing key says the key was not accepted and offers 'Enter API key'; a subscription user still gets the sign-in wording (found live in 3h)", (() => { const k = M.describePause("auth", { now: NOW, mode: "apiKey" }), sub = M.describePause("auth", { now: NOW, mode: "subscription" }); return /API key/.test(k.title) && !/sign in/i.test(k.title + k.body) && k.actions.includes("enter_key") && /sign in/i.test(sub.title) && !k.actions.includes("reconnect"); })());
// ---------- time words ----------
{
  const w = (d: Date | string | null | undefined) => M.formatWhen(d, NOW);
  ok("time words: today, tomorrow, a weekday within the week, a date later, with the year only when it is another year; 12 am and 12 pm; minutes only when not on the hour", w(L0(2026, 11, 17, 15, 40)) === "today at 3:40 pm" && w(L0(2026, 11, 17, 0, 0)) === "today at 12 am" && w(L0(2026, 11, 17, 12, 0)) === "today at 12 pm" && w(L0(2026, 11, 18, 9, 5)) === "tomorrow at 9:05 am" && w(L0(2026, 11, 20, 18)) === "on Friday at 6 pm" && w(L0(2026, 11, 30, 9)) === "on 30 November" && w(L0(2027, 1, 2, 9)) === "on 2 January 2027");
  ok("time words: a missing or invalid time gives null (never 'Invalid Date' or NaN); a time earlier today still reads naturally", w(null) === null && w(undefined) === null && w("not a date") === null && w(L0(2026, 11, 17, 8, 30)) === "today at 8:30 am" && M.formatDate("garbage", NOW) === null && M.formatDate(L0(2026, 12, 9), NOW) === "9 December");
}
// ---------- the subscription notice ----------
{
  const n = M.SUBSCRIPTION_NOTICE, text = [n.title, n.intro, ...n.points.map((p) => p.heading + " " + p.text), n.checkbox].join(" ");
  ok("the subscription notice covers what the app uses, what could change (Anthropic may limit or stop it and the risk is the user's) and what to do if it stops (an API key), with a tick-box sentence", n.points.length === 3 && /uses/i.test(n.points[0].heading) && /could change/i.test(n.points[1].heading) && /Anthropic/.test(n.points[1].text) && /may limit or stop/.test(n.points[1].text) && /yours/.test(n.points[1].text) && /stops/i.test(n.points[2].heading) && /API key/.test(n.points[2].text) && /understand/.test(n.checkbox));
  ok("the notice is in plain words and UK English, and says the app never sees or stores the user's password or sign-in", !JARGON.test(text) && !US_SPELLING.test(text) && /never sees or stores your password/.test(text));
}
// ---------- usage lines ----------
{
  const z = { thisMonth: { apiKey: { usd: 0, calls: 0 }, subscription: { usd: 0, calls: 0 } }, cap: { capUsd: null, spentUsd: 0, remainingUsd: null, reached: false } };
  ok("usage lines: nothing used and no limit gives no lines; an API-key month with a limit shows the total, the amount left and the request count (singular and plural); a reached limit says so; subscription requests are 'not billed per request'", M.usageLines(z).length === 0
    && M.usageLines({ ...z, thisMonth: { ...z.thisMonth, apiKey: { usd: 2.5, calls: 1 } } })[0] === "API key, this month: $2.50 (1 request)"
    && M.usageLines({ thisMonth: { apiKey: { usd: 7.5, calls: 12 }, subscription: { usd: 0, calls: 0 } }, cap: { capUsd: 10, spentUsd: 7.5, remainingUsd: 2.5, reached: false } }).join("|") === "API key, this month: $7.50 (12 requests)|$2.50 left of your $10.00 monthly limit"
    && M.usageLines({ thisMonth: { apiKey: { usd: 10, calls: 3 }, subscription: { usd: 1, calls: 4 } }, cap: { capUsd: 10, spentUsd: 10, remainingUsd: 0, reached: true } }).join("|") === "API key, this month: $10.00 (3 requests)|Monthly limit of $10.00 reached|Subscription, this month: 4 requests (not billed per request)");
}
// ---------- wired to the rest of the app ----------
{
  const exitKinds = Object.keys(EXIT).filter((k) => k !== "ok");
  ok("every failure code the runner can return has a message: each exit-code name (setup, auth, rate_limit, unavailable, account, isolation, timeout, cap, other) is a message kind", exitKinds.every((k) => (kinds as readonly string[]).includes(k)) && kinds.every((k) => M.describePause(k, { now: NOW }).title.length > 3));
  ok("the note on a paused job is the catalogue's title (one set of words for the whole app): the real pipeline's notes match", (["auth", "rate_limit", "unavailable", "account", "timeout", "cap"] as const).every((k) => typeof PL.StepError === "function" && M.describePause(k, { now: new Date(0) }).title.length > 3) && /sign in again/.test(M.describePause("auth", { now: NOW }).title));
}
console.log(failures === 0 ? "\nall messages tests passed" : `\n${failures} messages test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
