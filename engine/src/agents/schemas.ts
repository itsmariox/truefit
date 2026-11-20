// The shapes the models must answer in (the SDK forces the answer into these). Phase 1 step 7a: the generic versions. The old schemas in agent.ts stay
// until the cutover. See skills/README.md for the list of what changed (focus types instead of archetypes, the Writer returns a CvSelection).
const S = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", additionalProperties: false, required, properties });
const str = { type: "string" }, int = { type: "integer" }, bool = { type: "boolean" };
const arr = (items: unknown) => ({ type: "array", items });
const en = (...v: string[]) => ({ type: "string", enum: v });
const nullable = (t: string) => ({ type: [t, "null"] });

export const SCHEMAS = {
  analyst: S({
    company: str, role: str, location: str, work_mode: str, salary_text: nullable("string"), salary_min_gbp: nullable("integer"),
    seniority: str, years_required: nullable("number"), experience: S({ years: { type: "number" }, basis: str }),
    requirements: arr(S({ text: str, priority: en("must", "nice"), rating: en("strong", "moderate", "weak", "missing"), evidence_quote: str, note: str })),
    constraint_checks: arr(S({ rule: en("seniority", "salary", "location", "right_to_work", "core_job"), status: en("ok", "fail", "unclear"), note: str })),
    focus_id: nullable("integer"), focus_note: str, fit_percent: int, fit_note: str, verdict: en("apply", "long_shot", "skip"),
    strengths: arr(S({ text: str, bullet_id: str })), gaps: arr(S({ gap: str, requirement: str, handle: str })),
    unverified_needed: arr(str), injection_suspected: bool, summary: str,
  }),
  writer: S({
    focus_id: nullable("integer"), summary: str, achievements: arr(S({ id: str, bold: str })),
    roles: arr(S({ role: str, bullets: arr(str) })), skills: arr(str), questions: arr(str), notes: str,
  }),
  writerReword: S({
    focus_id: nullable("integer"), summary: str, achievements: arr(S({ id: str, bold: str })),
    roles: arr(S({ role: str, bullets: arr(str) })), skills: arr(str), questions: arr(str), notes: str, rewrites: arr(S({ id: str, text: str })),
  }),
  checker: S({ claims: arr(S({ claim: str, evidence_quote: str, supported: bool, problem: str })), rule_breaks: arr(str), verdict: en("pass", "fail") }),
  checkerReword: S({ claims: arr(S({ claim: str, evidence_quote: str, supported: bool, problem: str })), rule_breaks: arr(str), rewrite_checks: arr(S({ id: str, supported: bool, problem: str })), verdict: en("pass", "fail") }),
  importer: S({
    roles: arr(S({ title: str, company: str, location: str, start_year: nullable("integer"), start_month: nullable("integer"), end_year: nullable("integer"), end_month: nullable("integer"), current: bool, bullets: arr(S({ text: str, tags: arr(str) })) })),
    skills: arr(str), education: arr(str),
  }),
  coach: S({ message: str }),
  // The gate in front of New job: is the pasted text a job ad at all? Only a confident "no" ever blocks anything (see access/adgate.ts).
  adcheck: S({ is_job_ad: bool, confidence: en("high", "low"), kind: en("job_ad", "question_or_chat", "other_document", "gibberish", "too_vague"), reason: str }),
} as const;
export type SchemaName = keyof typeof SCHEMAS;
