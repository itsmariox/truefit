// Gateway tests (buttons only): a fake Telegram and a fake pipeline. Who is obeyed, the menu, "New job" as the only
// way text is taken, the job menus at every stage, Gaps and Send PDF again, the queue, pause/resume, links.
// No network, no AI, no Docker.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const { createBot, MENU, firstUrl, gapsMessage, jobButtons } = await import("../src/gateway.ts");

let failures = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (!cond) failures++; console.log((cond ? "PASS " : "FAIL ") + name + (cond || !detail ? "" : `  [${detail}]`)); };

const CHAT = 4242, USER = 77;
const sent: { text: string; buttons?: { text: string; data: string }[][] }[] = [];
const menus: string[] = [];
const docs: string[] = [];
const answers: string[] = [];
const tg = {
  send: async (_c: number, text: string, buttons?: any) => { sent.push({ text, buttons }); return 1; },
  sendMenu: async (_c: number, text: string) => { menus.push(text); },
  sendDocument: async (_c: number, file: string, name: string, _cap: string, buttons?: any) => { docs.push(`${file}|${name}`); sent.push({ text: "(document)", buttons }); },
  answer: async (_id: string, text?: string) => { answers.push(text ?? ""); },
  clearButtons: async () => {}, typing: async () => {},
};
type J = { id: string; dir: string; status: string; created: string; company?: string; role?: string; fit?: number };
const root = mkdtempSync(path.join(tmpdir(), "cvbot-gwjobs-"));
const jobs: J[] = [];
const calls: string[] = [];
let gate: Promise<void> | null = null;
const analysis = { verdict: "long_shot", fit_percent: 55, gaps: [{ gap: "Kubernetes", handle: "say you haven't run it in production" }], constraint_checks: [{ rule: "salary", status: "unclear", note: "not stated" }], unverified_needed: ["Docker"] };
const pipeline = {
  createJob: async (text: string, source: string, url?: string) => {
    const id = (0xaaaaaaa0 + jobs.length).toString(16);
    const dir = path.join(root, id); mkdirSync(dir);
    const j: J = { id, dir, status: "analysing", created: new Date(Date.now() + jobs.length).toISOString() };
    jobs.unshift(j); calls.push(`create:${source}:${url ?? text.length}`); return j as any;
  },
  analyse: async (j: J) => { if (gate) await gate; calls.push(`analyse:${j.id}`); writeFileSync(path.join(j.dir, "analysis.json"), JSON.stringify(analysis)); Object.assign(j, { status: "analysed", company: "Acme", role: "AI Ops", fit: 55 }); return { job: j, message: "Long shot, 55%" } as any; },
  build: async (j: J, o: any) => { calls.push(`build:${j.id}:${!!o?.ignoreQuestions}`); j.status = "built"; writeFileSync(path.join(j.dir, "cv.pdf"), "%PDF"); return { job: j, status: "built", message: "📎 CV ready", pdf: path.join(j.dir, "cv.pdf") } as any; },
  extra: async (j: J, kind: string) => { calls.push(`extra:${j.id}:${kind}`); return `the ${kind}`; },
  skip: async (j: J) => { calls.push(`skip:${j.id}`); j.status = "skipped"; return j as any; },
  listJobs: async () => jobs as any,
};
const fetchAd = async (url: string) => { if (url.includes("linkedin")) throw new Error("that page needs a login"); return { url, text: "fetched ad ".repeat(60) }; };
let clock = 1_000_000;
const bot = createBot({ tg: tg as any, chatId: CHAT, userId: USER, pipeline: pipeline as any, candidateName: "Priya Nair", fetchAd: fetchAd as any, stateDir: mkdtempSync(path.join(tmpdir(), "cvbot-gw-")), now: () => clock });
const msg = (text: string, chat = CHAT, user = USER) => bot.handle({ message: { chat: { id: chat }, from: { id: user }, text } });
const press = (data: string, chat = CHAT, user = USER) => bot.handle({ callback_query: { id: "q", data, from: { id: user }, message: { chat: { id: chat }, message_id: 9 } } });
const last = () => sent[sent.length - 1];
const datas = (b?: { data: string }[][]) => (b ?? []).flat().map((x) => x.data);
const AD = "We are hiring an AI operations person. ".repeat(12);

// ---- strangers ----
await msg(AD, 999, USER); await msg(MENU.newJob, CHAT, 555); await press("b:aaaaaaa0", 999);
ok("strangers trigger nothing (not even the menu)", calls.length === 0 && menus.length === 0 && answers.length === 1);
sent.length = 0; answers.length = 0;

// ---- the menu, and text outside "New job" ----
await msg("/start");
ok("/start shows the pinned menu with the welcome", menus.length === 1 && /New job/.test(menus[0]));
await msg(AD);
ok("a pasted ad WITHOUT tapping New job runs nothing; the owner is pointed to the buttons", calls.length === 0 && menus.length === 2 && /tap 📝 New job first/.test(menus[1]));
await msg("write me a cover letter"); await msg("/status"); await msg("prep me for this one");
ok("free text and old commands run nothing, and the reminder is not repeated within 30 s", calls.length === 0 && menus.length === 2 && sent.length === 0);
clock += 31_000; await msg("hello?");
ok("after 30 s the reminder can come again", menus.length === 3);

// ---- New job -> paste -> analysis with the full job menu ----
await msg(MENU.newJob);
ok("New job asks for the ad, with Cancel", /Paste the job description/.test(last().text) && datas(last().buttons).join() === "c:new" && bot.awaiting());
await msg("too short");
ok("a too-short paste is refused and New job stays open", /too short/.test(last().text) && bot.awaiting() && calls.length === 0);
await msg(AD); await bot.idle();
const j1 = jobs[0];
ok("the ad after New job is analysed", calls.join() === `create:text:${AD.trim().length},analyse:${j1.id}` && !bot.awaiting());
ok("the verdict comes with Build/Skip AND every extra AND Gaps", last().text === "Long shot, 55%" && datas(last().buttons).join() === `b:${j1.id},s:${j1.id},x:m:${j1.id},x:c:${j1.id},x:i:${j1.id},x:b:${j1.id},g:${j1.id}`);
await msg(AD);
ok("a second paste without tapping New job again runs nothing", calls.length === 2);

// ---- extras before building ----
await press(`x:m:${j1.id}`); await bot.idle();
ok("an extra works straight after the analysis (no Build needed)", calls[calls.length - 1] === `extra:${j1.id}:recruiter-message` && last().text === "the recruiter-message" && datas(last().buttons).includes(`j:${j1.id}`));
await press(`g:${j1.id}`);
ok("Gaps is plain code from the saved analysis", /Kubernetes: say you haven't run it/.test(last().text) && /Docker/.test(last().text) && calls.length === 3);

// ---- build ----
await press(`b:${j1.id}`); await press(`b:${j1.id}`); await bot.idle();
ok("Build builds once, even when double-pressed", calls.filter((c) => c.startsWith("build:")).length === 1 && docs[0].endsWith("|Priya_Nair_CV_Acme.pdf"));
ok("the PDF comes with Send PDF again and every extra", datas(last().buttons).join() === `p:${j1.id},x:m:${j1.id},x:c:${j1.id},x:i:${j1.id},x:b:${j1.id},g:${j1.id}`);
await press(`p:${j1.id}`);
ok("Send PDF again re-sends the CV without any AI", docs.length === 2 && calls.filter((c) => c.startsWith("build:")).length === 1);
await press(`s:${j1.id}`);
ok("Skip on a built job is refused and its menu shown instead", !calls.some((c) => c.startsWith("skip:")) && /built already/.test(answers[answers.length - 1]));

// ---- My jobs: any earlier job, any time ----
await msg(MENU.newJob); await msg(AD + " second"); await bot.idle();
const j2 = jobs[0];
await press(`s:${j2.id}`);
ok("Skip records the skip and still offers Build anyway and the extras", calls.includes(`skip:${j2.id}`) && datas(last().buttons)[0] === `b:${j2.id}` && datas(last().buttons).includes(`x:i:${j2.id}`));
await msg(MENU.myJobs);
ok("My jobs lists recent jobs as buttons", datas(last().buttons).join() === `j:${j2.id},j:${j1.id}` && /⏭️/.test(last().buttons![0][0].text) && /✅/.test(last().buttons![1][0].text));
await press(`j:${j1.id}`);
ok("opening an old job shows its card and its full menu", /AI Ops · Acme/.test(last().text) && /long shot, 55%/.test(last().text) && datas(last().buttons).includes(`x:m:${j1.id}`));
await press(`x:i:${j1.id}`); await bot.idle();
ok("an extra on an old job works from its menu", calls[calls.length - 1] === `extra:${j1.id}:interview-prep`);

// ---- links ----
await msg(MENU.newJob); await msg("https://jobs.acme.com/123"); await bot.idle();
ok("a link after New job is fetched by code and analysed", calls.includes("create:link:https://jobs.acme.com/123"));
await msg(MENU.newJob); await msg("https://www.linkedin.com/jobs/view/1");
ok("a link that can't be opened asks for the text and keeps New job open", /can't open that link.*Paste the job text/s.test(last().text) && bot.awaiting());
await press("c:new");
ok("Cancel closes New job", !bot.awaiting() && answers[answers.length - 1] === "Cancelled");
ok("a URL inside a long pasted ad is treated as the ad", firstUrl(`${AD} apply at https://x.com/a`) === "https://x.com/a");

// ---- New job expires ----
await msg(MENU.newJob); clock += 11 * 60_000; const before = calls.length; await msg(AD);
ok("New job expires after 10 minutes", calls.length === before);

// ---- status, pause, resume ----
await msg(MENU.status);
ok("Status shows the state with a Pause button", /Idle, ready/.test(last().text) && datas(last().buttons).join() === "z:pause");
await press("z:pause");
await msg(MENU.newJob); await msg(AD + " third");
ok("while paused, new jobs wait and the owner is told how to resume", /Paused. Queued/.test(last().text) && /Resume/.test(last().text) && bot.queueLength() === 1);
await msg(MENU.status);
ok("Status then offers Resume", datas(last().buttons).join() === "z:resume");
await press("z:resume"); await bot.idle();
ok("Resume starts what was waiting", bot.queueLength() === 0 && calls.filter((c) => c.startsWith("analyse:")).length === 4);
await msg(MENU.radar);
ok("Gap radar answers from the button", /Gap radar/.test(last().text));

// ---- job menus by state ----
const st = (status: string) => jobButtons({ id: "abcdef12", status } as any, true).flat().map((b) => b.data.split(":")[0] + (b.data.startsWith("x") ? b.data.split(":")[1] : "")).join(",");
ok("job menu by state: analysed / built / skipped / failed / needs input / working", st("analysed") === "b,s,xm,xc,xi,xb,g" && st("built") === "p,xm,xc,xi,xb,g" && st("skipped") === "b,xm,xc,xi,xb,g" && st("failed") === "r,xm,xc,xi,xb,g" && st("needs_input") === "r,a,xm,xc,xi,xb,g" && st("building") === "j");
ok("no extras before there is an analysis", jobButtons({ id: "abcdef12", status: "failed" } as any, false).flat().length === 1);
ok("Gaps message handles a job with no gaps", /No gaps were flagged/.test(gapsMessage({ role: "X", company: "Y" } as any, { verdict: "apply", fit_percent: 80 })));

// ---- errors ----
const errBot = createBot({ tg: tg as any, chatId: CHAT, userId: USER, pipeline: { ...pipeline, analyse: async () => { const e: any = new Error("analyst failed: 401"); e.kind = "auth"; throw e; } } as any, stateDir: mkdtempSync(path.join(tmpdir(), "cvbot-gw2-")) });
await errBot.handle({ message: { chat: { id: CHAT }, from: { id: USER }, text: MENU.newJob } });
await errBot.handle({ message: { chat: { id: CHAT }, from: { id: USER }, text: AD } }); await errBot.idle();
ok("a rejected login is explained in plain words (sign in again in the app), with a button to try again", /sign in again/.test(last().text) && !/setup-token|terminal/.test(last().text) && datas(last().buttons)[0].startsWith("r:"));
await press("b:not-an-id");
ok("a malformed button is refused", /expired/.test(answers[answers.length - 1]));

console.log(failures === 0 ? "\nall gateway tests passed" : `\n${failures} gateway test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
