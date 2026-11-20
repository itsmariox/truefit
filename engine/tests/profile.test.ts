// Offline tests for the structured profile (phase 1 step 2): validation, start gate, years, and above all that nothing
// untrusted (drafts, Do-not-use items, identity, smuggled contact details) can reach text a model sees. Fixtures only; no real data.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { validateProfile, meetsStartGate, claimedYearsMax, profileToPersona } = await import("../src/profile.ts");
const { quoteExists } = await import("../src/checks.ts");
type P = import("../src/profile.ts").Profile;
const load = (f: string): P => JSON.parse(readFileSync(path.join(dir, "fixtures", f), "utf8"));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
let failures = 0;
const ok = (name: string, cond: boolean) => { if (!cond) failures++; console.log((cond ? "PASS " : "FAIL ") + name); };

const priya = load("profile-priya.json"), sam = load("profile-sam.json");
const NOW = new Date("2026-11-16T12:00:00Z");
for (const [label, p] of [["priya", priya], ["sam", sam]] as const) {
  const persona = profileToPersona(p, NOW);
  const everything = [persona.text, persona.stories, ...persona.bullets.map((b) => b.text), ...persona.skills.allowed, ...persona.archetypes.map((a) => a.headline), [...persona.numbers].join(" ")].join("\n");
  ok(`${label}: the fixture is a valid profile`, validateProfile(p).length === 0);
  ok(`${label}: no draft, canary or unverified item reaches the model text, bullets, skills, headlines or numbers`, !/CANARY/.test(everything) && !persona.numbers.has("9137") && !persona.numbers.has("7741"));
  ok(`${label}: identity never reaches the model text (name, email, phone, LinkedIn)`, !/priya|nair|okafor|sam\b|@example\.com|07700|linkedin/i.test(persona.text + persona.stories));
  ok(`${label}: every verified bullet is a verbatim substring of the text, so evidence quotes can be checked`, p.roles.filter((r) => r.status === "verified").flatMap((r) => r.bullets).filter((b) => b.status === "verified").every((b) => persona.text.includes(b.text) && quoteExists(persona.text, b.text)));
  ok(`${label}: the persona has the shape the old engine reads`, persona.bullets.every((b) => b.status === "confirmed" && typeof b.employer === "string") && persona.archetypes.every((a, i, all) => i === 0 || all[i - 1].id < a.id) && persona.files && persona.numbers instanceof Set);
  ok(`${label}: the hash is stable`, profileToPersona(p, NOW).hash === persona.hash && persona.hash.length === 16);
}

const pp = profileToPersona(priya, NOW), ps = profileToPersona(sam, NOW);
ok("a verified bullet under a draft role is not selectable", !pp.bullets.some((b) => b.id === "pd1") && !pp.bullets.some((b) => b.employer === "draftco"));
ok("draft skills and draft education are not allowed, but the code can see the draft skill", !pp.skills.allowed.includes("CANARY-DRAFT-SKILL") && pp.skills.unverified.includes("CANARY-DRAFT-SKILL") && !pp.text.includes("CANARY-DRAFT-EDU"));
ok("do-not-use: phrases, removed skills and gaps are code-only, never in the text", pp.forbiddenPhrases.includes("Head of Marketing") && pp.forbiddenPhrases.includes("CANARY-FORBIDDEN-PHRASE") && pp.skills.removed.includes("Photoshop") && pp.skills.knownGaps.includes("paid social advertising") && !/Photoshop|Head of Marketing|paid social/.test(pp.text));
ok("numbers come from verified bullets only: bullet numbers yes, dates and salary no", pp.numbers.has("3600") && pp.numbers.has("1200") && pp.numbers.has("15000") && !pp.numbers.has("2021") && !pp.numbers.has("28500"));
ok("special characters survive verbatim (pound, percent, ampersand, curly apostrophe)", pp.bullets.find((b) => b.id === "pn3")!.text.includes("£15,000") && pp.bullets.find((b) => b.id === "pn4")!.text.includes("Instagram & Facebook") && pp.bullets.find((b) => b.id === "pb3")!.text.includes("customers’") && ps.bullets.find((b) => b.id === "sw1")!.text.includes("group’s") && pp.bullets.find((b) => b.id === "pn4")!.text.includes("22%"));
ok("stories: only verified stories, only for interview prep, not in the text", pp.stories.includes("weekly report") && !pp.text.includes("Situation:") && ps.stories === "");
ok("rules are in the text; the salary floor is not a number the summary may use", pp.text.includes("GBP 28,500") && pp.text.includes("Leeds, UK"));
ok("availability is optional: shown in the text only when filled in, never counted as a number, and a contact detail in it is refused", pp.text.includes("- Availability: Available with one month notice") && !ps.text.includes("Availability") && (() => { const a = clone(priya); delete a.rules.availability; const b = clone(priya); b.rules.availability = "Start on 14 February or in 30 days"; return [...profileToPersona(a, NOW).numbers].join() === [...profileToPersona(b, NOW).numbers].join(); })() && (() => { const m = clone(priya); m.rules.availability = "call me on 07700 900555"; return validateProfile(m).some((e) => /rules\.availability contains/.test(e)); })());

// changing a draft does not change the hash; changing a verified bullet does
const draftEdit = clone(priya); draftEdit.roles[0].bullets[4].text = "CANARY-DRAFT-BULLET something else 5555";
const verifiedEdit = clone(priya); verifiedEdit.roles[0].bullets[0].text += " Extra.";
ok("the hash ignores drafts and follows verified content", profileToPersona(draftEdit, NOW).hash === pp.hash && profileToPersona(verifiedEdit, NOW).hash !== pp.hash);

// start gate
ok("start gate: both fictional profiles pass; the career changer sits exactly on the 3-bullet edge", meetsStartGate(priya).ok && meetsStartGate(sam).ok && sam.roles[0].bullets.filter((b) => b.status === "verified").length === 3);
const gate1 = clone(sam); gate1.roles[0].bullets[2].status = "draft";
const gate2 = clone(sam); gate2.rules.location.cvLocationLines = [];
const gate3 = clone(sam); gate3.rules.rightToWork.statement = " ";
const g1 = meetsStartGate(gate1), g2 = meetsStartGate(gate2), g3 = meetsStartGate(gate3);
ok("start gate: a 4th-to-3rd bullet slip, a missing location line or a missing right to work each block it with a plain reason", !g1.ok && g1.missing[0].includes("3 verified bullets") && !g2.ok && g2.missing[0].includes("where you are") && !g3.ok && g3.missing[0].includes("right to work"));
const gate4 = clone(sam); delete gate4.identity.email; const gate5 = clone(sam); gate5.identity.country = " ";
const g4 = meetsStartGate(gate4), g5 = meetsStartGate(gate5);
ok("start gate: a missing email or country blocks it with one plain reason", !g4.ok && g4.missing.join("|") === "your email and country" && !g5.ok && g5.missing.join("|") === "your email and country");

// years of employment
ok("claimed years: overlaps counted once, drafts ignored, ongoing roles run to today (priya 99 months -> 9, sam 123 months -> 11)", claimedYearsMax(priya, NOW) === 9 && claimedYearsMax(sam, NOW) === 11);

// validation catches the things that must never get through
const bad = (mut: (p: P) => void, re: RegExp, opts?: { requireDates?: boolean }) => { const p = clone(priya); mut(p); return validateProfile(p, opts).some((e) => re.test(e)); };
ok("validation: an email in a bullet, a phone number in a story and a LinkedIn link in a skill are all reported", bad((p) => { p.roles[0].bullets[0].text += " Contact me at x@y.co"; }, /bullet pn1 contains an email/) && bad((p) => { p.roles[0].story!.text += " Call 07700 900999"; }, /story of northfield contains/) && bad((p) => { p.skills[0].name = "linkedin.com/in/x"; }, /skill .* contains/));
ok("validation: repeated bullet ids, repeated role ids and bad statuses are reported", bad((p) => { p.roles[1].bullets[0].id = "pn1"; }, /bullet id "pn1" is missing or repeated/) && bad((p) => { p.roles[1].id = "northfield"; }, /role id/) && bad((p) => { (p.roles[0].bullets[0] as any).status = "confirmed"; }, /status "confirmed"/));
ok("validation: a role ending before it starts, a wrong schema version and missing dates are reported", bad((p) => { p.roles[1].end = { y: 2010, m: 1 }; }, /ends before it starts/) && bad((p) => { p.schemaVersion = 2; }, /schemaVersion/) && bad((p) => { p.roles[1].start = null; }, /start date missing/) && !bad((p) => { p.roles[1].start = null; }, /start date missing/, { requireDates: false }));
// second line of defence: even if validation were skipped, a smuggled contact detail is masked before reaching the text
const smuggled = clone(priya); smuggled.roles[0].bullets[0].text += " Write to secret.person@example.org or 07700 900777";
const sp = profileToPersona(smuggled, NOW);
ok("a contact detail smuggled into a bullet is masked out of the model text and the bullet copy", !/secret\.person|900777/.test(sp.text + sp.bullets.map((b) => b.text).join(" ")));

console.log(failures === 0 ? "\nall profile tests passed" : `\n${failures} profile test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
