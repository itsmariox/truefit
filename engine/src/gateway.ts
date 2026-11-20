// The gateway (SPEC 1, piece 1): plain code on the Mac, no AI. It talks to Telegram, obeys only the user's paired
// chat, runs one job at a time, and turns button presses into pipeline steps. It never reads ad text itself and
// never holds the Claude token; the agents run in their container (pipeline.ts).
//   node src/gateway.ts        (normally started by launchd: bin/cv-bot install)
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { oneLine, redact } from "./checks.ts";
import { fetchJobAd } from "./fetchlink.ts";
import * as P from "./pipeline.ts";
import type { Extra, JobState, Pipeline } from "./pipeline.ts";
import { radarFromJobs, radarMessage } from "./radar.ts";
import type { Button, Telegram } from "./telegram.ts";
import { createTelegram, readBotToken } from "./telegram.ts";

export const STATE = path.join(P.ENGINE_DIR, "state");
export const log = (line: string) => { const l = `[${new Date().toISOString().replace("T", " ").slice(0, 19)}] ${redact(line, 500)}`; console.log(l); };

export const MIN_AD_CHARS = 300;
export const AWAIT_MS = 10 * 60_000;  // after "New job", the next message is taken as the ad for this long
const EXTRA_LABEL: Record<Extra, string> = { "cover-note": "Cover note", "interview-prep": "Interview prep", "recruiter-message": "Recruiter message", "company-brief": "Company brief" };
const EXTRA_CODE: Record<string, Extra> = { c: "cover-note", i: "interview-prep", m: "recruiter-message", b: "company-brief" };
const CODE_OF = Object.fromEntries(Object.entries(EXTRA_CODE).map(([k, v]) => [v, k])) as Record<Extra, string>;
export const firstUrl = (text: string) => (text.match(/https?:\/\/[^\s<>"']+/i) ?? [])[0] ?? null;

// Buttons only (a product decision, 2026-11-13). The menu pinned at the bottom of the chat; its labels are the only
// typed texts the bot acts on, plus the ONE message that follows "New job" (the ad or its link). Nothing else runs.
export const MENU = { newJob: "📝 New job", myJobs: "📂 My jobs", radar: "📡 Gap radar", status: "⚙️ Status" } as const;
export const MENU_ROWS = [[MENU.newJob, MENU.myJobs], [MENU.radar, MENU.status]];
export const WELCOME = [
  "Everything works with the buttons below.",
  "📝 New job: then paste the job description or a link. I check the fit, then you choose.",
  "📂 My jobs: open any earlier job for its CV, recruiter message, cover note, interview prep, company brief or gaps.",
  "📡 Gap radar: what keeps coming up as a gap.",
  "⚙️ Status: what I'm doing, pause and resume.",
].join("\n");

const ICON: Record<string, string> = { analysing: "⏳", building: "⏳", analysed: "🟡", needs_input: "❓", paused: "⏸️", interrupted: "⚠️", built: "✅", failed: "⚠️", skipped: "⏭️" };
const title = (j: JobState) => `${j.role ?? "(untitled)"}${j.company ? " · " + j.company : ""}`;
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// The buttons a job offers in its current state. The extras and Gaps are there whenever an analysis exists.
export function jobButtons(j: JobState, hasAnalysis: boolean): Button[][] {
  const id = j.id;
  if (j.status === "analysing" || j.status === "building") return [[{ text: "⏳ Working on it… (tap to refresh)", data: `j:${id}` }]];
  const rows: Button[][] = [];
  if (j.status === "built") rows.push([{ text: "📄 Send PDF again", data: `p:${id}` }]);
  else if (j.status === "needs_input" && j.needs === "layout") rows.push([{ text: "✂️ Try a shorter version", data: `l:s:${id}` }], [{ text: "📄 Deliver it anyway", data: `l:a:${id}` }]);
  else if (j.status === "needs_input") rows.push([{ text: "🔁 Retry (I updated my profile)", data: `r:${id}` }], [{ text: "🛠️ Build without it", data: `a:${id}` }]);
  else if (j.status === "paused" || j.status === "interrupted") rows.push([{ text: "▶️ Resume", data: `r:${id}` }]);
  else if (j.status === "failed") rows.push([{ text: "🔁 Retry", data: `r:${id}` }]);
  else if (j.status === "skipped") rows.push([{ text: "🛠️ Build CV anyway", data: `b:${id}` }]);
  else rows.push([{ text: "🛠️ Build CV", data: `b:${id}` }, { text: "⏭️ Skip", data: `s:${id}` }]);
  if (hasAnalysis) rows.push(
    [{ text: "💬 Recruiter message", data: `x:m:${id}` }, { text: "✍️ Cover note", data: `x:c:${id}` }],
    [{ text: "🎯 Interview prep", data: `x:i:${id}` }, { text: "🔎 Company brief", data: `x:b:${id}` }],
    [{ text: "⚠️ Gaps", data: `g:${id}` }],
  );
  return rows;
}

// "Gaps" for one job: plain code over its saved analysis. No AI, no quota.
export function gapsMessage(j: JobState, a: any): string {
  const L = [`⚠️ Gaps: ${title(j)} (${String(a.verdict ?? "").replace("_", " ")}, ${a.fit_percent ?? "?"}%)`];
  const gaps = (a.gaps ?? []) as any[];
  if (gaps.length) L.push("", ...gaps.slice(0, 8).map((g) => `• ${oneLine(g.gap, 60)}: ${oneLine(g.handle, 220)}`));
  const rules = ((a.constraint_checks ?? []) as any[]).filter((c) => c.status !== "ok");
  if (rules.length) L.push("", "Hard rules:", ...rules.map((c) => `${c.status === "fail" ? "🚫" : "❔"} ${oneLine(c.rule, 30).replace("_", " ")}: ${oneLine(c.note, 200)}`));
  const unv = ((a.unverified_needed ?? []) as string[]).map((x) => oneLine(x, 40)).filter(Boolean);
  if (unv.length) L.push("", `Asked for, but not in your profile: ${unv.join(", ")}. If you have them, add them to your profile.`);
  if (!gaps.length && !rules.length && !unv.length) L.push("", "No gaps were flagged for this job.");
  return L.join("\n");
}

export type Deps = {
  tg: Pick<Telegram, "send" | "sendDocument" | "sendMenu" | "answer" | "clearButtons" | "typing">;
  chatId: number; userId?: number;
  pipeline: Pick<Pipeline, "createJob" | "analyse" | "build" | "extra" | "skip" | "listJobs">; // the pipeline is always passed in: this module never builds one
  candidateName?: string;               // used for the CV file name
  fetchAd?: typeof fetchJobAd;
  dockerReady?: () => Promise<boolean>;
  stateDir?: string;
  now?: () => number;
};

type Task = { label: string; jobId?: string; key?: string; run: () => Promise<void> };
export const MAX_QUEUE = 10;          // queued tasks; more are refused so a mistake cannot queue dozens of paid jobs
export const SPLIT_WAIT_MS = 3000;    // Telegram splits a paste over 4,096 characters into several messages, sent within a second
export const SPLIT_MIN_CHARS = 3500;  // a message this long may be the first part of a split paste
export const STRANGER_ALERTS_PER_DAY = 3;

export function createBot(d: Deps) {
  const pl = d.pipeline;
  const stateDir = d.stateDir ?? STATE;
  const now = d.now ?? (() => Date.now());
  const queue: Task[] = [];
  let current: Task | null = null;
  const paused = () => existsSync(path.join(stateDir, "PAUSED"));
  const send = (text: string, buttons?: Button[][]) => d.tg.send(d.chatId, text, buttons);
  const findJob = async (id: string): Promise<JobState | undefined> => (await pl.listJobs()).find((j) => j.id === id);
  const hasFile = (j: JobState, f: string) => existsSync(path.join(j.dir, f));

  async function pump() {
    if (current || paused()) return;
    const t = queue.shift();
    if (!t) return;
    current = t;
    try {
      await t.run();
    } catch (e) {
      const err = e as P.StepError;
      log(`task "${t.label}" failed: ${err.message}`);
      const hint = err.kind === "auth" ? "Claude needs you to sign in again. Open the app and reconnect, then press Resume."
        : err.kind === "rate_limit" ? "Your Claude usage limit was hit. Nothing is lost: press Resume later."
        : err.kind === "unavailable" ? "Claude could not be reached (an outage or no internet). Nothing is lost: press Resume when it is back."
        : err.kind === "account" ? "There is a problem with your Claude account or billing. Fix it, then press Resume."
        : err.kind === "cap" ? "Your monthly spend limit for the API key has been reached. Raise the limit in the app (or wait for next month), then press Resume."
        : err.kind === "timeout" ? "Claude took too long to answer. Nothing is lost: press Resume to try again."
        : err.kind === "setup" || err.kind === "isolation" ? "A setup problem stopped it. Details are in the app's log."
        : `Something broke: ${oneLine(err.message, 300)}`;
      await send(`⚠️ ${hint}`, t.jobId ? [[{ text: err.pausable ? "▶️ Resume" : "🔁 Retry", data: `r:${t.jobId}` }]] : undefined).catch(() => {});
    } finally { current = null; void pump(); }
  }
  const refuseIfFull = async () => { if (queue.length < MAX_QUEUE) return false; await send(`🚦 The queue is full (${MAX_QUEUE} waiting). I didn't take that one: send it again once a few have finished.`); return true; };
  async function enqueue(t: Task) {
    // Check and queue in one step, with no await in between, so simultaneous taps cannot all slip through.
    if (t.key && (current?.key === t.key || queue.some((x) => x.key === t.key))) return; // already queued or running (double press)
    if (queue.length >= MAX_QUEUE) { await send(`🚦 The queue is full (${MAX_QUEUE} waiting). I didn't take that one: try again once a few have finished.`); return; }
    queue.push(t);
    if (paused()) { await send(`⏸️ Paused. Queued (${t.label}); I'll start when you tap ⚙️ Status → Resume.`); return; }
    if (current) await send(`⏳ Queued (${t.label}). I'm busy ${current.label}${queue.length > 1 ? `, and ${queue.length - 1} more ${queue.length === 2 ? "is" : "are"} waiting before it` : ""}.`);
    void pump();
  }

  // ---- the steps ----
  const analyseTask = (job: JobState): Task => ({ label: "analysing a job", jobId: job.id, key: `analyse:${job.id}`, run: async () => {
    await send("📥 Got it. Checking the fit… (about a minute)");
    void d.tg.typing(d.chatId);
    const r = await pl.analyse(job);
    await send(r.message, jobButtons(r.job, true));
  } });
  const buildTask = (id: string, ignoreQuestions = false, layout?: "shorter" | "anyway", refreshProfile = false): Task => ({ label: "building a CV", jobId: id, key: `build:${id}`, run: async () => {
    const job = await findJob(id);
    if (!job) { await send("I can't find that job any more."); return; }
    await send(`🛠️ Building your CV for ${title(job)}… (about a minute)`);
    const r = await pl.build(job, { ignoreQuestions, layout, refreshProfile });
    if (r.status === "built" && r.pdf) {
      await send(r.message);
      await d.tg.sendDocument(d.chatId, r.pdf, pdfName(r.job), "📎 Your CV", jobButtons(r.job, true));
    } else await send(r.message, jobButtons(r.job, true));
  } });
  const extraTask = (id: string, kind: Extra): Task => ({ label: EXTRA_LABEL[kind].toLowerCase(), jobId: id, key: `extra:${kind}:${id}`, run: async () => {
    const job = await findJob(id);
    if (!job) { await send("I can't find that job any more."); return; }
    await send(kind === "company-brief" ? "🔎 Researching the company… (up to 5 minutes)" : `✍️ Writing the ${EXTRA_LABEL[kind].toLowerCase()}…`);
    const msg = await pl.extra(job, kind);
    const again = kind === "interview-prep" || kind === "company-brief" ? [] : [[{ text: "🔁 Another version", data: `x:${CODE_OF[kind]}:${id}` }]];
    await send(msg, [...again, [{ text: "📋 Job menu", data: `j:${id}` }]]);
  } });
  const pdfName = (j: JobState) => `${(d.candidateName ?? "My").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40)}_CV_${(j.company ?? "job").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40)}.pdf`;

  // ---- the menu ----
  async function showMenu(text: string) { await d.tg.sendMenu(d.chatId, text, MENU_ROWS); }
  async function myJobs() {
    const jobs = (await pl.listJobs()).slice(0, 8);
    if (!jobs.length) return void (await send("No jobs yet. Tap 📝 New job to start."));
    await send("📂 Your recent jobs. Tap one to open it:", jobs.map((j) => [{ text: cut(`${ICON[j.status] ?? "•"} ${title(j)}${j.fit !== undefined ? ` (${j.fit}%)` : ""}`, 60), data: `j:${j.id}` }]));
  }
  async function status() {
    const jobs = (await pl.listJobs()).slice(0, 3);
    const lines = [`${paused() ? "⏸️ Paused" : current ? `⚙️ Working: ${current.label}` : "✅ Idle, ready"}${queue.length ? ` · ${queue.length} queued` : ""}`];
    if (jobs.length) lines.push("", "Latest:", ...jobs.map((j) => `${ICON[j.status] ?? "•"} ${title(j)}: ${j.status.replace("_", " ")}`));
    await send(lines.join("\n"), [[paused() ? { text: "▶️ Resume", data: "z:resume" } : { text: "⏸️ Pause", data: "z:pause" }]]);
  }
  async function jobCard(j: JobState) {
    const a = hasFile(j, "analysis.json") ? await readFile(path.join(j.dir, "analysis.json"), "utf8").then(JSON.parse).catch(() => null) : null;
    const head = `${ICON[j.status] ?? "•"} ${title(j)}\n${a ? `${String(a.verdict ?? "").replace("_", " ")}, ${a.fit_percent ?? "?"}% · ` : ""}${j.status.replace("_", " ")} · ${j.created.slice(0, 10)}${j.url ? `\n${j.url}` : ""}`;
    await send(head, jobButtons(j, !!a));
  }

  // ---- incoming messages: menu labels, or the ad right after "New job" ----
  let awaitingUntil = 0;
  let lastNudge = 0;
  let pending: { parts: string[]; timer: ReturnType<typeof setTimeout> } | null = null;
  const flush = async () => { const p = pending; pending = null; if (p) await takeAd(p.parts.join("\n")).catch((e) => log(`message failed: ${(e as Error).message}`)); };
  const cancelBtn: Button[][] = [[{ text: "✖️ Cancel", data: "c:new" }]];

  async function onMessage(m: any) {
    const raw = String(m.text ?? "").trim();
    if (raw === "/start" || raw === "/help") return showMenu(WELCOME);
    if (raw === MENU.newJob) {
      awaitingUntil = now() + AWAIT_MS;
      if (pending) { clearTimeout(pending.timer); pending = null; }
      return void (await send("📝 Paste the job description, or a link to the job page.", cancelBtn));
    }
    if (raw === MENU.myJobs) return myJobs();
    if (raw === MENU.radar) return void (await send(radarMessage(await radarFromJobs(await pl.listJobs()))));
    if (raw === MENU.status) return status();
    // Anything else counts only as the ad that follows "New job". A long paste may arrive in several parts.
    if (pending) { clearTimeout(pending.timer); pending.parts.push(raw); pending.timer = setTimeout(() => void flush(), SPLIT_WAIT_MS); return; }
    if (awaitingUntil > now()) {
      if (!raw) return void (await send("I need text: paste the job description or a link.", cancelBtn));
      if (raw.length >= SPLIT_MIN_CHARS) { pending = { parts: [raw], timer: setTimeout(() => void flush(), SPLIT_WAIT_MS) }; return; }
      return takeAd(raw);
    }
    // Not after "New job": nothing runs. A short reminder, at most every 30 seconds.
    if (now() - lastNudge > 30_000) { lastNudge = now(); await showMenu("Use the buttons below 👇 To send a job, tap 📝 New job first."); }
  }

  async function takeAd(text: string) {
    const url = firstUrl(text);
    if (url && text.replace(url, "").trim().length < MIN_AD_CHARS) {
      let ad;
      try { ad = await (d.fetchAd ?? fetchJobAd)(url); }
      catch (e) { awaitingUntil = now() + AWAIT_MS; return void (await send(`🔗 I can't open that link: ${oneLine((e as Error).message, 160)}. Paste the job text instead.`, cancelBtn)); }
      awaitingUntil = 0;
      if (await refuseIfFull()) return;
      return void (await enqueue(analyseTask(await pl.createJob(ad.text, "link", ad.url))));
    }
    if (text.length < MIN_AD_CHARS) { awaitingUntil = now() + AWAIT_MS; return void (await send(`That's too short for a job description (I need ${MIN_AD_CHARS}+ characters). Paste the whole ad or a link.`, cancelBtn)); }
    awaitingUntil = 0;
    if (await refuseIfFull()) return;
    await enqueue(analyseTask(await pl.createJob(text, "text")));
  }

  // ---- button presses ----
  async function onButton(q: any) {
    const [op, a, b] = String(q.data ?? "").split(":");
    if (op === "c" && a === "new") { awaitingUntil = 0; if (pending) { clearTimeout(pending.timer); pending = null; } await d.tg.clearButtons(d.chatId, q.message?.message_id); await d.tg.answer(q.id, "Cancelled"); return; }
    if (op === "z" && (a === "pause" || a === "resume")) {
      if (a === "pause") { await mkdir(stateDir, { recursive: true }); await writeFile(path.join(stateDir, "PAUSED"), new Date().toISOString()); }
      else await rm(path.join(stateDir, "PAUSED"), { force: true });
      await d.tg.clearButtons(d.chatId, q.message?.message_id);
      await d.tg.answer(q.id, a === "pause" ? "Paused" : "Resumed");
      await send(a === "pause" ? "⏸️ Paused. I'll finish what I'm doing, then wait." : `▶️ Resumed.${queue.length ? ` Starting ${queue.length} queued task${queue.length === 1 ? "" : "s"}.` : ""}`);
      if (a === "resume") void pump();
      return;
    }
    const id = op === "x" || op === "l" ? b : a;
    if (!/^[0-9a-f]{8}$/.test(id ?? "")) { await d.tg.answer(q.id, "That button has expired."); return; }
    const job = await findJob(id);
    if (!job) { await d.tg.answer(q.id, "That job no longer exists."); return; }
    const st = job.status;
    const already = () => d.tg.answer(q.id, `It's ${st.replace("_", " ")} already. Opening its menu.`).then(() => jobCard(job));
    const analysed = hasFile(job, "analysis.json");
    switch (op) {
      case "j": await d.tg.answer(q.id); return jobCard(job);
      case "b": if (!["analysed", "needs_input", "skipped"].includes(st)) return already(); await d.tg.clearButtons(d.chatId, q.message?.message_id); await d.tg.answer(q.id, "Building…"); return enqueue(buildTask(id));
      case "a": if (!["analysed", "needs_input", "skipped", "failed"].includes(st)) return already(); await d.tg.clearButtons(d.chatId, q.message?.message_id); await d.tg.answer(q.id, "Building…"); return enqueue(buildTask(id, true));
      case "s": if (!["analysed", "needs_input"].includes(st)) return already(); await d.tg.clearButtons(d.chatId, q.message?.message_id); await pl.skip(job); await d.tg.answer(q.id, "Skipped"); { const s2 = await findJob(id); return void (await send(`⏭️ Skipped ${title(job)}. Logged. The extras are still here if you want them:`, s2 ? jobButtons(s2, analysed) : undefined)); }
      case "r": if (!["failed", "needs_input", "paused", "interrupted"].includes(st)) return already(); await d.tg.clearButtons(d.chatId, q.message?.message_id); await d.tg.answer(q.id, st === "paused" || st === "interrupted" ? "Resuming…" : "Trying again…"); return analysed && job.resumeAt !== "analyse" ? enqueue(buildTask(id, false, undefined, st === "needs_input")) : enqueue(analyseTask(job));
      case "l": if (st !== "needs_input" || job.needs !== "layout" || !["s", "a"].includes(a)) return already(); await d.tg.clearButtons(d.chatId, q.message?.message_id); await d.tg.answer(q.id, "Building…"); return enqueue(buildTask(id, false, a === "s" ? "shorter" : "anyway"));
      case "x": if (!EXTRA_CODE[a]) break; if (!analysed) { await d.tg.answer(q.id, "This job hasn't been analysed yet."); return; } await d.tg.answer(q.id, "On it"); return enqueue(extraTask(id, EXTRA_CODE[a]));
      case "g": if (!analysed) { await d.tg.answer(q.id, "This job hasn't been analysed yet."); return; } await d.tg.answer(q.id); return void (await send(gapsMessage(job, JSON.parse(await readFile(path.join(job.dir, "analysis.json"), "utf8"))), [[{ text: "📋 Job menu", data: `j:${id}` }]]));
      case "p": if (st !== "built" || !hasFile(job, "cv.pdf")) { await d.tg.answer(q.id, "There's no CV for this job yet."); return; } await d.tg.answer(q.id, "Sending…"); return d.tg.sendDocument(d.chatId, path.join(job.dir, "cv.pdf"), pdfName(job), "📎 Your CV", jobButtons(job, analysed));
    }
    await d.tg.answer(q.id, "Unknown button.");
  }

  // Someone else wrote to the bot. Nothing they send is ever acted on or answered. It is logged (what kind of update,
  // the first 100 characters, cleaned), and the user is told once per stranger account, so repeats cannot spam him.
  async function stranger(u: any, chat: unknown, from: unknown) {
    const m = u.message, q = u.callback_query;
    const who = m?.from ?? q?.from ?? {};
    const name = oneLine([who.first_name, who.last_name].filter(Boolean).join(" "), 40) || "no name";
    const handle = typeof who.username === "string" && /^[A-Za-z0-9_]{3,40}$/.test(who.username) ? `@${who.username}` : "no username";
    const kind = q ? "button press" : m?.text !== undefined ? "message" : m ? "non-text message (photo, file, sticker…)" : "other update";
    const preview = oneLine(q ? q.data : m?.text ?? m?.caption ?? "", 100);
    log(`ignored a ${kind} from a stranger (chat ${chat}, user ${from}, ${name}, ${handle})${preview ? `: "${preview}"` : ""}`);
    const file = path.join(stateDir, "strangers.json");
    const seen: Record<string, string> = await readFile(file, "utf8").then(JSON.parse).catch(() => ({}));
    const key = String(from ?? chat);
    if (seen[key]) return;
    const today = new Date().toISOString().slice(0, 10);
    const alertedToday = Object.entries(seen).filter(([k, v]) => !k.startsWith("_") && v.startsWith(today)).length;
    seen[key] = new Date().toISOString();
    if (alertedToday >= STRANGER_ALERTS_PER_DAY) {
      await writeFile(file, JSON.stringify(seen, null, 2), { mode: 0o600 });
      if (seen._capNotice !== today) { seen._capNotice = today; await writeFile(file, JSON.stringify(seen, null, 2), { mode: 0o600 }); await send(`🚫 More strangers are writing to your bot today. All ignored; I'll stop alerting until tomorrow. Details: bot/state/bot.log.`); }
      return;
    }
    await mkdir(stateDir, { recursive: true });
    await writeFile(file, JSON.stringify(seen, null, 2), { mode: 0o600 });
    await send(`🚫 Someone else wrote to your bot: ${name}, ${handle} (account ending ${key.slice(-4)}). They sent a ${kind}${preview ? `: "${preview}"` : ""}.\nIgnored: nothing ran and they got no reply. I'll only tell you once about this account; later attempts go to the log.`);
  }

  // Only the user's paired private chat is obeyed (rule 1). Everything else is ignored and logged.
  async function handle(u: any) {
    const m = u.message, q = u.callback_query;
    const chat = m?.chat?.id ?? q?.message?.chat?.id;
    const from = m?.from?.id ?? q?.from?.id;
    if (chat !== d.chatId || (d.userId !== undefined && from !== d.userId)) {
      if (q) await d.tg.answer(q.id);
      await stranger(u, chat, from).catch((e) => log(`could not record a stranger: ${(e as Error).message}`));
      return;
    }
    if (q) return onButton(q);
    if (m) return onMessage(m);
  }
  return { handle, queueLength: () => queue.length, busy: () => !!current, awaiting: () => awaitingUntil > now(), idle: async () => { while (pending || current || (queue.length && !paused())) await new Promise((r) => setTimeout(r, 20)); } };
}

// ---- main loop ----
// The Telegram channel is wired into the app in the product build (phase 8). It receives the pipeline and its settings; it builds nothing itself.
export async function startGateway(pl: Pipeline, cfg: { radarDay: string; radarTime: string }, candidateName?: string) {
  await mkdir(STATE, { recursive: true });
  const pairing = JSON.parse(await readFile(path.join(STATE, "telegram.json"), "utf8"));
  if (typeof pairing.chat_id !== "number") throw new Error("state/telegram.json has no chat_id");
  const tg = createTelegram(await readBotToken());
  const bot = createBot({ tg, chatId: pairing.chat_id, userId: pairing.user_id ?? undefined, pipeline: pl, candidateName });
  log(`CV bot started (pid ${process.pid})`);

  // Jobs left half-done by a restart: they become "interrupted" (finished steps kept), and the user is told once, with Resume. Nothing resumes by itself.
  for (const j of await pl.recoverInterrupted()) {
    await tg.send(pairing.chat_id, `⚠️ I was restarted while ${j.resumeAt === "build" ? "building" : "analysing"} ${j.role ?? "a job"}${j.company ? " at " + j.company : ""}.`, [[{ text: "▶️ Resume", data: `r:${j.id}` }]]).catch(() => {});
  }

  let offset = Number(pairing.offset ?? 0);
  if (!offset) {
    // First start: anything waiting in Telegram is from the old system. Skip it once instead of acting on it.
    const old = await tg.getUpdates(-1, 0).catch(() => [] as any[]);
    if (old.length) { offset = old[old.length - 1].update_id + 1; log(`first start: skipped old Telegram updates up to ${offset - 1}`); }
    await writeFile(path.join(STATE, "telegram.json"), JSON.stringify({ ...pairing, offset }, null, 2), { mode: 0o600 });
  }
  if (pairing.menu !== 1) {
    await tg.sendMenu(pairing.chat_id, `🆕 The bot now works with buttons only.\n\n${WELCOME}`, MENU_ROWS).catch((e) => log(`could not send the menu: ${(e as Error).message}`));
    pairing.menu = 1;
    await writeFile(path.join(STATE, "telegram.json"), JSON.stringify({ ...pairing, offset }, null, 2), { mode: 0o600 });
  }
  let lastRadar = String(pairing.last_radar ?? "");
  let failStreak = 0; // sleep cuts Telegram's long poll all the time; only a lasting run of failures is worth a log line
  for (;;) {
    try {
      const now = new Date();
      const day = now.toLocaleDateString("en-GB", { weekday: "short" }), hm = now.toTimeString().slice(0, 5), today = now.toISOString().slice(0, 10);
      if (day === cfg.radarDay && hm >= cfg.radarTime && lastRadar !== today) {
        lastRadar = today;
        const r = await radarFromJobs(await pl.listJobs());
        if (r.topGaps.some((g) => g.n >= 2)) await tg.send(pairing.chat_id, radarMessage(r)); // nothing repeats yet = nothing worth a Monday message
        await writeFile(path.join(STATE, "telegram.json"), JSON.stringify({ ...pairing, offset, last_radar: lastRadar }, null, 2), { mode: 0o600 });
      }
      const updates = await tg.getUpdates(offset, 50);
      if (failStreak >= 5) log(`Telegram reachable again after ${failStreak} failed polls`);
      failStreak = 0;
      for (const u of updates) {
        offset = Math.max(offset, u.update_id + 1);
        await writeFile(path.join(STATE, "telegram.json"), JSON.stringify({ ...pairing, offset, last_radar: lastRadar }, null, 2), { mode: 0o600 });
        await bot.handle(u).catch((e) => log(`update failed: ${(e as Error).message}`));
      }
    } catch (e) {
      failStreak++;
      const msg = (e as Error).message, routine = /aborted due to timeout|fetch failed/.test(msg);
      if (!routine || failStreak === 5) log(`poll problem${routine ? ` (${failStreak} in a row)` : ""}: ${msg}`);
      await new Promise((r) => setTimeout(r, routine ? 2_000 : 10_000));
    }
  }
}

// (No auto-start: the gateway needs a pipeline, which the app builds. See startGateway.)
