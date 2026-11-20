// Stress and fault tests: floods, races, oversized and hostile input, broken agent answers, a hostile web server.
// No AI, no internet (a local test web server on 127.0.0.1 only).
import { mkdtempSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const { createBot, MENU } = await import("../src/gateway.ts");
const F = await import("../src/fetchlink.ts");

let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (!cond) failures++; console.log((cond ? "PASS " : "FAIL ") + name + (cond || !detail ? "" : `  [${detail}]`)); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- a gateway with a fake Telegram and a slow fake pipeline ----------
const CHAT = 1, USER = 1;
function rig(opts: { analyseMs?: number } = {}) {
  const sent: { text: string; buttons?: any }[] = [];
  const answers: string[] = [];
  const calls: string[] = [];
  const jobs: any[] = [];
  const tg = { send: async (_c: number, text: string, buttons?: any) => { sent.push({ text, buttons }); return 1; }, sendMenu: async (_c: number, text: string) => { sent.push({ text }); }, sendDocument: async () => {}, answer: async (_i: string, t?: string) => { answers.push(t ?? ""); }, clearButtons: async () => {}, typing: async () => {} };
  const pipeline = {
    createJob: async (text: string) => { const j = { id: (0x10000000 + jobs.length).toString(16), dir: "/x", status: "analysing", created: new Date().toISOString(), text }; jobs.unshift(j); calls.push(`create:${text.length}`); return j; },
    analyse: async (j: any) => { await sleep(opts.analyseMs ?? 5); calls.push(`analyse:${j.id}`); j.status = "analysed"; j.company = "Acme"; j.role = "Ops"; return { job: j, message: "verdict" }; },
    build: async (j: any) => { await sleep(30); calls.push(`build:${j.id}`); j.status = "built"; return { job: j, status: "built", message: "done", pdf: "/x.pdf" }; },
    extra: async (j: any, k: string) => { calls.push(`extra:${k}`); return "x"; },
    skip: async (j: any) => { calls.push(`skip:${j.id}`); j.status = "skipped"; return j; },
    listJobs: async () => jobs,
  };
  const bot = createBot({ tg: tg as any, chatId: CHAT, userId: USER, pipeline: pipeline as any, stateDir: mkdtempSync(path.join(tmpdir(), "cvbot-st-")) });
  const msg = (text: string, from = USER, chat = CHAT, extra: object = {}) => bot.handle({ message: { chat: { id: chat }, from: { id: from }, text, ...extra } });
  const press = (data: string) => bot.handle({ callback_query: { id: "q", data, from: { id: USER }, message: { chat: { id: CHAT }, message_id: 1 } } });
  return { bot, sent, answers, calls, jobs, msg, press };
}

// 1. A long paste arrives from Telegram as several messages in a split second: it must become ONE job.
{
  const r = rig();
  const ad = "Responsibilities and requirements of a long job ad. ".repeat(130); // ~6,800 chars, like the Personio ad
  const parts = [ad.slice(0, 4096), ad.slice(4096)];
  await r.msg(MENU.newJob); await r.msg(parts[0]); await r.msg(parts[1]);
  await sleep(4500); await r.bot.idle();
  const creates = r.calls.filter((c) => c.startsWith("create:"));
  ok("split paste: a 6,800-character ad sent as 2 Telegram messages becomes ONE job with the whole text", creates.length === 1 && Math.abs(Number(creates[0].slice(7)) - ad.trim().length) <= 3, r.calls.join(","));
}

// 2. Double-pressing Build must start ONE build.
{
  const r = rig();
  await r.msg(MENU.newJob); await r.msg("A job ad. ".repeat(40)); await r.bot.idle();
  const id = r.jobs[0].id;
  await Promise.all([r.press(`b:${id}`), r.press(`b:${id}`), r.press(`b:${id}`)]);
  await r.bot.idle();
  ok("race: pressing Build three times fast builds once", r.calls.filter((c) => c.startsWith("build:")).length === 1, r.calls.join(","));
  await r.press(`s:${id}`);
  ok("race: Skip after Build is refused (it is already built)", !r.calls.some((c) => c.startsWith("skip:")));
}

// 3. A flood of pastes is capped, so a mistake cannot queue dozens of paid jobs.
{
  const r = rig({ analyseMs: 300 });
  for (let i = 0; i < 25; i++) { await r.msg(MENU.newJob); await r.msg(`Job ad number ${i}. `.repeat(30)); }
  const queuedOrRunning = r.calls.filter((c) => c.startsWith("create:")).length;
  ok("flood: 25 pastes in a row do not all become paid jobs (queue is capped)", queuedOrRunning <= 11, `created ${queuedOrRunning}`);
  ok("flood: the owner is told when the queue is full", r.sent.some((s) => /queue is full|too many/i.test(s.text)));
  await r.bot.idle();
}

// 4. Many different strangers: the alerts to the owner are capped per day.
{
  const r = rig();
  for (let i = 0; i < 40; i++) await r.msg("hi", 1000 + i, 1000 + i);
  const alerts = r.sent.filter((s) => /Someone else wrote/.test(s.text)).length;
  ok("stranger flood: 40 different strangers do not send the owner 40 alerts", alerts <= 5, `alerts ${alerts}`);
}

// 5. Hostile text in a paste is never echoed as formatting, and odd input does not crash the bot.
{
  const r = rig();
  await r.msg(MENU.newJob);
  await r.msg("‮​<script>alert(1)</script>".repeat(5));
  await r.msg("");
  await r.bot.handle({ message: { chat: { id: CHAT }, from: { id: USER }, photo: [{}] } });
  await r.bot.handle({ edited_message: { chat: { id: CHAT }, from: { id: USER }, text: "x" } } as any);
  await r.bot.handle({});
  ok("odd input: short hostile text, empty text, a photo, an edit and an empty update do not crash or start jobs", r.calls.length === 0);
}

// (The broken-agent tests moved to pipeline.test.ts at the step 7b cutover: an empty or invalid analysis, an empty Coach message, hostile company and role names, garbage Writer selections.)

// ---------- a hostile web server for links ----------
const server = http.createServer((req, res) => {
  if (req.url === "/loop") { res.writeHead(302, { location: "/loop" }); return res.end(); }
  if (req.url === "/slow") { setTimeout(() => res.end("late"), 20_000); return; }
  if (req.url === "/huge") { res.writeHead(200, { "content-type": "text/html" }); const chunk = "<p>" + "x".repeat(65_000) + "</p>"; let n = 0; const go = () => { while (n < 200) { n++; if (!res.write(chunk)) return res.once("drain", go); } res.end(); }; return go(); }
  res.writeHead(200, { "content-type": "text/html" }); res.end("<p>" + "A normal job ad. ".repeat(60) + "</p>");
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as any).port;
const localOk = (async () => [{ address: "93.184.216.34", family: 4 }]) as never; // pretend the host is public, so only the server's behaviour is tested
const viaLocal: typeof fetch = (u, init) => fetch(String(u).replace(/^https?:\/\/[^/]+/, `http://127.0.0.1:${port}`), init);
const t0 = Date.now();
const loop = await F.fetchJobAd("https://jobs.example.com/loop", { fetch: viaLocal, resolve: localOk }).then(() => "ok", (e) => e.message);
ok("links: a redirect loop stops after a few hops with a clear message", loop !== "ok" && Date.now() - t0 < 5000, loop);
const t1 = Date.now();
const slow = await F.fetchJobAd("https://jobs.example.com/slow", { fetch: viaLocal, resolve: localOk }).then(() => "ok", (e) => e.message);
ok("links: a server that never answers is given up on within ~15 s", slow !== "ok" && Date.now() - t1 < 17_000, `${Date.now() - t1}ms ${slow}`);
const memBefore = process.memoryUsage().rss;
const huge = await F.fetchJobAd("https://jobs.example.com/huge", { fetch: viaLocal, resolve: localOk }).then((r) => `ok ${r.text.length}`, (e) => e.message);
const grewMb = (process.memoryUsage().rss - memBefore) / 1e6;
ok("links: a 13 MB page is cut off at the size limit instead of being read into memory whole", grewMb < 40 && (huge.startsWith("ok") ? Number(huge.slice(3)) < 3_100_000 : /too large/.test(huge)), `${huge.slice(0, 40)} rss+${grewMb.toFixed(0)}MB`);
server.close();

console.log(failures === 0 ? "\nall stress tests passed" : `\n${failures} stress test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
