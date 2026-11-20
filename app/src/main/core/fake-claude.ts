// A pretend Claude for the PACKAGED TEST BUILD and the build tests only (phases 4h, 6). It is imported only behind `__TEST_BUILD__`, which the release build defines as false, so the
// bundler removes it: the release build is checked to contain none of this (see scripts/package.ts). It follows the real program's message stream and answers every role.
import { readFileSync } from "node:fs";
import { profileToPersona, type Profile } from "../../../../engine/src/profile.ts";
import { selectionBudget } from "../../../../engine/src/cv/selection.ts";

const SUMMARY = "Builds and runs practical programmes that teams adopt, using verified results from recent roles. Brings clear reporting and steady delivery to busy teams.";
export type FakeControls = { questions: string[]; failChecker: boolean; importAnswer: unknown; seen: { role: string; prompt: string }[] };

// The canned answer for one call, chosen by which skill the system prompt carries. Shared by the fake SDK stream (fakeQuery) and the fake provider (fake-provider.ts).
export function fakeAnswer(profileOrPath: string | Profile, controls: Partial<FakeControls>, system: string, prompt: string): unknown {
  {
    const profile: Profile = typeof profileOrPath === "string" ? JSON.parse(readFileSync(profileOrPath, "utf8")) : profileOrPath, ctx = profileToPersona(profile, new Date());
    const quote = (i: number) => ctx.bullets[i].text.slice(0, 60);
    const label = /# Job ad check/.test(system) ? "adcheck" : /# CV import/.test(system) ? "importer" : /# Fit analysis/.test(system) ? "analyst" : /# CV writing/.test(system) ? "writer" : /# Fact check/.test(system) ? "checker" : "coach";
    controls.seen?.push({ role: label, prompt });
    let answer: unknown = { message: `Looks like a good fit (test build). ${label}` };
    if (label === "coach" && /^mode: question/m.test(prompt)) answer = { message: `I need a fact that isn't in your profile: ${(controls.questions ?? []).join(" ")} Answer it, or build without it.` };
    // The pretend gate decides like a careful reader would, from the words: a vacancy talks about a role, duties or requirements; a question or a recipe does not. Only a clear "no" is high confidence.
    if (label === "adcheck") { const isAd = /\b(role|job|position|vacancy|responsibilit\w*|requirements?|experience|salary|apply|candidate)\b/i.test(prompt); answer = isAd ? { is_job_ad: true, confidence: "high", kind: "job_ad", reason: "It describes a role." } : { is_job_ad: false, confidence: "high", kind: "question_or_chat", reason: "It is not a vacancy." }; }
    if (label === "importer") answer = controls.importAnswer ?? { roles: [], skills: [], education: [] };
    if (label === "analyst") answer = { company: "Test Company", role: "Marketing Executive", location: "Leeds", work_mode: "hybrid", salary_text: null, salary_min_gbp: null, seniority: "mid", years_required: 2, experience: { years: 8, basis: "dated roles" },
      requirements: [{ text: "reporting", priority: "must", rating: "strong", evidence_quote: quote(1), note: "" }], constraint_checks: [], focus_id: 1, focus_note: "", fit_percent: 71, fit_note: "A test result.", verdict: "apply", strengths: [], gaps: [], unverified_needed: [], injection_suspected: false, summary: "A fake analysis made by the test build." };
    if (label === "writer") {
      const focus = 1, b = selectionBudget(ctx, focus);
      const ids = (r: string) => ctx.bullets.filter((x) => x.employer === r && (!ctx.focusRestrictions[x.id] || ctx.focusRestrictions[x.id].includes(focus))).map((x) => x.id);
      const roles = b.roles.map((r) => ({ role: r.id, bullets: ids(r.id).slice(0, r.min) })), rest = b.roles.flatMap((r) => ids(r.id).slice(r.min)), take = new Map(ctx.bullets.map((x) => [x.id, x]));
      answer = { focus_id: focus, summary: SUMMARY, achievements: rest.slice(0, b.achievements).map((id) => ({ id, bold: take.get(id)!.text.split(/\s+/).slice(0, 3).join(" ") })), roles, skills: ctx.skills.allowed.slice(0, Math.max(b.skills.min, 2)), questions: controls.questions ?? [], notes: "" };
    }
    if (label === "checker") { const fail = controls.failChecker === true && !/<text_to_check>/.test(prompt); answer = { claims: [0, 1, 2, 3].map((i) => ({ claim: `claim ${i}`, evidence_quote: quote(i % 2), supported: true, problem: "" })), rule_breaks: fail ? ["a test failure"] : [], verdict: fail ? "fail" : "pass" }; }
    return answer;
  }
}

export function fakeQuery(profileOrPath: string | Profile, controls: Partial<FakeControls> = {}) {
  return (a: { prompt?: string; options: any }) => {
    const answer = fakeAnswer(profileOrPath, controls, String(a.options.systemPrompt), String(a.prompt ?? ""));
    return (async function* () {
      yield { type: "system", subtype: "init", tools: ["StructuredOutput"], mcp_servers: [], plugins: [], skills: [], cwd: a.options.cwd, permissionMode: "default", apiKeySource: a.options.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : "none" };
      yield { type: "result", subtype: "success", is_error: false, structured_output: answer, total_cost_usd: 0.01, modelUsage: { m: { inputTokens: 100, outputTokens: 20 } }, errors: [] };
    })();
  };
}
