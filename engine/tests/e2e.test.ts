// End-to-end seam test (phase 1 step 7b review): the REAL pipeline composed with the REAL in-process runner (createSdkRunner), with a fake `query` standing in
// for Claude. It exercises the file names, read order, masking and prompts that pipeline.test (fake runner) and agents.test (hand-made job folders) cannot see
// meet each other. No Claude call is made. Needs a Chromium browser (the CV is really rendered and read back).
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url)), root0 = path.join(dir, "..");
const PL = await import("../src/pipeline.ts");
const { createSdkRunner } = await import("../src/agents/runner.ts");
const { profileToPersona } = await import("../src/profile.ts");
const { renderLimits } = await import("../src/cv/limits.ts");
const { ChromeCliRenderer, findChrome, loadFonts } = await import("../src/cv/render.ts");
const { buildSelection, SUMMARY } = await import("./helpers.ts");
type Prof = import("../src/profile.ts").Profile;
let failures = 0, skipped = 0;
const ok = (name: string, cond: boolean) => { if (!cond) failures++; console.log((cond ? "PASS " : "FAIL ") + name); };
const REQUIRE = !!(process.env.CI || process.env.CVAPP_REQUIRE_RENDER);
if (!findChrome()) { skipped = 1; console.log(`SKIP e2e: needs a Chromium browser${REQUIRE ? " -- required here, so this is a FAILURE" : ""}`); if (REQUIRE) failures++; console.log(failures ? "\ne2e tests FAILED" : "\nall e2e tests passed (SKIPPED)"); process.exit(failures ? 1 : 0); }
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const NOW = new Date("2026-11-16T12:00:00Z");
const priya0: Prof = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8"));
const priya = clone(priya0); priya.roles[0].bullets[3].onlyForFocus = [2]; // one bullet is usable only under focus type 2, so the limits differ by focus
const SENTINEL = "ADSENTINEL-9z";
const AD = `Marketing Executive at Acme. ${SENTINEL}. We need email campaigns and reporting. `.repeat(8);
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "cvapp-e2e-")), jobsDir = path.join(tmpRoot, "jobs");
const fonts = await loadFonts(), renderer = new ChromeCliRenderer();
const cfg = { models: { analyst: "m", writer: "m", checker: "m", coach: "m" }, agentTimeoutSeconds: 30, researchTimeoutSeconds: 30, maxAdChars: 30000 };

// ---------- a fake Claude that answers by what the prompt asks, and records everything it is shown ----------
type Seen = { label: string; system: string; prompt: string; cwd: string; cwdExisted: boolean; env: Record<string, string>; tools: unknown };
const seen: Seen[] = [];
let checkerCalls = 0, writerCalls = 0;
const quote = (p: Prof, i = 1) => profileToPersona(p, NOW).bullets[i].text.slice(0, 60);
function makeQuery(profile: Prof) {
  const ctx = profileToPersona(profile, NOW);
  return (args: { prompt: string; options: Record<string, unknown> }) => {
    const system = String(args.options.systemPrompt), prompt = args.prompt;
    const label = /# Fit analysis/.test(system) ? "analyst" : /# CV writing/.test(system) ? "writer" : /# Fact check/.test(system) ? (/<text_to_check>/.test(prompt) ? "checker:text" : "checker") : /# Coach reply/.test(system) ? `coach:${(prompt.match(/^mode: (\S+)/m) ?? [])[1]}` : /# Cover note/.test(system) ? "coach:cover-note" : /# Recruiter message/.test(system) ? "coach:recruiter-message" : /# Interview prep/.test(system) ? "coach:interview-prep" : /# Company brief/.test(system) ? "coach:company-brief" : "unknown";
    seen.push({ label, system, prompt, cwd: String(args.options.cwd), cwdExisted: existsSync(String(args.options.cwd)), env: args.options.env as Record<string, string>, tools: args.options.tools });
    let answer: unknown = { message: `coach says ${label}` };
    if (label === "analyst") answer = { company: "Acme", role: "Marketing Executive", location: "Leeds", work_mode: "hybrid", salary_text: null, salary_min_gbp: null, seniority: "mid", years_required: 3, experience: { years: 3.6, basis: "dated roles" }, requirements: [{ text: "reporting", priority: "must", rating: "strong", evidence_quote: quote(profile), note: "" }], constraint_checks: [{ rule: "salary", status: "ok", note: "" }], focus_id: 1, focus_note: "", fit_percent: 70, fit_note: "", verdict: "apply", strengths: [], gaps: [], unverified_needed: [], injection_suspected: false, summary: "" };
    if (label === "writer") { writerCalls++; answer = writerCalls === 2 ? { ...buildSelection(ctx, 1, SUMMARY), focus_id: 2, summary: "Too short." } : buildSelection(ctx, writerCalls >= 3 ? 2 : 1, SUMMARY); }
    if (label === "checker" || label === "checker:text") { const failIt = label === "checker" && ++checkerCalls === 1; answer = { claims: [0, 1, 2, 3].map((i) => ({ claim: `claim ${i}`, evidence_quote: quote(profile, i % 2), supported: true, problem: "" })), rule_breaks: failIt ? ["first check fails on purpose"] : [], verdict: failIt ? "fail" : "pass" }; }
    if (label === "coach:cover-note") answer = { message: "Dear team, I am Priya Nair and I build reports and run email campaigns." };
    return (async function* () {
      yield { type: "system", subtype: "init", tools: [], mcp_servers: [], plugins: [], skills: [], cwd: args.options.cwd, permissionMode: "default" };
      yield { type: "result", subtype: "success", is_error: false, structured_output: answer, total_cost_usd: 0.01, modelUsage: { m: { inputTokens: 10, outputTokens: 5 } }, errors: [] };
    })();
  };
}
const steps: { jobId: string; scope: string; name: string; phase: string }[] = [];
const pipelineFor = (current: Prof) => PL.createPipeline({ onStep: (e) => steps.push(e), jobsDir, profile: current, renderer, fonts, config: { accent: "oxford", showRightToWork: true, resumeProfile: "snapshot" }, now: () => NOW,
  runnerFor: (snapshot) => createSdkRunner({ profile: snapshot, tone: "friendly", config: cfg, skillsDir: path.join(root0, "skills"), query: makeQuery(snapshot) as never, tmpRoot, env: { PATH: "/usr/bin", HOME: os.homedir(), ANTHROPIC_API_KEY: "sk-ant-should-not-pass" }, now: () => NOW }) });

// The job starts under `priya`; the user edits the profile afterwards; the pipeline that finishes the job is built with the EDITED profile.
const edited = clone(priya); edited.roles[0].company = "ChangedCo Ltd";
const p1 = pipelineFor(priya), p2 = pipelineFor(edited);
const job = await p1.createJob(AD, "text");
const an = await p2.analyse(job);
const built = await p2.build(an.job);
const cover = await p2.extra(built.job, "cover-note");
const names = (scope: string) => steps.filter((e) => e.scope === scope && e.phase === "start").map((e) => e.name);
ok("the pipeline reports every step it runs, in order, once at the start and once at the end, always with the job's id", names("analyse").slice(0, 3).join() === "analyst,check,coach" && steps.every((e) => e.jobId === job.id) && steps.filter((e) => e.scope === "analyse" && e.phase === "done").length === names("analyse").length && names("build").some((n) => n.startsWith("render:")) && names("build").some((n) => n.startsWith("checker:")) && names("extra:cover-note").length > 0);
const by = (l: string) => seen.filter((s) => s.label === l);
const tag = (s: string, t: string) => (s.match(new RegExp(`<${t}>\\n([\\s\\S]*?)\\n</${t}>`)) ?? [])[1] ?? "";

ok("e2e: the real pipeline and the real runner run analyse, a build with a Checker fix and a checked extra end to end (no file name or read order mismatch between them)", an.job.status === "analysed" && built.status === "built" && /checked against your profile/.test(cover) && existsSync(path.join(built.job.dir, "cv.pdf")) && readdirSync(built.job.dir).includes("usage.jsonl") && readFileSync(path.join(built.job.dir, "usage.jsonl"), "utf8").trim().split("\n").length === seen.length);
ok("e2e: the calls happened in the intended order: analyst, coach verdict, writer, checker (fails), writer (rule slip), writer (retry), checker, coach delivered, coach cover note, checker text", seen.map((s) => s.label).join() === "analyst,coach:verdict,writer,checker,writer,writer,checker,coach:delivered,coach:cover-note,checker:text");
const cv1 = tag(by("checker")[0].prompt, "cv_text");
ok("e2e: the Checker's cv_text is the text of the ACTUALLY RENDERED PDF (a real bullet and the real role are in it) and the candidate's name, even in its uppercase heading form, is masked as [name]", /Northfield Retail/.test(cv1) && /Marketing Coordinator/.test(cv1) && cv1.includes("[name]") && !/priya|nair/i.test(cv1));
ok("e2e: the Checker's cv_text has no email, phone number or LinkedIn link (masked) and the Checker never sees the ad: neither prompt nor system", /\[email\]/.test(cv1) && /\[phone\]/.test(cv1) && !/@example\.com|07700|linkedin\.com/.test(cv1) && by("checker").every((s) => !s.prompt.includes(SENTINEL) && !s.system.includes(SENTINEL)) && !by("checker:text")[0].prompt.includes(SENTINEL));
ok("e2e: the text the Checker reads for the cover note has the candidate's name masked too", /\[name\]/.test(tag(by("checker:text")[0].prompt, "text_to_check")) && !/Priya|Nair/.test(tag(by("checker:text")[0].prompt, "text_to_check")));
const w = by("writer");
ok("e2e: the Writer's first limits are for the Analyst's focus (focus 1: the restricted bullet is not usable); after a rejected answer that chose focus 2, the retry's limits are RECOMPUTED for focus 2 (the restricted bullet is now usable)", !/usable ids: pn1, pn2, pn3, pn4\b/.test(w[0].prompt) && /usable ids: pn1, pn2, pn3(?!, pn4)/.test(w[0].prompt) && /usable ids: pn1, pn2, pn3, pn4/.test(w[2].prompt) && w[2].prompt.includes(renderLimits(priya, 2, NOW)) && /rejected for the reasons/.test(w[2].prompt));
ok("e2e: every prompt of the job carries the profile as it was when the job STARTED (the snapshot), never the edited profile", seen.filter((s) => s.label !== "coach:company-brief").every((s) => !/ChangedCo/.test(s.prompt)) && seen.filter((s) => /<profile>/.test(s.prompt)).every((s) => s.prompt.includes(profileToPersona(priya, NOW).text)));
ok("e2e: no prompt of the whole job contains the name, email, phone or LinkedIn link, or a draft or Do-not-use item", seen.every((s) => !/Priya|Nair|@example\.com|07700|linkedin\.com|CANARY|Photoshop|Head of Marketing/.test(s.prompt.replace(/\[name\]/g, ""))) );
ok("e2e: every call ran in a throwaway folder that existed during the call and was removed afterwards, and no secret from the parent environment reached the child", seen.every((s) => s.cwdExisted && s.cwd.startsWith(tmpRoot) && !existsSync(s.cwd)) && !readdirSync(tmpRoot).some((f) => f.startsWith("cvapp-agent-")) && seen.every((s) => !("ANTHROPIC_API_KEY" in s.env) && s.env.HOME === os.homedir() && JSON.stringify(s.tools) === (s.label === "coach:company-brief" ? '["WebSearch"]' : "[]")));
ok("e2e: the documents get no chat tone, the messages about the job do", by("coach:cover-note").every((s) => !/<tone>/.test(s.prompt)) && by("coach:verdict").every((s) => /<tone>\nfriendly\n<\/tone>/.test(s.prompt)));
rmSync(tmpRoot, { recursive: true, force: true });
console.log(failures === 0 ? `\nall e2e tests passed${skipped ? " (SKIPPED)" : ""}` : `\n${failures} e2e test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
