// Offline tests for the light-rewording Writer mode (phase 1 step 7c): the mechanical layer measured on a labelled drift corpus, the selection rules,
// the renderer and ATS expectations (what was checked is what is printed), fit pruning, the Checker's side-by-side pairs, and the whole mode end to end through
// the real pipeline and the real runner on a fake Claude. No Claude call is made. The mode ships only if the step 8 evals pass (PRD 13).
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONAL } from "./personal-terms.ts";
const dir = path.dirname(fileURLToPath(import.meta.url)), root0 = path.join(dir, "..");
const { profileToPersona, cleanText } = await import("../src/profile.ts");
const { validateRewrite, numericTokens, namedTerms } = await import("../src/cv/reword.ts");
const { validateCvSelection, pruneRewrites } = await import("../src/cv/selection.ts");
const { renderCvHtml } = await import("../src/cv/html.ts");
const { ChromeCliRenderer, findChrome, loadFonts } = await import("../src/cv/render.ts");
const { atsCheck, expectationsFor, readPdf } = await import("../src/cv/ats.ts");
const { makeCv } = await import("../src/cv/fit.ts");
const PL = await import("../src/pipeline.ts");
const P = await import("../src/agents/prompts.ts");
const { createSdkRunner } = await import("../src/agents/runner.ts");
const { SCHEMAS } = await import("../src/agents/schemas.ts");
const { CASES, ORIGINALS } = await import("./reword-corpus.ts");
const { buildSelection, fullProfile, FILLER, SUMMARY } = await import("./helpers.ts");
type Prof = import("../src/profile.ts").Profile;
let failures = 0, skipped = 0;
const ok = (name: string, cond: boolean) => { if (!cond) failures++; console.log((cond ? "PASS " : "FAIL ") + name); };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const NOW = new Date("2026-11-16T12:00:00Z");
const priya: Prof = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8"));
const ctx = profileToPersona(priya, NOW);
const has = (errs: string[], re: RegExp) => errs.some((e) => re.test(e));
const SK = path.join(root0, "skills");

// ---------- 1. the mechanical layer on the labelled corpus ----------
{
  const run = CASES.map((c) => ({ c, errs: validateRewrite(c.original, c.reworded, ctx, "reworded bullet") }));
  const fp = run.filter((r) => r.c.expect === "accept" && r.errs.length), missed = run.filter((r) => r.c.expect === "code" && !r.errs.length);
  const wrong = run.filter((r) => r.c.expect === "code" && r.errs.length && r.c.why && !r.errs.some((e) => r.c.why!.test(e)));
  const n = (k: string) => CASES.filter((c) => c.expect === k).length;
  console.log(`info: corpus ${CASES.length} cases: ${n("accept")} acceptable, ${n("code")} drift the code must catch, ${n("checker-only")} drift only the Checker can catch; false alarms ${fp.length}, missed ${missed.length}`);
  ok("corpus: the code layer lets EVERY acceptable rewording through (a guard that rejects good rewrites makes the mode worthless)", fp.length === 0 && n("accept") >= 20);
  ok("corpus: the code layer catches EVERY labelled code-drift case, for the right reason (number, symbol, unit, named term, role, scope word, length, do-not-use, residence, pronoun, buzzword, character, self-praise)", missed.length === 0 && wrong.length === 0 && n("code") >= 25);
  ok("corpus: the drift only the Checker can see passes the code layer BY DESIGN (a larger scope without a tripwire, a stronger verb, a different doer, an implied result, a dropped qualifier): the mode depends on the Checker for these, and step 8 measures it", run.filter((r) => r.c.expect === "checker-only").every((r) => r.errs.length === 0) && n("checker-only") >= 5);
  ok("corpus: acceptable and drifted cases are about balanced (22 against 34), so false alarms count as much as misses", n("accept") / (n("code") + n("checker-only")) > 0.6);
  ok("numbers are compared together with their symbol and unit: £15,000, $15,000, 22%, 22, 50+, 50, 4x, 3-hour, 3 days, and spelled-out numbers all differ", (() => { const t = numericTokens; return t("£15,000")[0] !== t("$15,000")[0] && t("22%")[0] !== t("22")[0] && t("50+")[0] !== t("50")[0] && t("4x")[0] !== t("4")[0] && t("3-hour")[0] === t("3 hours")[0] && t("3-hour")[0] !== t("3 days")[0] && t("six")[0] === "w:six" && t("1,200")[0] === "1200" && t("12 weekly")[0] === "12"; })());
  ok("named terms: tools, acronyms, camel-case, digits and verified skills count; a capitalised sentence-opening verb does not", (() => { const n2 = (x: string) => namedTerms(x, ctx.skills.allowed); return n2("Built a report in n8n and HubSpot with SQL").join() === "hubspot,n8n,sql" && n2("Built a report").length === 0 && n2("used Excel and canva daily").join() === "canva,excel"; })());
}

// ---------- 2. the selection rules in rewording mode ----------
const sel0 = buildSelection(ctx, 1, SUMMARY);
const onCv = [...sel0.achievements.map((a) => a.id), ...sel0.roles.flatMap((r) => r.bullets)];
const idFor = (re: string) => onCv.find((id) => ORIGINALS[id] && re === id) ?? null;
const rw = (id: string, text: string) => ({ id, text });
const withRw = (rewrites: unknown, patch: object = {}) => ({ ...clone(sel0), ...patch, rewrites });
const V = (raw: unknown, mode: "reword" | "choose-and-order" = "reword") => validateCvSelection(raw, ctx, { mode });
console.log(`info: the selection puts these bullets on the CV: ${onCv.join(", ")}`);
{
  const id2 = onCv.find((i) => i === "pn2")!, good = rw(id2, "Created a weekly Google Analytics report for 4 store managers, replacing a manual 3-hour spreadsheet task.");
  const r = V(withRw([good]));
  ok("reword mode: a valid rewording is accepted and stored (cleaned) in the selection; the other bullets stay word for word", r.errors.length === 0 && r.selection!.rewrites!.length === 1 && r.selection!.rewrites![0].text === cleanText(good.text));
  ok("reword mode: an empty list is fine (nothing reworded); a missing or malformed rewrites field is refused LOUDLY (a mode mismatch between the runner and the pipeline shows up here)", V(withRw([])).errors.length === 0 && V(withRw([])).selection!.rewrites === undefined && has(V({ ...sel0 }).errors, /rewrites missing or malformed/) && has(V(withRw("nope")).errors, /rewrites missing or malformed/) && has(V(withRw([{ id: 5 }])).errors, /malformed/));
  ok("choose-and-order mode: a selection carrying rewrites is refused (not quietly stripped); an empty list is fine", has(V(withRw([good]), "choose-and-order").errors, /not allowed in choose-and-order mode/) && V(withRw([]), "choose-and-order").errors.length === 0 && V({ ...sel0 }, "choose-and-order").errors.length === 0);
  ok("reword mode: drift is returned as exact, readable reasons for the Writer's one retry (a changed number and a bigger scope, here)", (() => { const e = V(withRw([rw(id2, "Led a weekly Google Analytics report for 5 store managers, replacing a manual 3-hour spreadsheet task.")])).errors; return has(e, /reworded bullet pn2 adds or changes a number: 5 store/) && has(e, /bigger with a scope or leadership word.*led/) ; })());
  ok("reword mode: a rewrite of a bullet that is not on the CV is refused; the same id twice is refused; an identical text is ignored; a rewrite of a bullet code trimmed for length is dropped silently", has(V(withRw([rw("pn5", "x y z")])).errors, /not a bullet of this CV/) && has(V(withRw([good, good])).errors, /appears twice/) && V(withRw([rw(id2, ORIGINALS.pn2)])).selection!.rewrites === undefined && (() => { const big = { ...clone(sel0), roles: sel0.roles.map((r, i) => (i === 0 ? { ...r, bullets: [...r.bullets, "pn4"] } : r)), achievements: sel0.achievements.filter((a) => a.id !== "pn4") }; return validateCvSelection({ ...big, rewrites: [rw("pn4", "Scheduled and wrote 12 social posts a week for Instagram & Facebook, lifting engagement by 22%.")] }, ctx, { mode: "reword" }).errors.every((e) => !/pn4/.test(e) || /not|between|needs/.test(e)); })());
  // bold lead-ins (advisor point 1): validated against the PRINTED text
  const ach = sel0.achievements[0], origText = ctx.bullets.find((b) => b.id === ach.id)!.text;
  const rewordedAch = ach.id === "pn4" ? "Scheduled and wrote 12 social posts a week for Instagram & Facebook, lifting engagement by 22%." : null;
  if (rewordedAch) {
    const ok1 = V(withRw([rw("pn4", rewordedAch)], { achievements: [{ id: "pn4", bold: "Scheduled and wrote" }, ...sel0.achievements.slice(1)] }));
    const bad1 = V(withRw([rw("pn4", rewordedAch)], { achievements: [{ id: "pn4", bold: "Wrote and scheduled" }, ...sel0.achievements.slice(1)] }));
    ok("bold: an achievement's bold lead-in is validated against the REWORDED text when the bullet is reworded: the printed words pass, words only in the original are refused", ok1.errors.length === 0 && has(bad1.errors, /not a word-for-word piece of pn4 as it is printed \(reworded\)/) && origText.length > 0);
  } else ok("bold: (the fixture's first achievement is not pn4; adjust the test)", false);
}

// ---------- 3. the renderer, the ATS expectations, the fit pruning ----------
if (!findChrome()) { skipped = 1; console.log("SKIP chrome parts: needs a Chromium browser"); if (process.env.CI || process.env.CVAPP_REQUIRE_RENDER) failures++; }
else {
  const fonts = await loadFonts(), renderer = new ChromeCliRenderer();
  const ach = sel0.achievements[0], reworded = "Scheduled and wrote 12 social posts a week for Instagram & Facebook, lifting engagement by 22%.";
  const sel = V(withRw([rw("pn4", reworded)], { achievements: [{ id: "pn4", bold: "Scheduled and wrote" }, ...sel0.achievements.slice(1)] }));
  ok("setup: the valid rewording selection used below passes", sel.errors.length === 0 && ach.id.length > 0);
  const html = renderCvHtml(priya, sel.selection!, { fonts }), body = html.slice(html.indexOf("<body>"));
  ok("render: the reworded text is printed, the original is not, and a reworded achievement still renders its EXACT bold markup", body.includes("<li><b>Scheduled and wrote</b> 12 social posts a week for Instagram &amp; Facebook, lifting engagement by 22%.</li>") && !body.includes("Wrote and scheduled 12 social posts a week across"));
  const made = await makeCv(priya, sel.selection!, { renderer, fonts });
  ok("ATS: the expectations use the reworded text, so the production check passes on the printed CV; the PDF really carries the reworded text and not the original", made.report.ok && made.text.replace(/\s+/g, " ").includes("Scheduled and wrote 12 social posts a week for Instagram & Facebook, lifting engagement by 22%.") && !made.text.includes("across Instagram"));
  ok("ATS: if the PDF printed the ORIGINAL where a rewording was validated, the check fails (what was checked must be what is printed)", !atsCheck(await readPdf((await makeCv(priya, { ...sel.selection!, rewrites: undefined }, { renderer, fonts })).fit.pdf), expectationsFor(priya, sel.selection!)).ok);
  ok("fit: rewrites of bullets the fit loop drops are pruned with them, and pruneRewrites keeps the rest", (() => { const s = { ...clone(sel0), rewrites: [rw("pn1", "x"), rw("pn2", "y")] }; s.roles[0].bullets = s.roles[0].bullets.filter((b) => b !== "pn2"); const p = pruneRewrites(s as never); return p.rewrites!.length === 1 && p.rewrites![0].id === "pn1" && pruneRewrites({ ...s, rewrites: [rw("zz", "q")] } as never).rewrites === undefined; })());
  const wordy = fullProfile(priya, FILLER.repeat(2)), cw = profileToPersona(wordy, NOW), sw = buildSelection(cw, 1, SUMMARY);
  const last = sw.roles[0].bullets[sw.roles[0].bullets.length - 1], lastText = cw.bullets.find((b) => b.id === last)!.text;
  const swr = { ...clone(sw), rewrites: [rw(last, lastText.replace("Delivered", "Completed"))] };
  const m = await makeCv(wordy, swr as never, { renderer, fonts });
  ok("fit: a trimmed bullet takes its rewrite with it (the final selection has no rewrite for a bullet that is gone)", m.report.ok && (m.fit.selection.rewrites ?? []).every((r) => [...m.fit.selection.achievements.map((a) => a.id), ...m.fit.selection.roles.flatMap((r2) => r2.bullets)].includes(r.id)));
}

// ---------- 4. the Checker's side: guaranteed text, verdicts, pairs ----------
{
  const G = PL.guaranteedText(priya, ctx), Gr = PL.guaranteedText(priya, ctx, ["pn2"]);
  const fragment = "weekly Google Analytics report for 4 store managers", claim = `Bullet: '${fragment}': unclear who did this`;
  const claims = (extra: object[]) => ({ claims: [0, 1, 2, 3].map((i) => ({ claim: `c${i}`, evidence_quote: ctx.bullets[i % 2].text.slice(0, 60), supported: true, problem: "" })).concat(extra as never), rule_breaks: [] });
  ok("guaranteed: a reworded bullet is NEVER guaranteed: a complaint quoting the fragment it shares with its original still fails, while the same complaint is ignored when the bullet is printed word for word", PL.verifyChecker(claims([{ claim, evidence_quote: "", supported: false, problem: "p" }]), ctx.text, G).pass && !PL.verifyChecker(claims([{ claim, evidence_quote: "", supported: false, problem: "p" }]), ctx.text, Gr).pass && !Gr.includes(ctx.bullets.find((b) => b.id === "pn2")!.text) && G.includes(ctx.bullets.find((b) => b.id === "pn2")!.text));
  const base = { ...claims([]), rule_breaks: [] };
  ok("verdicts: every printed rewrite needs a Checker verdict: a missing one fails, an unsupported one fails with its reason, supported ones pass; with no rewrites nothing changes", PL.verifyChecker({ ...base, rewrite_checks: [] }, ctx.text, G, ["pn2"]).problems.some((x) => /pn2: the Checker did not review it/.test(x)) && PL.verifyChecker({ ...base, rewrite_checks: [{ id: "pn2", supported: false, problem: "says Led, the original says Built" }] }, ctx.text, G, ["pn2"]).problems.some((x) => /reworded bullet pn2: says Led/.test(x)) && PL.verifyChecker({ ...base, rewrite_checks: [{ id: "pn2", supported: true, problem: "" }] }, ctx.text, G, ["pn2"]).pass && PL.verifyChecker(base, ctx.text, G, []).pass);
  const pairs = [{ id: "pn2", original: ORIGINALS.pn2, reworded: "Created a weekly Google Analytics report for 4 store managers, replacing a manual 3-hour spreadsheet task." }];
  const cp = await P.checkerPrompt({ skillsDir: SK, ctx, summary: SUMMARY, cvText: "PRIYA NAIR cv text", hideNames: ["Priya Nair"], rewrites: pairs });
  const cn = await P.checkerPrompt({ skillsDir: SK, ctx, summary: SUMMARY, cvText: "cv text" });
  ok("prompts: the Checker sees each ORIGINAL and REWORDED pair side by side in a <rewrites> block (answered in the checkerReword schema); with no rewrites there is no block and the plain schema", /<rewrites>\n\[pn2\]\nORIGINAL: Built a weekly[\s\S]*\nREWORDED: Created a weekly[\s\S]*<\/rewrites>/.test(cp.prompt) && cp.schema === "checkerReword" && /Job 3/.test(cp.prompt) && !/<rewrites>/.test(cn.prompt) && cn.schema === "checker" && !/ADSENTINEL/.test(cp.prompt) && /\[name\]/.test(cp.prompt));
  ok("schemas: the reword Writer schema adds exactly one field (rewrites: id and text); the reword Checker schema adds rewrite_checks (id, supported, problem); the base schemas are unchanged", Object.keys(SCHEMAS.writerReword.properties).filter((k) => !(k in SCHEMAS.writer.properties)).join() === "rewrites" && Object.keys(SCHEMAS.checkerReword.properties).filter((k) => !(k in SCHEMAS.checker.properties)).join() === "rewrite_checks" && SCHEMAS.writer.required.length === 7);
  const wr = await P.writerPrompt({ skillsDir: SK, ctx, profile: priya, adText: "ad", analysisJson: "{}", focus: 1, mode: "reword", now: NOW }), wb = await P.writerPrompt({ skillsDir: SK, ctx, profile: priya, adText: "ad", analysisJson: "{}", focus: 1, now: NOW });
  ok("prompts: each Writer mode gets its own complete skill and schema; the reword system prompt contains no 'do not rewrite' and no 'word for word from the profile'; the base one still does", wr.schema === "writerReword" && wb.schema === "writer" && /Rewording rules/.test(wr.system) && !/do not rewrite|word for word from the profile/i.test(wr.system) && /do not rewrite bullets/.test(wb.system) && !/Rewording rules/.test(wb.system));
}

// ---------- 5. the whole mode, end to end: real pipeline + real runner + a fake Claude ----------
if (findChrome()) {
  const fonts = await loadFonts(), renderer = new ChromeCliRenderer();
  const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "cvapp-reword-")), jobsDir = path.join(tmpRoot, "jobs");
  const cfg = { models: { analyst: "m", writer: "m", checker: "m", coach: "m" }, agentTimeoutSeconds: 30, researchTimeoutSeconds: 30, maxAdChars: 30000 };
  type Seen = { label: string; system: string; prompt: string };
  const run = async (opts: { mode: "reword" | "choose-and-order"; runnerMode?: "reword" | "choose-and-order"; writerAnswers: (turn: number) => unknown; checkerAnswers?: (n: number) => unknown }) => {
    const seen: Seen[] = []; let writerTurn = 0, checkerN = 0;
    const query = (args: { prompt: string; options: Record<string, unknown> }) => {
      const system = String(args.options.systemPrompt), prompt = args.prompt;
      const label = /# Fit analysis/.test(system) ? "analyst" : /# CV writing/.test(system) ? "writer" : /# Fact check/.test(system) ? "checker" : "coach";
      seen.push({ label, system, prompt });
      let answer: unknown = { message: `coach says ${label}` };
      if (label === "analyst") answer = { company: "Acme", role: "Marketing Executive", location: "Leeds", work_mode: "hybrid", salary_text: null, salary_min_gbp: null, seniority: "mid", years_required: 3, experience: { years: 3.6, basis: "dated roles" }, requirements: [{ text: "reporting", priority: "must", rating: "strong", evidence_quote: ctx.bullets[1].text.slice(0, 60), note: "" }], constraint_checks: [{ rule: "salary", status: "ok", note: "" }], focus_id: 1, focus_note: "", fit_percent: 70, fit_note: "", verdict: "apply", strengths: [], gaps: [], unverified_needed: [], injection_suspected: false, summary: "" };
      if (label === "writer") answer = opts.writerAnswers(++writerTurn);
      if (label === "checker") answer = (opts.checkerAnswers ?? (() => ({ claims: [0, 1, 2, 3].map((i) => ({ claim: `c${i}`, evidence_quote: ctx.bullets[i % 2].text.slice(0, 60), supported: true, problem: "" })), rule_breaks: [], rewrite_checks: [{ id: "pn2", supported: true, problem: "" }], verdict: "pass" })))(++checkerN);
      return (async function* () { yield { type: "system", subtype: "init", tools: [], mcp_servers: [], plugins: [], skills: [], cwd: args.options.cwd, permissionMode: "default" }; yield { type: "result", subtype: "success", is_error: false, structured_output: answer, total_cost_usd: 0.01, modelUsage: { m: { inputTokens: 1, outputTokens: 1 } }, errors: [] }; })();
    };
    const pl = PL.createPipeline({ jobsDir: path.join(jobsDir, String(Math.random()).slice(2)), profile: priya, renderer, fonts, config: { accent: "oxford", showRightToWork: true, resumeProfile: "snapshot", writerMode: opts.mode }, now: () => NOW,
      runnerFor: (p) => createSdkRunner({ profile: p, tone: "friendly", config: cfg, skillsDir: SK, query: query as never, tmpRoot, env: { PATH: "/usr/bin", HOME: os.homedir() }, now: () => NOW, writerMode: opts.runnerMode ?? opts.mode }) });
    const a = await pl.analyse(await pl.createJob("A marketing ad about reporting. ".repeat(10), "text"));
    return { pl, a, seen, build: (o: object = {}) => pl.build(a.job, o) };
  };
  const goodSel = (turn: number, rewrites: unknown) => ({ ...buildSelection(ctx, 1, SUMMARY), rewrites });
  const R2 = "Created a weekly Google Analytics report for 4 store managers, replacing a manual 3-hour spreadsheet task.";
  // happy path with one retry for drift and one fix round for a Checker complaint about a rewording
  const x1 = await run({ mode: "reword", writerAnswers: (t) => t === 1 ? goodSel(t, [{ id: "pn2", text: "Led a weekly Google Analytics report for 4 store managers, replacing a manual 3-hour spreadsheet task." }]) : goodSel(t, [{ id: "pn2", text: R2 }]),
    checkerAnswers: (n) => ({ claims: [0, 1, 2, 3].map((i) => ({ claim: `c${i}`, evidence_quote: ctx.bullets[i % 2].text.slice(0, 60), supported: true, problem: "" })), rule_breaks: [], rewrite_checks: [{ id: "pn2", supported: n >= 2, problem: n >= 2 ? "" : "the reworded bullet says Created where the original says Built: stronger" }], verdict: "pass" }) });
  const b1 = await x1.build();
  const wprompts = x1.seen.filter((s) => s.label === "writer"), cprompts = x1.seen.filter((s) => s.label === "checker");
  ok("mode e2e: a drifted rewording is sent back ONCE with the exact reasons, then a valid one is taken; the Checker then rejects the rewording; the fix round carries the Checker's reason about that bullet; the second round passes; the CV is built", b1.status === "built" && wprompts.length === 3 && /bigger with a scope or leadership word/.test(wprompts[1].prompt) && /reworded bullet pn2: the reworded bullet says Created/.test(wprompts[2].prompt) && cprompts.length === 2);
  ok("mode e2e: the Writer ran with the rewording skill and schema; the Checker received the original and reworded pair for the bullet that is really printed", wprompts.every((s) => /Rewording rules/.test(s.system) && !/do not rewrite bullets/.test(s.system)) && /\[pn2\]\nORIGINAL: Built a weekly Google Analytics[\s\S]*REWORDED: Created a weekly/.test(cprompts[0].prompt) && !/ADSENTINEL/.test(cprompts[0].prompt));
  const team = JSON.parse(readFileSync(path.join(b1.job.dir, "team.json"), "utf8")), cvText = readFileSync(path.join(b1.job.dir, "cv-text.txt"), "utf8");
  ok("mode e2e: the CV and the 'How this CV was built' data agree: the PDF carries the reworded text and not the original, and team.json lists every rewrite as an original and reworded pair for the panel", cvText.replace(/\s+/g, " ").includes(R2) && !cvText.includes("Built a weekly Google") && team.cv.writer_mode === "reword" && team.cv.rewrites.length === 1 && team.cv.rewrites[0].original === ORIGINALS.pn2 && team.cv.rewrites[0].reworded === R2);
  // a Checker that skips the rewrite verdict fails the CV, never passes it
  const x2 = await run({ mode: "reword", writerAnswers: (t) => goodSel(t, [{ id: "pn2", text: R2 }]), checkerAnswers: () => ({ claims: [0, 1, 2, 3].map((i) => ({ claim: `c${i}`, evidence_quote: ctx.bullets[i % 2].text.slice(0, 60), supported: true, problem: "" })), rule_breaks: [], rewrite_checks: [], verdict: "pass" }) });
  const b2 = await x2.build();
  ok("mode e2e: a Checker that gives no verdict for a printed rewrite never passes it: both rounds fail and no CV is kept", b2.status === "failed" && /did not review it/.test(b2.job.note ?? "") && !existsSync(path.join(b2.job.dir, "cv.pdf")));
  // mode mismatch: the pipeline in reword mode with a runner in choose-and-order mode fails loudly instead of silently not rewording
  const x3 = await run({ mode: "reword", runnerMode: "choose-and-order", writerAnswers: () => buildSelection(ctx, 1, SUMMARY) });
  const b3 = await x3.build();
  ok("mode mismatch: a pipeline in rewording mode with a runner in choose-and-order mode fails LOUDLY (the Writer's answer has no rewrites field) instead of quietly not rewording", b3.status === "failed" && /broke the rules twice/.test(b3.job.note ?? "") && x3.seen.some((s) => s.label === "writer" && !/Rewording rules/.test(s.system)));
  // the reverse: choose-and-order everywhere, a Writer that returns rewrites anyway
  const x4 = await run({ mode: "choose-and-order", writerAnswers: (t) => goodSel(t, [{ id: "pn2", text: R2 }]) });
  const b4 = await x4.build();
  ok("mode mismatch: in choose-and-order mode a Writer answer that carries rewrites is refused (not stripped), the Writer is told why, and the build fails after one retry", b4.status === "failed" && x4.seen.filter((s) => s.label === "writer").length === 2 && /not allowed in choose-and-order mode/.test(x4.seen.filter((s) => s.label === "writer")[1].prompt));
  // choose-and-order is unchanged: no rewrites block, base skill and schema
  const x5 = await run({ mode: "choose-and-order", writerAnswers: (t) => buildSelection(ctx, 1, SUMMARY) });
  const b5 = await x5.build();
  ok("choose-and-order is untouched: base Writer skill, no <rewrites> block for the Checker, the CV builds, team.json says so", b5.status === "built" && x5.seen.filter((s) => s.label === "writer").every((s) => /do not rewrite bullets/.test(s.system)) && !x5.seen.some((s) => /<rewrites>/.test(s.prompt)) && JSON.parse(readFileSync(path.join(b5.job.dir, "team.json"), "utf8")).cv.writer_mode === "choose-and-order" && JSON.parse(readFileSync(path.join(b5.job.dir, "team.json"), "utf8")).cv.rewrites.length === 0);
  rmSync(tmpRoot, { recursive: true, force: true });
}
// ---------- hygiene ----------
ok("the rewording module names no person, employer or place", !PERSONAL.test(readFileSync(path.join(root0, "src", "cv", "reword.ts"), "utf8")));
console.log(failures === 0 ? `\nall reword tests passed${skipped ? " (PART SKIPPED)" : ""}` : `\n${failures} reword test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
