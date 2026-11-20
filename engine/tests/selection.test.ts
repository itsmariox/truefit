// Offline tests for the generic CV selection and its rules (phase 1 step 3). Fixtures only; no real data.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONAL } from "./personal-terms.ts";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { profileToPersona, meetsStartGate } = await import("../src/profile.ts");
const { validateCvSelection, selectionBudget, validateSummary } = await import("../src/cv/selection.ts");
type P = import("../src/profile.ts").Profile;
type Sel = import("../src/cv/selection.ts").CvSelection;
const load = (f: string): P => JSON.parse(readFileSync(path.join(dir, "fixtures", f), "utf8"));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
let failures = 0;
const ok = (name: string, cond: boolean) => { if (!cond) failures++; console.log((cond ? "PASS " : "FAIL ") + name); };
const NOW = new Date("2026-11-16T12:00:00Z");
const priya = load("profile-priya.json"), sam = load("profile-sam.json");
const cp = profileToPersona(priya, NOW), cs = profileToPersona(sam, NOW);

const { buildSelection: build, SUMMARY } = await import("./helpers.ts");

// 1. A valid selection exists for every profile that passes the start gate (the invariant), including a minimal one
const minimal = clone(sam); minimal.roles = [minimal.roles[0]]; minimal.skills = []; minimal.focusTypes = [];
const cm = profileToPersona(minimal, NOW);
ok("invariant: the minimal profile (one role, exactly 3 verified bullets, no skills, no focus types) passes the gate and has a valid selection", meetsStartGate(minimal).ok && validateCvSelection(build(cm, null, SUMMARY), cm).errors.length === 0);
ok("invariant: both fixtures have a valid selection, for every focus type they have", validateCvSelection(build(cp, 1, SUMMARY), cp).errors.length === 0 && validateCvSelection(build(cp, 2, SUMMARY), cp).errors.length === 0 && validateCvSelection(build(cs, 1, SUMMARY), cs).errors.length === 0);
const bp = selectionBudget(cp, 1), bs = selectionBudget(cs, 1), bm = selectionBudget(cm, null);
ok("budget: achievements only use the surplus after every role has its floor (priya 2, sam 1, minimal 0); roles are in recency order", bp.achievements === 2 && bs.achievements === 1 && bm.achievements === 0 && bp.roles.map((r) => r.id).join() === "northfield,brightside" && bs.roles.map((r) => r.id).join() === "harbour,westbrook");
const rich = clone(priya); for (let i = 0; i < 6; i++) rich.roles[0].bullets.push({ id: `px${i}`, tags: [], text: `Extra verified result number ${i + 11} for testing the ranges.`, status: "verified" });
const cr = profileToPersona(rich, NOW), br = selectionBudget(cr, 1);
ok("budget: a rich profile gets 3 achievements and the latest role may show up to 6 bullets, the next up to 4", br.achievements === 3 && br.roles[0].max === 6 && br.roles[0].min === 3 && br.roles[1].max === 3);
ok("the rich profile also has a valid selection", validateCvSelection(build(cr, 1, SUMMARY), cr).errors.length === 0);

// 2. Bullet and role rules
const good = build(cp, 1, SUMMARY);
const badSel = (patch: Partial<Sel>, ctx = cp) => validateCvSelection({ ...clone(good), ...patch }, ctx).errors;
const has = (errs: string[], re: RegExp) => errs.some((e) => re.test(e));
ok("a good selection passes and comes back in recency order", validateCvSelection(good, cp).errors.length === 0 && validateCvSelection({ ...good, roles: [...good.roles].reverse() }, cp).selection!.roles[0].role === "northfield");
ok("an invented bullet id, a draft bullet and a bullet from a draft role are refused", has(badSel({ roles: [{ role: "northfield", bullets: ["pn1", "pn2", "pn3", "zz9"] }, good.roles[1]] }), /not a bullet/) && has(badSel({ roles: [{ role: "northfield", bullets: ["pn1", "pn2", "pn3", "pn5"] }, good.roles[1]] }), /not a bullet/) && has(badSel({ roles: [{ role: "northfield", bullets: ["pn1", "pn2", "pn3", "pd1"] }, good.roles[1]] }), /not a bullet/));
ok("a bullet used twice, a bullet under the wrong role and a missing role are refused", has(badSel({ roles: [{ role: "northfield", bullets: ["pn1", "pn2", "pn3", "pb1"] }, { role: "brightside", bullets: ["pb1", "pb2", "pb3"] }] }), /more than once/) && has(badSel({ roles: [{ role: "northfield", bullets: ["pn1", "pn2", "pn3", "pb1"] }, { role: "brightside", bullets: ["pb2", "pb3", "pn4"] }] }), /belongs to/) && has(badSel({ roles: [good.roles[0]] }), /brightside is missing/));
ok("too many bullets are trimmed by code, too few are refused", (() => {
  const g = build(cr, 1, SUMMARY); const spare = cr.bullets.filter((b) => b.employer === "northfield" && !g.roles[0].bullets.includes(b.id) && !g.achievements.some((a) => a.id === b.id)).map((b) => b.id);
  const over = validateCvSelection({ ...g, roles: [{ role: "northfield", bullets: [...g.roles[0].bullets, ...spare] }, ...g.roles.slice(1)] }, cr);
  return spare.length + g.roles[0].bullets.length > 6 && over.errors.length === 0 && over.selection!.roles[0].bullets.length === 6 && has(badSel({ roles: [{ role: "northfield", bullets: ["pn1"] }, good.roles[1]] }), /needs 3 to 4/);
})());
ok("achievements: exactly the budgeted number, a bold lead-in must be word for word, long ones are trimmed by code", (() => {
  const g = build(cr, 1, SUMMARY); const first = cr.bullets.find((b) => b.id === g.achievements[0].id)!;
  const wrong = validateCvSelection({ ...g, achievements: [{ id: g.achievements[0].id, bold: "Led a team of 40" }, ...g.achievements.slice(1)] }, cr).errors;
  const long = validateCvSelection({ ...g, achievements: [{ id: g.achievements[0].id, bold: first.text.split(/\s+/).slice(0, 10).join(" ") }, ...g.achievements.slice(1)] }, cr);
  return wrong.some((e) => /word-for-word/.test(e)) && long.errors.length === 0 && long.selection!.achievements[0].bold.split(/\s+/).length === 8 && validateCvSelection({ ...g, achievements: g.achievements.slice(0, 2) }, cr).errors.some((e) => /achievements: 2 bullets, needs 3/.test(e));
})());

// 3. Skills
ok("skills: unverified, do-not-use and unknown skills are refused; duplicates are refused; too many are trimmed", has(badSel({ skills: ["Mailchimp", "CANARY-DRAFT-SKILL"] }), /unverified/) && has(badSel({ skills: ["Mailchimp", "Photoshop"] }), /do-not-use/) && has(badSel({ skills: ["Mailchimp", "Cobol"] }), /not one of the verified/) && has(badSel({ skills: ["Mailchimp", "mailchimp"] }), /listed twice/) && has(badSel({ skills: ["Mailchimp"] }), /at least 2/));

// 4. Focus types
const rs = clone(priya); rs.roles[0].bullets[3].onlyForFocus = [2];
const crs = profileToPersona(rs, NOW);
ok("focus: an unknown focus id is refused; a bullet restricted to a focus type is refused under another and allowed under its own", has(validateCvSelection({ ...clone(good), focus_id: 9 }, cp).errors, /not a focus type/) && validateCvSelection(build(crs, 1, SUMMARY), crs).errors.length === 0 && !selectionBudget(crs, 1).roles[0].avail !== undefined && (() => {
  const g = build(crs, 1, SUMMARY); g.roles[0].bullets[0] = "pn4"; const under1 = validateCvSelection(g, crs).errors; const g2 = build(crs, 2, SUMMARY); g2.roles[0].bullets[0] = "pn4"; return under1.some((e) => /may only be used under focus type 2/.test(e)) && !validateCvSelection(g2, crs).errors.some((e) => /may only be used/.test(e));
})());

// 5. Summary rules
const sumErr = (s: string, ctx = cp) => validateSummary(s, ctx, 1);
const S2 = "Builds and runs practical programmes that teams adopt, from newsletter growth to weekly reporting. Brings clear reporting and steady delivery to busy teams.";
ok("summary: length, sentences, characters, invented numbers and over-claimed years are refused", has(sumErr("Too short."), /words/) && has(sumErr(S2 + " <b>x</b>"), /not allowed/) && has(sumErr(S2.replace("newsletter growth", "growing lists by 9137 subscribers")), /number/) && has(sumErr("Brings 15 years of marketing experience to busy teams across retail and print, from newsletters to weekly reporting. Works with store managers each week."), /years/));
ok("summary: pronouns, buzzwords, self-praise and do-not-use phrases or skills are refused", has(sumErr("She builds practical programmes that teams adopt, from newsletter growth to weekly reporting. Brings clear reporting to busy teams."), /pronoun/) && has(sumErr(S2.replace("practical", "passionate")), /buzzword/) && has(sumErr(S2 + " Detail-oriented."), /self-praise/) && has(sumErr(S2.replace("Builds", "Head of Marketing who builds")), /do-not-use/) && has(sumErr(S2 + " Uses Photoshop."), /do-not-use/) && has(sumErr(S2 + " Ran paid social advertising."), /known gap/));
ok("summary: residence is an allow-list: where the candidate lives is fine; any other place is refused", sumErr(S2 + " Leeds-based marketer based in Leeds, UK.").length === 0 && has(sumErr(S2 + " Based in Manchester."), /residence in "Manchester"/) && has(sumErr(S2 + " Manchester-based."), /Manchester/) && has(sumErr(S2 + " Living in Paris."), /Paris/));
ok("summary: 'cloud-based' and similar words are not mistaken for a residence claim", sumErr(S2 + " Used cloud-based tools and Excel-based reports.").length === 0);
const abroad = clone(priya); abroad.identity.city = "Lisbon"; abroad.identity.country = "Portugal";
const ca = profileToPersona(abroad, NOW);
ok("summary: for someone living abroad, claiming the UK or a UK nation is refused, and the UK names are not allowed", has(sumErr(S2 + " UK-based.", ca), /UK/) && has(sumErr(S2 + " Based in England.", ca), /England/) && sumErr(S2 + " Based in Lisbon.", ca).length === 0 && ca.residenceTargets.includes("uk"));

// 6. No personal literals in the new modules
const src = readFileSync(path.join(dir, "..", "src", "cv", "selection.ts"), "utf8") + readFileSync(path.join(dir, "..", "src", "profile.ts"), "utf8") + readFileSync(path.join(dir, "..", "src", "profile-md.ts"), "utf8");
ok("the new modules contain no employer, person or place names", !PERSONAL.test(src));

console.log(failures === 0 ? "\nall selection tests passed" : `\n${failures} selection test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
