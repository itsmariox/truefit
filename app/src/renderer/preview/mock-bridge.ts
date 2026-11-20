// DEVELOPMENT ONLY (never part of a build): a pretend bridge so every screen can be looked at in a plain browser. It uses the REAL wording catalogue from the engine, and a small
// state machine that behaves like the main process (choose, tick, sign in, save a key, test). Open the page with ?scenario=NAME (see SCENARIOS).
import { ACTION_LABELS, SUBSCRIPTION_NOTICE, describeConnect, describeSignInEvent, describeSignInResult, describeState, describeTest, type Message } from "../../../../engine/src/access/messages.ts";
import { OPENAI_ACTION_LABELS, OPENAI_PLAN_NOTICE, describeOpenAIConnect, describeOpenAISignInEvent, describeOpenAISignInResult, describeOpenAIState, describeOpenAITest } from "../../../../engine/src/access/messages-openai.ts";
import type { AccessState } from "../../../../engine/src/access/state.ts";
import { INVALID, channels, type AccessView, type ChannelName, type CreateJobOutcome, type CvAppBridge, type EventMap, type Result, type SignInProgress, type StartStatus, type UiJobDetail, type UiJobRow, type UiMessage, type UiVerdict } from "../../shared/contract.ts";

export const SCENARIOS = ["fresh", "notice", "signedout", "connected", "expiring", "keyinvalid", "expired", "damaged", "damaged-nobackups", "too-new", "upgrade-failed", "failed", "starting", "jobs", "noprofile", "onboarding"] as const;
const NOW = () => new Date();
const ui = (m: Message): UiMessage => ({ id: m.id, tone: m.tone, title: m.title, body: m.body, actions: m.actions.map((id) => ({ id, label: ACTION_LABELS[id] })), details: m.details });
const day = (n: number) => new Date(Date.now() + n * 86400_000).toISOString();

export function createMockBridge(scenario: string): CvAppBridge {
  let provider: "claude" | "openai" = scenario === "openai" ? "openai" : "claude"; let mode: "subscription" | "apiKey" | null = null, accepted = false, state: AccessState = { kind: "not_chosen" }, signingIn: ReturnType<typeof setTimeout>[] = [];
  const listeners = new Map<string, Set<(p: never) => void>>();
  const stepsFor = (jobId: string) => { const plan: [string, number, number][] = [["analyst", 0, 800], ["check", 800, 1500], ["coach", 1500, 2300]]; for (const [name, a, b] of plan) { setTimeout(() => emit("jobs:step", { jobId, scope: "analyse", name, phase: "start" }), a + 50); setTimeout(() => emit("jobs:step", { jobId, scope: "analyse", name, phase: "done" }), b); } };
  const emit = <E extends keyof EventMap>(e: E, p: EventMap[E]) => listeners.get(e)?.forEach((l) => l(p as never));
  let start: StartStatus = { phase: "ready", backups: [] };
  const backups = [{ id: "ba", createdAt: day(-1), reason: "daily" }, { id: "bb", createdAt: day(-3), reason: "change" }];
  switch (scenario) {
    case "jobs": case "noprofile": mode = "subscription"; accepted = true; state = { kind: "connected", mode, plan: "Pro", expiresAt: day(20), daysLeft: 20 }; break;
    case "notice": mode = "subscription"; state = { kind: "notice_needed" }; break;
    case "signedout": mode = "subscription"; accepted = true; state = { kind: "not_connected", mode }; break;
    case "connected": mode = "subscription"; accepted = true; state = { kind: "connected", mode, plan: "Pro", expiresAt: day(20), daysLeft: 20 }; break;
    case "expiring": mode = "subscription"; accepted = true; state = { kind: "expiring_soon", mode, plan: "Pro", expiresAt: day(1), daysLeft: 1 }; break;
    case "keyinvalid": mode = "apiKey"; state = { kind: "key_invalid" } as AccessState; break;
    case "expired": mode = "subscription"; accepted = true; state = { kind: "expired", mode } as AccessState; break;
    case "damaged": start = { phase: "damaged", backups }; break;
    case "damaged-nobackups": start = { phase: "damaged", backups: [] }; break;
    case "too-new": start = { phase: "too-new", backups: [] }; break;
    case "upgrade-failed": start = { phase: "upgrade-failed", backups }; break;
    case "failed": start = { phase: "failed", backups: [] }; break;
    case "starting": start = { phase: "starting", backups: [] }; setTimeout(() => { start = { phase: "ready", backups: [] }; }, 2500); break;
  }
  // ---- jobs (pretend): a few sample jobs; a new job is "analysed" after a short wait so every state can be seen ----
  type MJob = { row: UiJobRow; detail: UiJobDetail; text: string };
  const jobs: MJob[] = []; let seq = 0;
  const verdictFor = (t: string): UiVerdict => /director/i.test(t)
    ? { verdict: "skip", fit: 31, fitNote: "A very senior role with a pay band above your floor and a team of twenty.", summary: "This is a director role. Your experience is mid-level, and the ad asks for ten years of leading large teams.", location: "Manchester", workMode: "on site", salary: "£95,000", seniority: "director", rules: [{ rule: "seniority", status: "fail", note: "The ad asks for a director; your rules say mid-level at most." }, { rule: "location", status: "ok", note: "Manchester is inside your range." }], strengths: ["Your campaign reporting matches the analytics duties."], gaps: [{ gap: "Leading a team of twenty", handle: "Say plainly that you've led a team of four." }] }
    : /locum|contract/i.test(t) ? { verdict: "long_shot", fit: 54, fitNote: "Some of the must-haves are only partly covered.", summary: "A short contract that fits half of your experience.", location: "Leeds", workMode: "hybrid", salary: "£300 a day", seniority: "mid", rules: [{ rule: "salary", status: "unclear", note: "The ad gives a day rate only." }], strengths: ["Email campaign delivery is a clear match."], gaps: [{ gap: "Paid social budgets", handle: "Mention the small test budget you managed." }] }
    : { verdict: "apply", fit: 78, fitNote: "Most of the must-haves are covered by roles you've verified.", summary: "A marketing role close to what you do now, in your city.", location: "Leeds", workMode: "hybrid", salary: "£34,000 to £38,000", seniority: "mid", rules: [{ rule: "seniority", status: "ok", note: "Mid-level." }, { rule: "salary", status: "ok", note: "Above your floor." }, { rule: "location", status: "ok", note: "Hybrid in Leeds." }], strengths: ["Weekly email campaigns with reporting in Google Analytics.", "Social posting for a small retail brand."], gaps: [{ gap: "Paid search", handle: "Mention the short course you completed." }] };
  const titles = (t: string) => (/director/i.test(t) ? "Brightwell Home, Marketing Director" : /locum|contract/i.test(t) ? "Larkfield Pet Supplies, Marketing Contractor" : "Acme Retail, Marketing Executive");
  const rowOf = (j: MJob) => j.row; const pushRows = () => emit("jobs:changed", { rows: jobs.map(rowOf) }); const notices: import("../../shared/contract.ts").UiBanner[] = [];
  const addJob = (text: string, status: string, source: "text" | "link" = "text"): MJob => {
    const id = `job${++seq}`, t = status === "analysed" ? titles(text) : "New job";
    const j: MJob = { text, row: { id, title: t, status, verdict: null, fit: null, needsYou: false, updated: new Date().toISOString() }, detail: { id, title: t, status, source, url: null, note: null, verdict: null, coach: null, pause: null, queue: null, build: { state: "none", question: null, layoutWhy: null, pdf: false, versions: 0 }, extras: [] } };
    jobs.unshift(j); return j;
  };
  const finishAnalysis = (j: MJob, silent = false) => { const v = verdictFor(j.text), t = titles(j.text); j.row = { ...j.row, title: t, status: "analysed", verdict: v.verdict, fit: v.fit, updated: new Date().toISOString() }; j.detail = { ...j.detail, title: t, status: "analysed", verdict: v, coach: `${VERDICT_LINE[v.verdict]}, ${v.fit}%: ${t}\n\n${v.summary}`, queue: null, pause: null }; pushRows();
    if (!silent) { const n = { id: `n${++seq}`, kind: "analysed" as const, jobId: j.row.id, title: "Job analysed", body: `${t}: ${VERDICT_LINE[v.verdict]}, fit ${v.fit}%`, at: new Date().toISOString() }; notices.unshift(n); emit("app:notice", n); } };
  const VERDICT_LINE = { apply: "Apply", long_shot: "Long shot", skip: "Skip" } as const;
  if (scenario === "jobs") {
    for (const t of ["Marketing director at Brightwell Home", "Marketing contractor, Larkfield", "Marketing executive at Acme"]) { const j = addJob(t, "analysed"); finishAnalysis(j, true); }
    const p = addJob("Paused sample ad", "paused"); p.row = { ...p.row, title: "Bramble Studio, Content Lead", needsYou: true }; p.detail = { ...p.detail, title: "Bramble Studio, Content Lead", status: "paused", pause: ui({ id: "pause.auth", tone: "warn", title: "Claude needs you to sign in again", body: "Your sign-in has run out or was ended. Nothing is lost: the job is paused, and you can press Resume after you sign in.", actions: ["resume"], details: "" }) };
  }
  // ---- profile (pretend) ----
  let stamp = "t0"; const bump = () => { stamp = `t${Date.now()}${Math.random().toString(36).slice(2, 5)}`; return stamp; }; // the profile's "saved at" stamp (the real app uses the stored time)
  let profile: any = scenario === "noprofile" || scenario === "onboarding" || scenario === "fresh" || scenario === "signedout" || scenario === "notice" ? null : { schemaVersion: 1, identity: { name: "Sample Person", email: "sample.person@example.com", city: "Leeds", country: "UK" }, roles: [{ id: "r1", title: "Marketing Executive", company: "Acme Retail", location: "Leeds", start: { y: 2020, m: 3 }, end: "present", status: "verified", bullets: [1, 2, 3].map((n) => ({ id: `b${n}`, text: `Sample achievement number ${n} with a figure.`, tags: ["email"], status: "verified" })).concat([{ id: "b9", text: "A draft achievement waiting for you to confirm it.", tags: [], status: "draft" }]) }], skills: [{ name: "Google Analytics", status: "verified" }, { name: "Copywriting", status: "draft" }], education: [], focusTypes: [], doNotUse: [], rules: { salaryFloor: { amount: 30000, currency: "GBP" }, location: { current: "Leeds", targets: ["Leeds"], workModes: ["hybrid"], cvLocationLines: ["Leeds, UK"] }, seniority: { levels: ["mid"], avoid: [] }, rightToWork: { statement: "I have the right to work in the UK", needsSponsorship: false }, avoidRoles: [] } };
  const gateOf = (p: any) => { const m: string[] = []; if (!p?.identity?.name?.trim() || !p.identity.city?.trim()) m.push("your name and city"); if (!p?.identity?.email?.trim() || !p.identity.country?.trim()) m.push("your email and country"); if (!(p?.roles ?? []).some((r: any) => r.bullets.filter((b: any) => b.status === "verified").length >= 3)) m.push("one role with at least 3 verified bullets"); const l = p?.rules?.location; if (!l?.current?.trim() || !l.workModes?.length || !l.cvLocationLines?.some((x: string) => x.trim())) m.push("where you are and where you want to work"); if (!p?.rules?.rightToWork?.statement?.trim()) m.push("your right to work"); return { ok: m.length === 0, missing: m }; };
  let tg: { state: "off" | "token_saved" | "pairing" | "paired" | "running" | "error"; botName: string | null; code: string | null } = { state: "off", botName: null, code: null };
  const cfg = { onboardingDone: scenario !== "onboarding", tone: "friendly", accent: "oxford", appearance: (typeof location !== "undefined" && new URLSearchParams(location.search).get("appearance")) || "light", showRightToWork: true, startAtLogin: false, capUsd: null as number | null, notify: { analysed: true, cvReady: true, needsInput: true, failed: true } };
  const settingsView = () => ({ usage: ["Subscription, this month: 14 requests (not billed per request)"], ...cfg, notify: { ...cfg.notify }, updateCheck: true, tones: ["friendly", "neutral", "concise"], accents: ["oxford", "forest", "plum", "slate", "charcoal"], version: "preview" });
  const oai = () => provider === "openai", labels = (): Record<string, string> => (oai() ? OPENAI_ACTION_LABELS : ACTION_LABELS);
  const uiP = (m: Message): UiMessage => ({ id: m.id, tone: m.tone, title: m.title, body: m.body, actions: m.actions.map((id) => ({ id, label: labels()[id] })), details: m.details });
  const view = (): AccessView => { const n = oai() ? OPENAI_PLAN_NOTICE : SUBSCRIPTION_NOTICE; return { provider, message: uiP((oai() ? describeOpenAIState : describeState)(state, NOW())), kind: state.kind, mode, noticeAccepted: accepted, connected: state.kind === "connected" || state.kind === "expiring_soon" || state.kind === "key_saved",
    notice: { title: n.title, intro: n.intro, points: n.points.map((p) => ({ heading: p.heading, text: p.text })), checkbox: n.checkbox } }; };
  const changed = () => { const v = view(); emit("access:changed", v); return v; };
  const wait = <T,>(v: T, ms = 400) => new Promise<T>((r) => setTimeout(() => r(v), ms));
  const progress = (e: Parameters<typeof describeSignInEvent>[0] | Parameters<typeof describeOpenAISignInEvent>[0], link: string | null = null, awaitingCode = false) => emit("access:signin", { running: true, message: uiP(oai() ? describeOpenAISignInEvent(e as never) : describeSignInEvent(e as never)), link, awaitingCode } satisfies SignInProgress);

  const dismissedCards: string[] = []; let unchecked: string[] = [];
  const overviewOf = () => { const cards: any[] = []; if (profile) {
    const n = profile.roles.reduce((a: number, r: any) => a + r.bullets.filter((b: any) => b.status === "draft").length, 0);
    if (n) cards.push({ key: "needs-review:mock", kind: "needs-review", message: `${n} achievement${n === 1 ? "" : "s"} waiting for a look (not used in CVs yet).`, options: ["accept", "dismiss"] });
    if (unchecked.length) cards.push({ key: "locked-check", kind: "locked-check", message: `The import filled in your ${unchecked.join(", ")} from your CV. Check it: it goes on every CV.`, options: ["accept"] });
    const ids = profile.roles.flatMap((r: any) => r.bullets.map((b: any) => b.id)); if (ids.includes("b1") && ids.includes("b2")) cards.push({ key: "duplicate:b1:b2", kind: "duplicate", message: "Two achievements say almost the same thing.", options: ["merge", "dismiss"] });
  } return { cards: cards.filter((c) => !dismissedCards.includes(c.key)), unchecked: [...unchecked], sources: [] }; };
  const handlers: Record<string, (r: any) => unknown> = {
    "app:info": () => ({ name: "Truefit", version: "preview", platform: "browser", packaged: false }), "app:ready": () => ({ shown: true }), "app:openLink": () => ({ opened: false }), "app:copy": () => ({ copied: true }),
    "app:status": () => start, "app:recover": () => { start = { phase: "ready", backups: [] }; return wait(start, 800); }, "app:startFresh": () => { start = { phase: "ready", backups: [] }; return wait(start, 800); },
    "notices:list": () => notices.slice(), "notices:dismiss": ({ id }: { id: string }) => { const i = notices.findIndex((n) => n.id === id); if (i >= 0) notices.splice(i, 1); return { dismissed: i >= 0 }; },
    "profile:get": () => ({ status: profile ? "ok" : "none", profile, gate: gateOf(profile), updatedAt: profile ? stamp : null }),
    "profile:overview": () => overviewOf(),
    "profile:card": ({ key, action }: { key: string; action: string }) => {
      if (!profile || !overviewOf().cards.some((c: any) => c.key === key)) return { ok: false, reason: "no_card" };
      if (action === "dismiss") dismissedCards.push(key);
      else if (key === "locked-check" && action === "accept") unchecked = [];
      else if (key.startsWith("duplicate:") && action === "merge") { for (const r of profile.roles) r.bullets = r.bullets.filter((b: any) => b.id !== "b2"); }
      else if (key.startsWith("needs-review") && action === "accept") { for (const r of profile.roles) for (const b of r.bullets) if (b.status === "draft") b.status = "verified"; }
      else return { ok: false, reason: "not_allowed" };
      return { ok: true, profile, updatedAt: bump(), overview: overviewOf() };
    },
    "voice:mic": () => ({ access: (globalThis as any).__micAccess ?? "granted" }),
    "voice:transcribe": ({ audio }: { audio: string }) => wait(audio === "QUIET" ? { status: "refused", reason: "quiet" } : { status: "ok", text: "I ran the weekly newsletter." }, 300),
    "profile:importFile": () => ({ status: "picked", text: "Sam Example\nMarketing Coordinator, Northfield Retail, Leeds, March 2021 - Present\n- Grew the newsletter list from 1,200 to 3,600 subscribers in 12 months.\nSkills: Google Analytics", kind: "docx" }),
    "profile:import": ({ text }: { text: string }) => { if (text.trim().length < 20) return { status: "refused", reason: "too_short", message: null };
      const base = profile ?? { schemaVersion: 1, identity: { name: "", city: "", country: "" }, roles: [], skills: [], education: [], focusTypes: [], doNotUse: [], rules: { salaryFloor: null, location: { current: "", targets: [], workModes: [], cvLocationLines: [] }, seniority: { levels: [], avoid: [] }, rightToWork: { statement: "", needsSponsorship: false }, avoidRoles: [] } };
      const out = JSON.parse(JSON.stringify(base)); out.roles.push({ id: "imp1", title: "Marketing Coordinator", company: "Northfield Retail", location: "Leeds", start: { y: 2021, m: 3 }, end: "present", status: "draft", bullets: [{ id: "impb1", text: "Grew the newsletter list from 1,200 to 3,600 subscribers in 12 months.", tags: ["email"], status: "verified" }, { id: "impb2", text: "Doubled revenue single-handedly.", tags: [], status: "draft" }] }); out.skills.push({ name: "Google Analytics", status: "draft" });
      if (!out.identity.phone) { out.identity.phone = "07700 900456"; unchecked = ["phone"]; } profile = out; return wait({ status: "ok", profile: out, added: { roles: 1, bullets: 2, skills: 1, education: 0 }, notFromCv: 1, dropped: 0, upgraded: 0, proposedName: null, updatedAt: bump() }, 900); }, // the import SAVES at once: what matches the CV is trusted, the rest waits in Review
    "profile:save": ({ profile: p, baseUpdatedAt }: { profile: any; baseUpdatedAt?: string }) => { if (baseUpdatedAt && profile && baseUpdatedAt !== stamp) return { ok: false, errors: ["Your profile was changed somewhere else (for example by a CV import) after you opened it. Reload this page, then make your changes again."] }; if (!p.identity?.name?.trim()) return { ok: false, errors: ["Your name is empty"] }; profile = JSON.parse(JSON.stringify(p)); return { ok: true, warnings: [], gate: gateOf(profile), updatedAt: bump() }; },
    "telegram:status": () => tg, "telegram:saveToken": ({ token }: { token: string }) => { if (!/^\d{5,15}:[A-Za-z0-9_-]{20,80}$/.test(token)) return { ok: false, botName: null, reason: "malformed", status: tg }; tg = { state: "token_saved", botName: "my_test_bot", code: null }; return { ok: true, botName: "my_test_bot", reason: null, status: tg }; },
    "telegram:pair": () => { tg = { state: "pairing", botName: tg.botName, code: "482913" }; setTimeout(() => { if (tg.state === "pairing") tg = { state: "paired", botName: tg.botName, code: null }; }, 6000); return tg; }, "telegram:cancelPair": () => { tg = { state: "token_saved", botName: tg.botName, code: null }; return tg; }, "telegram:disconnect": () => { tg = { state: "off", botName: null, code: null }; return tg; },
    "history:search": ({ text, verdict, sort, offset }: { text: string; verdict?: string; sort?: string; offset?: string }) => {
      let rows = jobs.map(rowOf).filter((r) => (!text || r.title.toLowerCase().split(/\W+/).some((w) => w.startsWith(text.toLowerCase().trim()))) && (!verdict || r.verdict === verdict));
      if (sort === "fit") rows = [...rows].sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1)); else if (sort === "company") rows = [...rows].sort((a, b) => a.title.localeCompare(b.title)); else if (sort === "oldest") rows = [...rows].reverse();
      return { rows: rows.slice(Number(offset ?? 0), Number(offset ?? 0) + 200), total: rows.length };
    },
    "history:summary": () => { const r = jobs.map(rowOf), an = r.filter((x) => x.verdict); return { jobs: r.length, analysed: an.length, built: r.filter((x) => x.status === "built").length, avgFit: an.length ? Math.round(an.reduce((a, x) => a + (x.fit ?? 0), 0) / an.length) : null, apply: an.filter((x) => x.verdict === "apply").length, long_shot: an.filter((x) => x.verdict === "long_shot").length, skip: an.filter((x) => x.verdict === "skip").length }; },
    "settings:get": () => settingsView(),
    "settings:set": ({ patch }: { patch: Record<string, any> }) => { if ("tone" in patch && !["friendly", "neutral", "concise"].includes(patch.tone)) return { ok: false, errors: ["bad"] }; if ("tone" in patch) cfg.tone = patch.tone; if ("accent" in patch) cfg.accent = patch.accent; if ("appearance" in patch) { if (!["light", "dark", "system"].includes(patch.appearance)) return { ok: false, errors: ["bad"] }; cfg.appearance = patch.appearance; } if ("onboardingDone" in patch) cfg.onboardingDone = patch.onboardingDone; if ("showRightToWork" in patch) cfg.showRightToWork = patch.showRightToWork; if ("startAtLogin" in patch) cfg.startAtLogin = patch.startAtLogin; if ("capUsd" in patch) cfg.capUsd = patch.capUsd; for (const k of ["Analysed", "CvReady", "NeedsInput", "Failed"]) if (`notify${k}` in patch) (cfg.notify as any)[k[0].toLowerCase() + k.slice(1)] = patch[`notify${k}`]; return { ok: true, settings: settingsView() }; },
    "data:saveText": () => wait({ status: "saved" }, 300),
    "data:export": () => wait({ status: "saved", jobs: jobs.length, files: jobs.length * 6, bytes: 123456 }, 600),
    "data:deleteJobs": ({ phrase }: { phrase: string }) => { const ok = phrase.trim().toLowerCase() === "delete jobs"; const n = jobs.length; if (ok) { jobs.length = 0; pushRows(); } return { deleted: ok, jobs: ok ? n : 0 }; },
    "data:importPick": () => ({ status: "picked", jobs: 12, createdAt: new Date().toISOString(), hasProfile: true }), "data:importConfirm": ({ phrase }: { phrase: string }) => ({ imported: phrase.trim().toLowerCase() === "replace everything" }),
    "data:delete": ({ phrase }: { phrase: string }) => ({ deleted: phrase.trim().toLowerCase() === "delete everything", warnings: [] }),
    "jobs:list": () => jobs.map(rowOf),
    "jobs:get": ({ id }: { id: string }) => jobs.find((j) => j.row.id === id)?.detail ?? null,
    "jobs:create": ({ text, force }: { text: string; force?: boolean }): CreateJobOutcome => {
      if (scenario === "noprofile") return { outcome: "refused", reason: "no_profile", missing: [] };
      if (!text.trim()) return { outcome: "refused", reason: "empty", missing: [] };
      if (/^https?:\/\/\S+$/.test(text.trim()) && /wall/.test(text)) return { outcome: "refused", reason: "link_failed", missing: [] };
      const dup = jobs.find((j) => j.text.trim().toLowerCase() === text.trim().toLowerCase()); if (dup) return { outcome: "duplicate", existing: dup.row };
      // the pretend gate (after the duplicate check, like the real one): a coarser stand-in (the real rules are tested in the engine and handler suites): one or two words is too short, a recipe is not a job
      if (!force && !/^https?:\/\/\S+$/.test(text.trim())) { if (text.trim().split(/\s+/).length < 3) return { outcome: "refused", reason: "too_short", missing: [] }; if (/recipe|weather forecast/i.test(text)) return { outcome: "refused", reason: "not_a_job", missing: [] }; }
      if (/queued/i.test(text)) { const q = addJob(text, "analysing"); q.detail = { ...q.detail, status: "analysing", queue: { state: "queued", position: 2, blocked: false } }; pushRows(); return { outcome: "created", job: q.row }; } // preview only: an ad that says "queued" stays waiting its turn, so that state can be looked at
      const j = addJob(text, "analysing"); stepsFor(j.row.id); pushRows(); return { outcome: "created", job: j.row };
    },
    "jobs:analyse": ({ id }: { id: string }) => { const j = jobs.find((x) => x.row.id === id); if (!j) return { queued: false, reason: "not_found" }; if (/queued/i.test(j.text)) return { queued: true, reason: null };
      j.row = { ...j.row, status: "analysing" }; j.detail = { ...j.detail, status: "analysing", verdict: null, queue: { state: "running", position: null, blocked: false } }; pushRows(); stepsFor(j.row.id); setTimeout(() => finishAnalysis(j), 2500); return { queued: true, reason: null }; },
    "jobs:resume": ({ id }: { id: string }) => handlers["jobs:analyse"]({ id }),
    "jobs:build": ({ id, layout, ignoreQuestions }: { id: string; layout?: string; ignoreQuestions?: boolean }) => { const j = jobs.find((x) => x.row.id === id); if (!j) return { queued: false, reason: "not_found" };
      j.detail = { ...j.detail, status: "building", queue: { state: "running", position: null, blocked: false }, build: { ...j.detail.build, state: "building" } }; j.row = { ...j.row, status: "building" }; pushRows();
      setTimeout(() => {
        const asks = /question/i.test(j.text) && !ignoreQuestions, tall = /layout/i.test(j.text) && !layout;
        if (asks) { j.row = { ...j.row, status: "needs_input", needsYou: true }; j.detail = { ...j.detail, status: "needs_input", queue: null, build: { state: "needs_fact", question: "I need a fact that isn't in your profile:\n• Have you managed a paid search budget? If so, how large?\nAnswer it, or build without it.", layoutWhy: null, pdf: false, versions: 0 } }; }
        else if (tall) { j.row = { ...j.row, status: "needs_input", needsYou: true }; j.detail = { ...j.detail, status: "needs_input", queue: null, build: { state: "needs_layout", question: null, layoutWhy: "the CV runs to 2 pages", pdf: false, versions: 0 } }; }
        else { j.row = { ...j.row, status: "built", needsYou: false }; j.detail = { ...j.detail, status: "built", queue: null, build: { state: "built", question: null, layoutWhy: null, pdf: true, versions: (j.detail.build.versions || 0) + 1 } }; const n = { id: `n${++seq}`, kind: "built" as const, jobId: id, title: "Your CV is ready", body: j.row.title, at: new Date().toISOString() }; notices.unshift(n); emit("app:notice", n); }
        pushRows();
      }, 2000); return { queued: true, reason: null }; },
    "jobs:extra": ({ id, kind }: { id: string; kind: any }) => { const j = jobs.find((x) => x.row.id === id); if (!j) return { queued: false, reason: "not_found" }; j.detail = { ...j.detail, queue: { state: "running", position: null, blocked: false } }; pushRows();
      setTimeout(() => { j.detail = { ...j.detail, queue: null, extras: [...j.detail.extras.filter((e) => e.kind !== kind), { kind, text: kind === "cover-note" ? "Dear hiring team,\n\nI'm writing about the Marketing Executive role. I've run weekly email campaigns for a retail brand and reported on results every week.\n\n✅ Every claim above is backed by your profile." : "A sample " + kind + " written from your verified facts." }] }; pushRows(); }, 1500); return { queued: true, reason: null }; },
    "jobs:openPdf": () => ({ opened: true }), "jobs:reveal": () => ({ shown: true }),
    "jobs:skip": ({ id }: { id: string }) => { const j = jobs.find((x) => x.row.id === id); if (j) { j.row = { ...j.row, status: "skipped", needsYou: false }; j.detail = { ...j.detail, status: "skipped", pause: null }; pushRows(); } return { skipped: true }; },
    "access:get": () => view(),
    "access:chooseMode": ({ mode: m }: { mode: "subscription" | "apiKey" }) => { mode = m; state = m === "subscription" ? (accepted ? { kind: "not_connected", mode: m } : { kind: "notice_needed" }) : { kind: "not_connected", mode: m }; return changed(); },
    "access:chooseProvider": ({ provider: p }: { provider: "claude" | "openai" }) => { provider = p; mode = null; accepted = false; state = { kind: "not_chosen" }; return changed(); },
    "access:signOut": (_a: { forget: boolean }) => { state = { kind: "not_connected", mode: "subscription" }; changed(); return { cleared: true, revoked: true }; },
    "access:acceptNotice": () => { accepted = true; state = { kind: "not_connected", mode: "subscription" }; return changed(); },
    "access:saveKey": ({ key }: { key: string }) => {
      const bad = /\s/.test(key) || !key.startsWith(oai() ? "sk-" : "sk-ant"); if (!bad) state = { kind: "connected", mode: "apiKey" } as unknown as AccessState; const v = changed();
      return wait({ view: v, message: uiP((oai() ? describeOpenAIConnect : describeConnect)(bad ? { ok: false, kind: "malformed" } : { ok: true }, { now: NOW() })) }, 900);
    },
    "access:test": () => wait({ view: view(), message: uiP((oai() ? describeOpenAITest : describeTest)({ ok: true, costUsd: 0.0004, ms: 900 }, { now: NOW(), mode: mode ?? "subscription" })) }, 900),
    "access:signIn": () => {
      progress({ type: "starting" });
      const L = oai() ? "https://auth.openai.com/api/accounts/authorize?preview=1" : "https://claude.ai/oauth/authorize?code=preview";
      signingIn = [setTimeout(() => progress({ type: "link", url: L }, L), 700), setTimeout(() => progress({ type: "waiting_for_browser" }, L), 1400),
        ...(oai() ? [] : [setTimeout(() => progress({ type: "code_requested" }, L, true), 2400)]), setTimeout(() => finish(true), oai() ? 5000 : 9000)];
      return { started: true };
    },
    "access:cancelSignIn": () => { signingIn.forEach(clearTimeout); signingIn = []; emit("access:signin", { running: false, message: uiP((oai() ? describeOpenAISignInResult : describeSignInResult)({ ok: false, reason: "cancelled" })), link: null, awaitingCode: false }); return { cancelled: true }; },
    "access:submitCode": () => { signingIn.forEach(clearTimeout); finish(true); return { accepted: true }; },
  };
  function finish(okay: boolean) { signingIn = []; if (okay) state = { kind: "connected", mode: "subscription", plan: oai() ? null : "Pro", expiresAt: oai() ? null : day(30), daysLeft: oai() ? null : 30 }; emit("access:signin", { running: false, message: uiP((oai() ? describeOpenAISignInResult : describeSignInResult)({ ok: okay } as never)), link: null, awaitingCode: false }); changed(); }

  return {
    invoke: (async (channel: ChannelName, request?: unknown): Promise<Result<unknown>> => {
      const def = channels[channel]; if (!def) return { ok: false, error: { code: "forbidden", message: "This request was not accepted." } };
      const checked = (def.request as (x: unknown) => unknown)(request); if (checked === INVALID) return { ok: false, error: { code: "invalid_request", message: "This request was not understood." } };
      return { ok: true, data: await handlers[channel](checked) };
    }) as never,
    on: ((event: string, l: (p: never) => void) => { const set = listeners.get(event) ?? new Set(); set.add(l); listeners.set(event, set); return () => set.delete(l); }) as never,
  };
}
