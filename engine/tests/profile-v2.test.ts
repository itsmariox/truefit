// Profile schema v2, step A (design/PROFILE-SCHEMA-v2.md): migration, the v1 view the rest of the engine reads, and the way a save from the current page is applied back onto the stored v2
// profile. The round trip (v2 -> v1 view -> applied unchanged) must give back EXACTLY what it started with.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyV1Edit, emptyProfile2, migrateV1ToV2, toV1View, validateProfile2, type Profile2 } from "../src/profile-v2.ts";
import { validateProfile, type Profile } from "../src/profile.ts";
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const deq = (a: unknown, b: unknown) => { try { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b))); return true; } catch { return false; } };
const here = path.dirname(fileURLToPath(import.meta.url)), clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const priya: Profile = JSON.parse(readFileSync(path.join(here, "fixtures", "profile-priya.json"), "utf8"));
const T0 = "2026-01-01T00:00:00.000Z", T1 = "2026-02-02T00:00:00.000Z";

// a v2 profile that uses everything v2 can hold and the v1 view cannot
function rich(): Profile2 {
  const p = migrateV1ToV2(priya, T0);
  p.locked.contact.links = ["https://example.org/portfolio"]; p.locked.work.visaNote = "citizen";
  p.facts.roles[0].bullets[0].meta = { origin: "cv", trust: "trusted", addedAt: T0, sourceId: "s1", quote: "Grew the list by 40%" };
  p.facts.roles[0].bullets[0].metrics = ["40%"]; p.facts.roles[0].bullets[1].meta = { origin: "inferred", trust: "review", addedAt: T0 };
  p.facts.skills[0].level = "core"; p.facts.skills[0].meta = { origin: "said", trust: "trusted", addedAt: T0, confirmedIn: "conversation", quote: "I do email every day" };
  p.facts.languages = [{ id: "l1", name: "English", level: "native", meta: { origin: "cv", trust: "trusted", addedAt: T0, sourceId: "s1" } }];
  p.facts.certifications = [{ id: "c1", name: "Analytics certificate", issuer: "Example Academy", year: 2022, meta: { origin: "cv", trust: "review", addedAt: T0, sourceId: "s1" } }];
  p.facts.projects = [{ id: "j1", name: "Newsletter rebuild", text: "Rebuilt a weekly newsletter", tags: ["email"], meta: { origin: "typed", trust: "trusted", addedAt: T0 } }];
  p.sources = [{ id: "s1", kind: "cv", label: "CV 2026", addedAt: T0, textHash: "abc123", text: "masked text" }]; p.review = { dismissed: ["overlap:r1:r2"] };
  p.log = [{ at: T0, actor: "import", summary: "imported CV 2026" }]; return p;
}

// 1. the round trip
{
  const p = rich(), v1 = toV1View(p), back = applyV1Edit(p, v1, T1);
  ok("round trip: the v1 view applied back UNCHANGED gives exactly the stored v2 profile (meta, sources, languages, certifications, projects, dismissals, the log, visa note, links, metrics)", deq(back, p));
  ok("round trip: the v1 view passes the v1 validator and says schemaVersion 1 (nothing downstream sees v2)", v1.schemaVersion === 1 && validateProfile(v1, { requireDates: false }).length === 0);
  ok("round trip: the profile of the fixture survives migration -> view unchanged (what the engine reads today is exactly what it reads after migration)", deq(toV1View(migrateV1ToV2(priya, T0)), priya));
}
// 2. what an edit does
{
  const p = rich(), v1 = toV1View(p);
  v1.roles[0].bullets[0].text = "Grew the list by 45%";                                    // a changed text
  v1.roles[0].bullets[1].status = "verified";                                              // a tick
  v1.roles[0].bullets.push({ id: "bNEW", text: "A new bullet", tags: [], status: "draft" }); // a new item
  const q = applyV1Edit(p, v1, T1), b0 = q.facts.roles[0].bullets[0], b1 = q.facts.roles[0].bullets[1], bn = q.facts.roles[0].bullets.at(-1)!;
  ok("edit: a changed text becomes the user's own (origin typed) and loses its source and quote", b0.meta.origin === "typed" && b0.meta.sourceId === undefined && b0.meta.quote === undefined && b0.text === "Grew the list by 45%" && deq(b0.metrics, ["40%"]));
  ok("edit: a tick on an item under review makes it trusted and records when and by whom; its origin stays", b1.meta.trust === "trusted" && b1.meta.origin === "inferred" && b1.meta.acceptedAt === T1 && b1.meta.acceptedBy === "user");
  ok("edit: a new item is typed, and trust follows its status", bn.meta.origin === "typed" && bn.meta.trust === "review" && bn.meta.addedAt === T1);
  ok("edit: everything the edit did not touch keeps its provenance byte for byte", deq(q.facts.roles[1], p.facts.roles[1]) && deq(q.sources, p.sources) && deq(q.facts.languages, p.facts.languages) && deq(q.log, p.log));
}
// 3. skills have no id: matched by NAME, never by position
{
  const p = rich(); p.facts.skills = [0, 1, 2].map((i) => ({ name: `Skill ${i}`, meta: { origin: "cv" as const, trust: "trusted" as const, addedAt: T0, sourceId: `src${i}` } })); p.sources = [...p.sources, ...[0, 1, 2].map((i) => ({ id: `src${i}`, kind: "cv" as const, label: `x${i}`, addedAt: T0, textHash: `h${i}` }))];
  const v1 = toV1View(p); v1.skills = [v1.skills[2], v1.skills[0]];                       // reorder and delete the middle one
  const q = applyV1Edit(p, v1, T1);
  ok("skills: after a reorder and a delete every skill keeps ITS OWN source and trust (matched by name, not by position)", q.facts.skills.length === 2 && q.facts.skills[0].name === "Skill 2" && q.facts.skills[0].meta.sourceId === "src2" && q.facts.skills[1].meta.sourceId === "src0");
}
// 4. locked fields travel through the old page
{
  const p = rich(), v1 = toV1View(p); v1.identity.city = "Leeds"; v1.identity.email = "x@example.org"; v1.rules.rightToWork.statement = "Needs a visa"; v1.rules.rightToWork.needsSponsorship = true; v1.rules.salaryFloor = { amount: 30000, currency: "GBP" };
  const q = applyV1Edit(p, v1, T1);
  ok("locked: city, contact and right to work edited on the old page reach the locked block; the visa note and the links are kept; preferences follow", q.locked.identity.city === "Leeds" && q.locked.contact.email === "x@example.org" && q.locked.work.rightToWork === "Needs a visa" && q.locked.work.needsSponsorship && q.locked.work.visaNote === "citizen" && deq(q.locked.contact.links, p.locked.contact.links) && q.preferences.salaryFloor?.amount === 30000);
}
// 5. a profile shaped like a real imported one: undated roles, many drafts, skills without a group
{
  const imp: Profile = clone(priya); imp.roles = [0, 1, 2, 3].map((i) => ({ id: `r${i}`, title: `Role ${i}`, company: `Company ${i}`, location: "", start: null, end: null, status: "draft", bullets: Array.from({ length: 4 }, (_, k) => ({ id: `r${i}b${k}`, text: `Did thing ${i}.${k}`, tags: [], status: k === 0 && i === 0 ? "verified" : "draft" })) }));
  imp.skills = Array.from({ length: 25 }, (_, i) => ({ name: `Skill ${i}`, status: "draft" })); imp.education = [{ id: "e1", text: "A degree", status: "draft" }, { id: "e2", text: "A course", status: "draft" }]; imp.focusTypes = [];
  const m = migrateV1ToV2(imp, T0), drafts = m.facts.roles.flatMap((r) => r.bullets).filter((b) => b.meta.trust === "review").length + m.facts.skills.length + m.facts.education.length;
  ok("real-shaped: undated roles, 15 drafted bullets, 25 skills with no group and 2 education lines migrate; drafts become 'review' and the one verified bullet 'trusted'; all origin legacy", drafts === 15 + 25 + 2 && m.facts.roles[0].bullets[0].meta.trust === "trusted" && m.facts.roles.every((r) => r.meta.origin === "legacy"));
  ok("real-shaped: the v1 view is identical to what was stored and v2 validates (dates not required)", deq(toV1View(m), imp) && validateProfile2(m).length === 0);
  ok("real-shaped: nothing is lost by saving it back untouched", deq(applyV1Edit(m, toV1View(m), T1), m));
}
// 6. validation
{
  const p = rich(); ok("validate: the rich v2 profile is valid", validateProfile2(p).length === 0);
  const a = rich(); delete (a.facts.roles[0].bullets[0] as any).meta; ok("validate: a fact with no provenance is refused", validateProfile2(a).some((x) => /no valid provenance/.test(x)));
  const b = rich(); b.facts.roles[0].bullets[0].meta.sourceId = "nope"; ok("validate: a fact pointing at a source that does not exist is refused", validateProfile2(b).some((x) => /source that does not exist/.test(x)));
  const c = rich(); c.facts.projects[0].text = "Mail me on someone@example.org"; ok("validate: contact details in a project text are refused (they belong in the locked block)", validateProfile2(c).some((x) => /contact details/.test(x)));
  const d = rich(); d.facts.languages.push({ ...d.facts.languages[0] }); ok("validate: a repeated language id is refused", validateProfile2(d).some((x) => /repeated/.test(x)));
  ok("validate: an empty v2 profile is refused only for the missing name, nothing else", validateProfile2(emptyProfile2()).join("|") === "identity.name is empty");
}
console.log(failures === 0 ? "\nall profile-v2 tests passed" : `\n${failures} profile-v2 test(s) FAILED`); process.exit(failures === 0 ? 0 : 1);
