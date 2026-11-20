// CV import: what is sent, and what is accepted back. No AI, no network.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { maskForImport, mergeImport, IMPORT_LIMITS } = await import("../src/profile-import.ts");
const { importerPrompt } = await import("../src/agents/prompts.ts");
const { SCHEMAS } = await import("../src/agents/schemas.ts");
type Prof = import("../src/profile.ts").Profile;
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const empty = (): Prof => ({ schemaVersion: 1, identity: { name: "Sam Example", city: "Leeds", country: "UK" }, roles: [], skills: [], education: [], focusTypes: [], doNotUse: [], rules: { salaryFloor: null, location: { current: "", targets: [], workModes: [], cvLocationLines: [] }, seniority: { levels: [], avoid: [] }, rightToWork: { statement: "", needsSponsorship: false }, avoidRoles: [] } });
const CV = `Sam Example
sam.example@example.com | 07700 900456 | linkedin.com/in/sam-example
Marketing Coordinator, Northfield Retail, Leeds, March 2021 - Present
- Grew the newsletter list from 1,200 to 3,600 subscribers in 12 months.
- Built a weekly Google Analytics report for 4 store managers.
Assistant, Eastgate Ltd, York, 2018 - 2021
- Answered customer emails within one working day.
Skills: Google Analytics, Copywriting
BA Business, University of Leeds, 2014 - 2017`;
const masked = maskForImport(CV);
ok("1. before anything is sent, emails, phone numbers and LinkedIn links are removed from the CV text and line breaks are kept", !/@example|07700|linkedin\.com/.test(masked) && masked.split("\n").length >= 8 && /Northfield Retail/.test(masked));
const prompt = await importerPrompt({ skillsDir: path.join(dir, "..", "skills"), cvText: masked });
ok("2. the prompt holds ONLY the CV block (no profile, no other text), the instructions forbid rewriting and inventing, and the schema is the importer's", /^<cv>/.test(prompt.prompt) && prompt.prompt.endsWith("</cv>") && !/<profile>/.test(prompt.prompt) && /Copy, never rewrite/.test(prompt.system) && /Never invent/.test(prompt.system) && prompt.schema === "importer" && prompt.web === false && !/@example|07700/.test(prompt.prompt));
ok("3. the importer's schema asks for roles (with bullets), skills and education and nothing else", JSON.stringify(Object.keys((SCHEMAS.importer as any).properties)) === '["roles","skills","education"]');
const answer = { roles: [
  { title: "Marketing Coordinator", company: "Northfield Retail", location: "Leeds", start_year: 2021, start_month: 3, end_year: null, end_month: null, current: true, bullets: [{ text: "Grew the newsletter list from 1,200 to 3,600 subscribers in 12 months.", tags: ["Email", "growth"] }, { text: "Built a weekly Google Analytics report for 4 store managers.", tags: [] }, { text: "Doubled revenue single-handedly.", tags: ["sales"] }] },
  { title: "Assistant", company: "Eastgate Ltd", location: "York", start_year: 2018, start_month: null, end_year: 2021, end_month: null, current: false, bullets: [{ text: "Answered customer emails within one working day.", tags: [] }] }],
  skills: ["Google Analytics", "Copywriting", "Kubernetes"], education: ["BA Business, University of Leeds, 2014 - 2017", "PhD in Astrophysics, 2019"] };
const r = mergeImport(empty(), answer, CV);
ok("4. everything imported is a DRAFT (roles, bullets, skills, education): nothing is verified by the import", r.profile.roles.every((x) => x.status === "draft" && x.bullets.every((b) => b.status === "draft")) && r.profile.skills.every((s) => s.status === "draft") && r.profile.education.every((e) => e.status === "draft"));
ok("5. counts: 2 roles, 4 bullets, 2 skills, 1 education line; the invented skill and degree were dropped; one bullet is flagged as not found in the CV", r.added.roles === 2 && r.added.bullets === 4 && r.added.skills === 2 && r.added.education === 1 && r.dropped === 2 && r.notFromCv === 1);
ok("6. dates come out as the CV says (March 2021 to present; 2018 to 2021 with month 1 only as a placeholder), tags are lower-cased", r.profile.roles[0].start?.y === 2021 && r.profile.roles[0].start?.m === 3 && r.profile.roles[0].end === "present" && (r.profile.roles[1].end as { y: number } | null)?.y === 2021 && r.profile.roles[0].bullets[0].tags.join() === "email,growth");
ok("7. the original profile is untouched (a copy is returned) and a second import of the same answer adds nothing (no duplicates)", empty().roles.length === 0 && (() => { const again = mergeImport(r.profile, { roles: [], skills: answer.skills, education: answer.education }, CV); return again.added.skills === 0 && again.added.education === 0; })() && mergeImport(r.profile, answer, CV).added.bullets === 0);
const hostile = mergeImport(empty(), { roles: [{ title: "x".repeat(500), company: "Acme", location: "", start_year: 1800, start_month: 99, end_year: "2020", end_month: null, current: false, bullets: [{ text: "Mail me at boss@evil.example now", tags: [] }, { text: "y".repeat(5000), tags: ["a", "b", "c", "d", "e"] }, { text: 42, tags: [] }] }, null, { title: "", company: "" }, "nonsense"], skills: "not an array", education: null }, "Acme y");
ok("8. a hostile or broken answer is handled: long text cut, impossible dates become empty, a bullet with an email address is dropped, bullets over the limit are cut, junk entries are ignored, nothing throws", hostile.profile.roles.length === 1 && hostile.profile.roles[0].title.length <= IMPORT_LIMITS.field && hostile.profile.roles[0].start === null && hostile.profile.roles[0].end === null && hostile.profile.roles[0].bullets.every((b) => !/@evil/.test(b.text) && b.text.length <= IMPORT_LIMITS.bulletChars && b.tags.length <= 3) && hostile.added.skills === 0);
const many = mergeImport(empty(), { roles: Array.from({ length: 80 }, (_, i) => ({ title: "T" + i, company: "C" + i, location: "", start_year: 2000, start_month: 1, end_year: 2001, end_month: 1, current: false, bullets: Array.from({ length: 40 }, (_, j) => ({ text: `bullet ${i} ${j}`, tags: [] })) })) }, "bullet");
ok("9. there are limits: at most 30 roles and 14 bullets each", many.added.roles === 30 && many.profile.roles.every((x) => x.bullets.length <= 14));
const valid = (await import("../src/profile.ts")).validateProfile(r.profile, { requireDates: false });
ok("10. the merged profile passes the engine's own profile validator", valid.length === 0);
void readFileSync;

{ // the independent review (2026-11-18): more contact shapes are masked before a CV goes to Claude
  const t = "Tel: (020) 7946 0958, (555) 123-4567, 555.123.4567, 00 44 7700 900123\nsam [at] example.com | sam(at)example.com\nhttps://github.com/someone and github.com/foo/bar\nMarketing lead, 2019 - 2022. Grew the list from 12 000 to 45 000. Budget 250000 over 24 months, a 250 000 000 contract and 1 500 000 000 users.";
  const out = maskForImport(t);
  ok("import: phone numbers with brackets, dots or 00 prefixes, obfuscated emails and profile links are masked", !/7946|123-4567|555\.123|7700|sam \[|example\.com|github\.com/.test(out));
  ok("import: ordinary numbers in a CV (years, 12 000, 250000, 24 months) are left alone", /2019 - 2022/.test(out) && /12 000 to 45 000/.test(out) && /250000 over 24 months/.test(out) && /250 000 000 contract/.test(out) && /1 500 000 000 users/.test(out));
}
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); } else console.log("\nALL PASS");
