// Schema v2, step B: the CV import as code. Contacts and the proposed name come from the raw text; trust comes from a word-for-word match against the masked CV text; a second import of
// the same CV upgrades items instead of duplicating them; a second, different CV merges into the same roles and records what each source said.
import { emptyProfile2, migrateV1ToV2, validateProfile2, type Profile2 } from "../src/profile-v2.ts";
import { extractContacts, mergeImportV2, proposeName } from "../src/profile-import-v2.ts";
import type { Profile } from "../src/profile.ts";
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const T0 = "2026-03-01T10:00:00.000Z", T1 = "2026-03-02T10:00:00.000Z";
const CV = `Sam Example
sam.example@example.org | 07700 900456 | linkedin.com/in/sam-example | github.com/samexample

Profile
Marketing lead with eight years of retail experience.

Experience
Marketing Executive, Acme Retail, Leeds, 2019 - present
- Grew the monthly newsletter list from 1,200 to 3,600 subscribers in 12 months
- Reported weekly on campaign results in Google Analytics
Marketing Assistant, Brightwell Home, Leeds, 2016 - 2019
- Ran social posting for a small retail brand

Skills: Email marketing, Google Analytics, Social media

Education
BA Business Management, Example University, 2015`;
const ANSWER = { roles: [
  { title: "Marketing Executive", company: "Acme Retail", location: "Leeds", start_year: 2019, start_month: 1, current: true, bullets: [{ text: "Grew the monthly newsletter list from 1,200 to 3,600 subscribers in 12 months", tags: ["email"] }, { text: "Reported on campaign results every week with Google Analytics", tags: [] }] },
  { title: "Marketing Assistant", company: "Brightwell Home", location: "Leeds", start_year: 2016, start_month: 1, end_year: 2019, end_month: 1, bullets: [{ text: "Ran social posting for a small retail brand", tags: [] }] }],
  skills: ["Email marketing", "Google Analytics", "Python"], education: ["BA Business Management, Example University, 2015"] };

{ // contacts and name
  const c = extractContacts(CV);
  ok("contacts: email, phone, LinkedIn and a profile link are read from the raw text by code", c.email === "sam.example@example.org" && c.phone === "07700 900456" && /linkedin\.com\/in\/sam-example/.test(c.linkedin ?? "") && c.links.some((l) => /github\.com\/samexample/.test(l)));
  ok("name: the top line is proposed; headings, lines with digits or an email are not", proposeName(CV) === "Sam Example" && proposeName("Curriculum Vitae\n12 Example Road\nJamie de Vries\nmarketing") === "Jamie de Vries" && proposeName("CV\nmarketing manager\nsam@example.org") === null);
}
// a fresh import into an empty profile
const r1 = mergeImportV2(emptyProfile2(T0), ANSWER, CV, { label: "CV one", now: T0 }), p1 = r1.profile;
{
  const acme = p1.facts.roles.find((r) => r.company === "Acme Retail")!;
  ok("fresh import: an exact bullet is trusted (origin cv, with its source); a reworded one is kept but stays under review and is counted", acme.bullets[0].meta.trust === "trusted" && acme.bullets[0].meta.origin === "cv" && acme.bullets[0].meta.sourceId === r1.sourceId && acme.bullets[1].meta.trust === "review" && r1.notFromCv === 1);
  ok("fresh import: a skill not in the CV (Python) is dropped, the two that are in it are trusted; the education line is trusted", p1.facts.skills.map((s) => s.name).join() === "Email marketing,Google Analytics" && p1.facts.skills.every((s) => s.meta.trust === "trusted") && p1.facts.education[0].meta.trust === "trusted" && r1.dropped === 1);
  ok("fresh import: roles whose title and company are in the CV are trusted; dates come from the answer", acme.meta.trust === "trusted" && acme.end === "present" && acme.claims?.length === 1);
  ok("fresh import: contacts and the proposed name fill the LOCKED block (by code, from the raw text) and the name is reported for confirmation", p1.locked.contact.email === "sam.example@example.org" && p1.locked.contact.phone === "07700 900456" && p1.locked.identity.name === "Sam Example" && r1.proposedName === "Sam Example");
  const src = p1.sources[0];
  ok("fresh import: the source keeps the MASKED CV text (no email, phone or LinkedIn in it) and a fingerprint, and the change is logged", src.text!.length > 50 && !/example\.org|07700|linkedin\.com/.test(src.text!) && src.textHash.length === 64 && p1.log.at(-1)!.actor === "import" && validateProfile2(p1).length === 0);
}
// the owner's migration path: a v1 profile full of drafts, then the SAME CV once
{
  const v1: Profile = { schemaVersion: 1, identity: { name: "Sam Example", city: "Leeds", country: "UK", email: "keep@example.org" }, roles: [
    { id: "r1", title: "Marketing Executive", company: "Acme Retail", location: "Leeds", start: { y: 2019, m: 1 }, end: "present", status: "draft", bullets: [
      { id: "b1", text: "Grew the monthly newsletter list from 1,200 to 3,600 subscribers in 12 months", tags: ["email"], status: "draft" },
      { id: "b2", text: "Something the CV does not say", tags: [], status: "draft" }] }],
    skills: [{ name: "Email marketing", status: "draft" }, { name: "Not in the CV", status: "draft" }], education: [{ id: "e1", text: "BA Business Management, Example University, 2015", status: "draft" }], focusTypes: [], doNotUse: [],
    rules: { salaryFloor: null, location: { current: "", targets: [], workModes: [], cvLocationLines: [] }, seniority: { levels: [], avoid: [] }, rightToWork: { statement: "", needsSponsorship: false }, avoidRoles: [] } };
  const legacy = migrateV1ToV2(v1, T0), r = mergeImportV2(legacy, ANSWER, CV, { label: "same CV", now: T1 }), acme = r.profile.facts.roles.find((x) => x.company === "Acme Retail")!;
  ok("re-import: the draft bullet the CV really contains is UPGRADED to trusted (no copy added); the one the CV does not contain stays under review", acme.bullets.filter((b) => /Grew the monthly/.test(b.text)).length === 1 && acme.bullets.find((b) => b.id === "b1")!.meta.trust === "trusted" && acme.bullets.find((b) => b.id === "b1")!.meta.origin === "cv" && acme.bullets.find((b) => b.id === "b2")!.meta.trust === "review");
  ok("re-import: the Acme role, the skill and the education line were matched (upgraded), nothing was duplicated; only the second role and the new bullets were added", r.profile.facts.roles.filter((x) => x.company === "Acme Retail").length === 1 && r.profile.facts.skills.filter((s) => s.name === "Email marketing").length === 1 && r.profile.facts.education.length === 1 && r.upgraded >= 4 && r.added.roles === 1);
  ok("re-import: the unmatched legacy skill stays under review (never silently trusted), and the user's own email in the locked block is NOT overwritten", r.profile.facts.skills.find((s) => s.name === "Not in the CV")!.meta.trust === "review" && r.profile.locked.contact.email === "keep@example.org" && r.proposedName === null);
}
// idempotent, and a different second CV
{
  const again = mergeImportV2(p1, ANSWER, CV, { label: "CV one again", now: T1 });
  ok("same CV twice: nothing is added, the source is not duplicated, trust does not change", again.duplicateSource && again.profile.sources.length === 1 && again.added.bullets === 0 && again.added.roles === 0 && JSON.stringify(again.profile.facts) === JSON.stringify(p1.facts));
  const CV2 = CV.replace("2019 - present", "2020 - present").replace("sam.example@example.org", "other@example.org") + "\nA new line";
  const ANS2 = JSON.parse(JSON.stringify(ANSWER)); ANS2.roles[0].start_year = 2020; ANS2.roles[0].bullets.push({ text: "A new line" });
  const m = mergeImportV2(p1, ANS2, CV2, { label: "CV two", now: T1 }), acme = m.profile.facts.roles.filter((x) => x.company === "Acme Retail");
  ok("two different CVs: they merge into ONE Acme role, both sources are listed, the role records what EACH source said about its start, and the first CV's contact details stay", acme.length === 1 && m.profile.sources.length === 2 && acme[0].claims!.length === 2 && acme[0].claims!.map((c) => c.start!.y).sort().join() === "2019,2020" && m.profile.locked.contact.email === "sam.example@example.org" && acme[0].bullets.some((b) => b.text === "A new line"));
}
// a bullet carrying a contact detail is dropped
{
  const bad = { roles: [{ title: "Marketing Executive", company: "Acme Retail", bullets: [{ text: "Call 020 7946 0958 for details" }, { text: "Ran social posting for a small retail brand" }] }] };
  const r = mergeImportV2(emptyProfile2(T0), bad, CV, { label: "x", now: T0 });
  ok("a bullet that holds a phone number is dropped, the clean one is kept", r.profile.facts.roles[0].bullets.length === 1 && r.dropped === 1);
}
{ // whole words only: trust must not come from a fragment of another word
  const cv = "Sam Example\nMarketing Assistant, Acmeville Stores, Leeds, 2019 - present\n- Did good work for the shop team every week\nSkills: Good communication";
  const ans = { roles: [{ title: "Marketing Assistant", company: "Acme", start_year: 2019, current: true, bullets: [{ text: "Did good work" }] }], skills: ["Go", "R", "Good communication"], education: [] };
  const r = mergeImportV2(emptyProfile2(T0), ans, cv, { label: "x", now: T0 }), role = r.profile.facts.roles[0];
  ok("whole words: a skill 'Go' or 'R' is NOT found in a CV that only says 'good'; the company 'Acme' is NOT found in 'Acmeville' (the role stays under review); a real whole-word skill is trusted", r.profile.facts.skills.map((s) => s.name).join() === "Good communication" && role.meta.trust === "review" && r.profile.facts.skills[0].meta.trust === "trusted");
  ok("whole words: a bullet that is only a fragment ('Did good work' inside a longer sentence) is NOT a word-for-word match of a different sentence, but the same words as a phrase are found (phrases inside longer text count)", role.bullets[0].meta.trust === "trusted");
}
{ // decision B: an earlier item whose words ARE in the CV is upgraded even when Claude's answer skips it
  const v1: Profile = { schemaVersion: 1, identity: { name: "Sam Example", city: "Leeds", country: "UK" }, roles: [{ id: "r1", title: "Marketing Executive", company: "Acme Retail", location: "", start: { y: 2019, m: 1 }, end: "present", status: "draft", bullets: [
    { id: "b1", text: "Reported weekly on campaign results in Google Analytics", tags: [], status: "draft" }, { id: "b2", text: "Invented achievement that is nowhere in the CV", tags: [], status: "draft" }] }],
    skills: [{ name: "Social media", status: "draft" }, { name: "Quantum physics", status: "draft" }], education: [{ id: "e1", text: "BA Business Management, Example University, 2015", status: "draft" }], focusTypes: [], doNotUse: [],
    rules: { salaryFloor: null, location: { current: "", targets: [], workModes: [], cvLocationLines: [] }, seniority: { levels: [], avoid: [] }, rightToWork: { statement: "", needsSponsorship: false }, avoidRoles: [] } };
  const r = mergeImportV2(migrateV1ToV2(v1, T0), { roles: [], skills: [], education: [] }, CV, { label: "same CV, empty answer", now: T1 }), role = r.profile.facts.roles[0];
  ok("re-match: with an EMPTY answer from Claude, earlier items whose words are in the CV (the bullet, the role, 'Social media', the education line) become trusted from the CV; items not in the CV stay under review", role.bullets[0].meta.trust === "trusted" && role.bullets[0].meta.origin === "cv" && role.bullets[1].meta.trust === "review" && role.meta.trust === "trusted" && r.profile.facts.skills[0].meta.trust === "trusted" && r.profile.facts.skills[1].meta.trust === "review" && r.profile.facts.education[0].meta.trust === "trusted" && r.upgraded === 4);
}
void (null as unknown as Profile2);
console.log(failures === 0 ? "\nall profile-import-v2 tests passed" : `\n${failures} profile-import-v2 test(s) FAILED`); process.exit(failures === 0 ? 0 : 1);
