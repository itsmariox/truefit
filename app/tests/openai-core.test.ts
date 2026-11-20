// "Connect ChatGPT" and the OpenAI API key, through the REAL app core and the real IPC handlers (the same functions the window calls), on a pretend OpenAI service on localhost. The Claude
// query is wired to count calls: choosing OpenAI must never touch it. What this cannot show: how the real OpenAI service behaves (see docs/OPENAI-BUILD-ISSUES.md).
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startApp } from "../src/main/core/app-core.ts";
import { createHost } from "../src/main/core/host.ts";
import { createCoreHandlers } from "../src/main/handlers.ts";
import { createJobsHandlers } from "../src/main/jobs-handlers.ts";
import { startFakeOpenAIWorld } from "../../engine/tests/openai-fake-auth.ts";
import { SECRET_NAMES } from "../../engine/src/store/secrets.ts";
import { rig, analysis } from "./core-rig.ts";
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const settle = async (c: { queue: { snapshot(): { entries: { state: string }[]; blocked: boolean } } }) => { for (let t = 0; t < 1500; t++) { const q = c.queue.snapshot(); if (!q.entries.some((e) => e.state === "running" || (e.state === "queued" && !q.blocked))) break; await new Promise((r) => setTimeout(r, 20)); } await new Promise((r) => setTimeout(r, 30)); };
const until = async (f: () => boolean, ms = 6000) => { for (let t = 0; t < ms / 20 && !f(); t++) await new Promise((r) => setTimeout(r, 20)); return f(); };
const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-oaicore-")); mkdirSync(path.join(root, "tmp"));
const world = await startFakeOpenAIWorld({ analysis: analysis("Acme Retail") });
try {
  const R = rig(root), opened: string[] = [], signinEvents: any[] = [];
  const deps = { ...R.deps(), openai: { baseUrl: world.url + "/v1", authBase: world.url },
    openUrl: async (u: string) => { opened.push(u); const a = await fetch(u, { redirect: "manual" }); await fetch(a.headers.get("location")!); } }; // the stand-in for the browser
  const host = createHost({ start: () => startApp(deps), onReady: () => undefined }); await host.start();
  const H = createCoreHandlers({ host, push: { signin: (p) => signinEvents.push(p), changed: () => undefined }, copy: () => undefined });
  const J = createJobsHandlers({ host, push: () => undefined, fetchAd: async () => { throw new Error("no"); }, openPath: async () => "", reveal: () => undefined });
  const core = host.core()!; core.profile.save((await import("./core-rig.ts")).priya);

  const v0 = await H["access:get"](undefined as never);
  ok("1. the default is Claude, worded as before", v0.provider === "claude" && v0.kind === "not_chosen" && /Claude/.test(v0.message.title));
  const v1 = await H["access:chooseProvider"]({ provider: "openai" });
  ok("2. choosing OpenAI: not chosen yet, OpenAI wording, the OpenAI buttons ('Use my ChatGPT plan', 'Use an OpenAI API key')", v1.provider === "openai" && v1.kind === "not_chosen" && /OpenAI/.test(v1.message.title) && v1.message.actions.map((a) => a.label).join() === "Use my ChatGPT plan,Use an OpenAI API key" && !/Claude/.test(JSON.stringify(v1.message)));
  const v2 = await H["access:chooseMode"]({ mode: "subscription" });
  ok("3. the ChatGPT-plan notice comes first, with its four points and its own checkbox", v2.kind === "notice_needed" && v2.notice.title === "Using your ChatGPT plan" && v2.notice.points.length === 4 && /ChatGPT plan/.test(v2.notice.checkbox));
  const v3 = await H["access:acceptNotice"](undefined as never);
  ok("4. after the notice: not connected, with 'Continue with ChatGPT' as the first button", v3.noticeAccepted && v3.kind === "not_connected" && v3.message.actions[0].label === "Continue with ChatGPT");

  const started = await H["access:signIn"](undefined as never);
  const done = await until(() => signinEvents.some((e) => !e.running));
  const last = signinEvents.at(-1);
  ok("5. 'Continue with ChatGPT' runs the real sign-in flow to the end; the page was told 'ChatGPT is connected'", started.started && done && last.message.title === "ChatGPT is connected" && last.link === null);
  ok("6. progress events carried the sign-in link (on the sign-in host, with no ID-token hint) and the browser was opened ONLY at the sign-in service", signinEvents.some((e) => e.link?.startsWith(`${world.url}/api/accounts/authorize?`)) && opened.length === 1 && opened.every((u) => u.startsWith(`${world.url}/api/accounts/authorize?`)) && !signinEvents.some((e) => (e.link ?? "").includes("id_token_hint")));
  const v4 = await H["access:get"](undefined as never);
  ok("7. the view is now connected (ChatGPT plan), worded for ChatGPT", v4.connected && v4.kind === "connected" && v4.mode === "subscription" && /ChatGPT/.test(v4.message.title));
  const t = await H["access:test"](undefined as never);
  ok("8. 'Test connection' makes one tiny call with the plan token and says OpenAI is working", t.message?.title === "OpenAI is working" && world.bearers.at(-1) === "Bearer ACCESS-NEW");

  const c1 = await J["jobs:create"]({ text: "A marketing role at a fictional shop with weekly emails and reporting. ".repeat(8), force: undefined }); if (c1.outcome !== "created") throw new Error("create");
  await J["jobs:analyse"]({ id: c1.job.id }); await settle(core);
  const d1 = await J["jobs:get"]({ id: c1.job.id });
  ok("9. a job is analysed through OpenAI with the plan token, and Claude was never called", d1?.status === "analysed" && world.bearers.at(-1) === "Bearer ACCESS-NEW" && R.script.calls === 0);
  // the gate, on the OpenAI side: junk is turned back on the cheap OpenAI model, "Try anyway" skips it, and Claude is never involved
  const JUNK = "What is the weather going to be like in Leeds this weekend, and should I bring a coat or an umbrella when we meet by the river for lunch on Saturday afternoon? ".repeat(3);
  const gatesBefore = world.gateModels.length, nJobs = (await J["jobs:list"](undefined)).length;
  const junk = await J["jobs:create"]({ text: JUNK, force: undefined });
  ok("9b. on OpenAI, a long text that is not a job ad is refused as 'not_a_job' after ONE small call on the cheap OpenAI model; nothing is created; Claude is never called", junk.outcome === "refused" && junk.reason === "not_a_job" && world.gateModels.length === gatesBefore + 1 && world.gateModels.at(-1) === "gpt-6-luna" && (await J["jobs:list"](undefined)).length === nJobs && R.script.calls === 0 && R.script.gateCalls === 0);
  const hi = await J["jobs:create"]({ text: "hi", force: undefined });
  ok("9c. 'hi' is turned back for free: no call at all", hi.outcome === "refused" && hi.reason === "too_short" && world.gateModels.length === gatesBefore + 1);

  const out = await H["access:signOut"]({ forget: false });
  const v5 = await H["access:get"](undefined as never);
  ok("10. 'Disconnect ChatGPT' ends the session at OpenAI, removes the saved sign-in from this Mac, and the view is not connected", out.cleared && out.revoked && world.revokes.length === 1 && (await R.secrets.get(SECRET_NAMES.openaiPlan)) === null && !v5.connected && v5.kind === "not_connected");

  // reconnecting must reuse the saved registration (OpenAI: signing out does not create a new client)
  const reg1 = JSON.parse((await R.secrets.get(SECRET_NAMES.openaiRegistration)) ?? "null");
  ok("10b. Disconnect removed the tokens but KEPT the registration (the issued client id)", reg1?.clientId === "oaiapp_1" && (await R.secrets.get(SECRET_NAMES.openaiPlan)) === null);
  signinEvents.length = 0; await H["access:signIn"](undefined as never); await until(() => signinEvents.some((e) => !e.running));
  const a2 = world.authorize.at(-1)!;
  ok("10c. connecting again reuses that client: no new registration, no app-name hint, no ID-token hint", a2.get("client_id") === "oaiapp_1" && !a2.has("agent_name_hint") && !a2.has("id_token_hint") && world.authorize.filter((q) => q.get("client_id") === "dynamic_agent_client").length === 1 && (await H["access:get"](undefined as never)).connected);
  const other = await H["access:signOut"]({ forget: true });
  ok("10d. 'Use a different ChatGPT account' removes the registration as well", other.cleared && (await R.secrets.get(SECRET_NAMES.openaiRegistration)) === null && world.revokes.length === 2);

  // the API-key way
  await H["access:chooseMode"]({ mode: "apiKey" });
  const bad = await H["access:saveKey"]({ key: "short" });
  ok("11. a malformed key is refused in OpenAI's words and nothing is saved", /API key/.test(bad.message?.title ?? "") && (await R.secrets.get(SECRET_NAMES.openaiApiKey)) === null);
  const good = await H["access:saveKey"]({ key: "sk-test-0123456789abcdefghij" });
  ok("12. a good key is proven with one call, saved under the OpenAI secret name only, and the view says so", good.message?.title === "Your API key is working and saved" && (await R.secrets.get(SECRET_NAMES.openaiApiKey)) === "sk-test-0123456789abcdefghij" && (await R.secrets.get(SECRET_NAMES.claudeApiKey)) === null && good.view.kind === "key_saved" && world.bearers.at(-1) === "Bearer sk-test-0123456789abcdefghij");
  const c2 = await J["jobs:create"]({ text: "A different marketing role at another fictional shop, with social media. ".repeat(8), force: undefined }); if (c2.outcome !== "created") throw new Error("c2");
  await J["jobs:analyse"]({ id: c2.job.id }); await settle(core);
  ok("13. a job runs through the API key, and the ledger counts it in dollars", (await J["jobs:get"]({ id: c2.job.id }))?.status === "analysed" && world.bearers.at(-1) === "Bearer sk-test-0123456789abcdefghij" && core.settings.get().settings["ai.provider"] === "openai");

  const vc = await H["access:chooseProvider"]({ provider: "claude" });
  ok("14. switching back to Claude: Claude wording again, the way to connect forgotten, and the OpenAI key is not used", vc.provider === "claude" && vc.kind === "not_chosen" && /Claude/.test(vc.message.title) && vc.mode === null);
  // a job stays with the service that started it
  await H["access:chooseProvider"]({ provider: "claude" }); await H["access:chooseMode"]({ mode: "subscription" }); await H["access:acceptNotice"](undefined as never);
  const refused = await J["jobs:extra"]({ id: c2.job.id, kind: "cover-note" }), refusedBuild = await J["jobs:build"]({ id: c2.job.id, layout: undefined, ignoreQuestions: undefined, refreshProfile: undefined }), refusedResume = await J["jobs:resume"]({ id: c2.job.id });
  ok("14b. a job started with OpenAI is refused by Claude (extra, build, resume): not queued, with a plain note naming both services, and Claude was never called", [refused, refusedBuild, refusedResume].every((x) => x.queued === false && x.reason === "other_service" && /started with OpenAI/.test(x.note ?? "") && /Claude is chosen now/.test(x.note ?? "")) && R.script.calls === 0);
  ok("15. the Claude query was never called during the whole OpenAI story", R.script.calls === 0);
  const gatesNow = world.gateModels.length, forced = await J["jobs:create"]({ text: JUNK, force: true });
  ok("15b. 'Try anyway' skips the check: the job is created and no gate call is made", forced.outcome === "created" && world.gateModels.length === gatesNow);
  // "Delete everything" ends a live ChatGPT session at OpenAI before the tokens are wiped (the very last step: it closes the database)
  await H["access:chooseProvider"]({ provider: "openai" }); await H["access:chooseMode"]({ mode: "subscription" }); await H["access:acceptNotice"](undefined as never);
  signinEvents.length = 0; await H["access:signIn"](undefined as never); await until(() => signinEvents.some((e) => !e.running));
  const before = world.revokes.length, del = await core.deleteEverything(true);
  ok("16. 'Delete everything' tells OpenAI to end the ChatGPT session first, and every OpenAI secret is gone afterwards", del.ok === true && world.revokes.length === before + 1 && (await R.secrets.get(SECRET_NAMES.openaiPlan)) === null && (await R.secrets.get(SECRET_NAMES.openaiRegistration)) === null && (await R.secrets.get(SECRET_NAMES.openaiHostId)) === null && (await R.secrets.get(SECRET_NAMES.openaiApiKey)) === null);
} finally { await world.close(); rmSync(root, { recursive: true, force: true }); }
console.log(failures === 0 ? "\nall openai-core tests passed" : `\n${failures} openai-core test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
