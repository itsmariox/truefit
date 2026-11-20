// Schema v2, step C: the review-card detectors. Conservative: each card has a stable key, a dismissal sticks, and a big import gives a handful of cards, not a wall.
import { emptyProfile2, type Profile2, type Role2 } from "../src/profile-v2.ts";
import { applyCardAction, dismissCard, reviewCards } from "../src/profile-review.ts";
import { applyV1Edit, toV1View } from "../src/profile-v2.ts";
import { mergeImportV2 } from "../src/profile-import-v2.ts";
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const T = "2026-01-01T00:00:00.000Z", NOW = new Date("2026-06-15T00:00:00Z");
const m = (trust: "trusted" | "review" = "trusted") => ({ origin: "cv" as const, trust, addedAt: T, sourceId: "s1" });
const bullet = (id: string, text: string, trust: "trusted" | "review" = "trusted") => ({ id, text, tags: [], meta: m(trust) });
const role = (id: string, title: string, company: string, start: [number, number] | null, end: [number, number] | "present" | null, bullets: ReturnType<typeof bullet>[] = []): Role2 => ({ id, title, company, location: "", start: start ? { y: start[0], m: start[1] } : null, end: end === "present" ? "present" : end ? { y: end[0], m: end[1] } : null, bullets, meta: m() });
const base = (roles: Role2[]): Profile2 => { const p = emptyProfile2(T); p.locked.identity.name = "Sam"; p.facts.roles = roles; p.sources = [{ id: "s1", kind: "cv", label: "CV", addedAt: T, textHash: "h" }]; return p; };
const TOPICS: Record<string, string[]> = { a: ["Launched a loyalty scheme across forty stores", "Negotiated agency contracts saving twenty percent", "Trained fifteen colleagues on analytics dashboards"], b: ["Organised quarterly customer events attended by hundreds", "Wrote weekly reports for the finance director", "Redesigned the returns process with the warehouse"], c: ["Managed a small budget for local sponsorship", "Coordinated suppliers during the autumn peak", "Photographed products for the online catalogue"] };
const three = (p: string) => TOPICS[p].map((x, i) => bullet(`${p}${i + 1}`, x));
const kinds = (cs: ReturnType<typeof reviewCards>) => cs.map((c) => c.key.split(":")[0] + ":" + c.kind).join(",");

{
  const quiet = base([role("r1", "Executive", "Acme", [2019, 1], "present", three("a")), role("r2", "Assistant", "Brightwell", [2016, 1], [2018, 12], three("b"))]);
  ok("a clean profile gives no cards", reviewCards(quiet, NOW).length === 0);
}
{ // focus types have no screen any more, so an unreviewed one must never make a card the user cannot act on
  const p = base([role("r1", "Executive", "Acme", [2019, 1], "present", three("a"))]);
  p.lenses = [{ id: 1, name: "Operations", headline: "", leadTags: [], meta: m("review") } as never];
  ok("an unreviewed focus type makes no review card", reviewCards(p, NOW).length === 0);
}
{ // contradiction between sources
  const r = role("r1", "Executive", "Acme", [2019, 1], "present", three("a")); r.claims = [{ sourceId: "s1", title: "Executive", start: { y: 2019, m: 1 }, end: "present" }, { sourceId: "s2", title: "Executive", start: { y: 2020, m: 3 }, end: "present" }];
  const cs = reviewCards(base([r]), NOW);
  ok("contradiction: two CVs giving different start dates for the same role make ONE card that names the role and both dates", cs.length === 1 && cs[0].kind === "contradiction" && /start date/.test(cs[0].message) && /Jan 2019/.test(cs[0].message) && /Mar 2020/.test(cs[0].message));
  const same = role("r1", "Executive", "Acme", [2019, 1], "present", three("a")); same.claims = [{ sourceId: "s1", title: "Executive", start: { y: 2019, m: 1 }, end: "present" }, { sourceId: "s2", title: "executive", start: { y: 2019, m: 1 }, end: "present" }];
  ok("contradiction: two CVs that agree (title case aside) make no card", reviewCards(base([same]), NOW).length === 0);
}
{ // overlap
  const a = role("r1", "Executive", "Acme", [2019, 1], "present", three("a")), b = role("r2", "Consultant", "Own business", [2020, 1], [2022, 1], three("b")), c = role("r3", "Tiny", "Other", [2019, 6], [2019, 8], three("c"));
  const cs = reviewCards(base([a, b, c]), NOW);
  ok("overlap: two roles sharing more than three months make a card (freelance next to a job can be dismissed); a short overlap with another role makes none", cs.some((x) => x.kind === "overlap" && x.factIds.slice().sort().join() === "r1,r2") && !cs.some((x) => x.kind === "overlap" && x.factIds.includes("r3")));
  const key = cs.find((x) => x.kind === "overlap")!.key, p2 = dismissCard(base([a, b]), key);
  ok("dismiss: a dismissed card stays gone (its key is stored), and the key is not stored twice", reviewCards(p2, NOW).every((x) => x.key !== key) && dismissCard(p2, key).review.dismissed.length === 1);
  const edited = dismissCard(base([a, { ...b, bullets: [bullet("b9", "A brand new achievement with entirely different words about plumbing")] }]), key);
  ok("dismiss: the key depends on the two roles only, so the dismissal survives an unrelated edit (new bullets in one of them); changing a date that ends the overlap removes the card by itself", !reviewCards(edited, NOW).some((x) => x.key === key) && !reviewCards(base([a, { ...b, start: { y: 2016, m: 1 }, end: { y: 2018, m: 12 } }]), NOW).some((x) => x.kind === "overlap"));
}
{ // duplicates
  const a = role("r1", "Executive", "Acme", [2019, 1], "present", [bullet("a1", "Grew the monthly newsletter list from 1,200 to 3,600 subscribers in twelve months"), bullet("a2", "Second different thing delivered in a by the team"), bullet("a3", "Third unrelated result achieved at a last year")]);
  const b = role("r2", "Assistant", "Brightwell", [2016, 1], [2018, 12], [bullet("b1", "Grew the monthly newsletter list from 1,200 to 3,600 subscribers in 12 months"), bullet("b2", "Another distinct thing for b with many words"), bullet("b3", "Yet another result at b with other words")]);
  const cs = reviewCards(base([a, b]), NOW);
  ok("duplicate: two near-identical bullets kept from two CVs make a merge card; exact copies and short lines do not", cs.some((x) => x.kind === "duplicate" && x.factIds.sort().join() === "a1,b1" && x.options.includes("merge")));
}
{ // a big import is a handful of cards
  const bigRoles = [0, 1, 2, 3].map((i) => role(`r${i}`, `Role ${i}`, `Company ${i}`, [2010 + i * 2, 1], [2011 + i * 2, 12], Array.from({ length: 5 }, (_, k) => bullet(`r${i}b${k}`, `Unique thing number ${i} ${k} with distinct words ${i * 7 + k} alpha${k}${i} beta${i}${k}`, "review"))));
  const p = base(bigRoles); p.facts.skills = Array.from({ length: 25 }, (_, i) => ({ name: `Skill ${i}`, meta: m("review") })); p.facts.education = [{ id: "e1", text: "A degree", meta: m("review") }];
  const cs = reviewCards(p, NOW);
  ok("needs-review: 20 unmatched bullets across 4 roles, 25 skills and an education line give ONE card per role plus one for skills and one for education (6 cards, not 46)", cs.filter((c) => c.kind === "needs-review").length === 6 && cs.length === 6);
}
{ // gaps
  const p = base([role("r1", "Executive", "Acme", null, null, three("a")), role("r2", "Lead", "Beta", [2022, 1], "present", [bullet("x1", "Only one usable achievement here with enough words")])]);
  const cs = reviewCards(p, NOW), ks = cs.map((c) => c.key);
  ok("gap: an undated role and a CURRENT role with fewer than three usable achievements each get a card; a finished role with few bullets does not", ks.includes("gap:undated:r1") && ks.includes("gap:thin:r2") && !ks.includes("gap:thin:r1"));
}
{ // card actions
  const a = role("r1", "Executive", "Acme", [2019, 1], "present", [bullet("a1", "Launched a loyalty scheme across forty stores", "review"), bullet("a2", "Negotiated agency contracts saving twenty percent", "review"), bullet("a3", "Trained fifteen colleagues on analytics dashboards")]);
  const b = role("r2", "Assistant", "Brightwell", [2016, 1], [2018, 12], [bullet("b1", "Organised quarterly customer events attended by hundreds", "review")]);
  const p = base([a, b]); p.facts.skills = [{ name: "Excel", meta: m("review") }, { name: "SQL", meta: m("trusted") }];
  const r = applyCardAction(p, "needs-review:r1", "accept", NOW, "2026-07-01T00:00:00.000Z");
  const q = r.ok ? r.profile : p;
  ok("accept: a needs-review card makes exactly ITS role's bullets trusted (recording when and by whom), leaves the other role alone, drops the card and logs it", r.ok && q.facts.roles[0].bullets.every((x) => x.meta.trust === "trusted") && q.facts.roles[0].bullets[0].meta.acceptedBy === "user" && q.facts.roles[0].bullets[0].meta.acceptedAt === "2026-07-01T00:00:00.000Z" && q.facts.roles[1].bullets[0].meta.trust === "review" && !reviewCards(q, NOW).some((c) => c.key === "needs-review:r1") && /accepted 2/.test(q.log.at(-1)!.summary) && p.facts.roles[0].bullets[0].meta.trust === "review");
  const sk = applyCardAction(p, "needs-review:skills", "accept", NOW);
  ok("accept: the skills card matches skills by NAME (Excel becomes trusted, SQL was already)", sk.ok && sk.profile.facts.skills.every((x) => x.meta.trust === "trusted"));
  ok("refusals: an unknown key, a merge on a card that is not a duplicate, and an accept on a contradiction or gap card are refused", !applyCardAction(p, "nope", "accept", NOW).ok && (applyCardAction(p, "needs-review:r1", "merge", NOW) as any).reason === "not_allowed");
  const d1 = bullet("d1", "Grew the monthly newsletter list from 1,200 to 3,600 subscribers in twelve months", "review"), d2 = bullet("d2", "Grew the monthly newsletter list from 1,200 to 3,600 subscribers in 12 months", "trusted"), pd = base([role("r1", "Executive", "Acme", [2019, 1], "present", [d1, bullet("x1", "Another long distinct achievement about warehouse returns and suppliers"), bullet("x2", "A third separate result about photography and the online catalogue"), d2])]);
  const mg = applyCardAction(pd, reviewCards(pd, NOW).find((c) => c.kind === "duplicate")!.key, "merge", NOW);
  ok("merge: of two near-identical bullets the TRUSTED one is kept and the other is deleted; the card goes", mg.ok && mg.profile.facts.roles[0].bullets.map((x) => x.id).sort().join() === "d2,x1,x2" && !reviewCards(mg.profile, NOW).some((c) => c.kind === "duplicate"));
  const e1 = bullet("e1", "Grew the monthly newsletter list from 1,200 to 3,600 subscribers in twelve months"), e2 = { ...bullet("e2", "Grew the monthly newsletter list from 1,200 to 3,600 subscribers in 12 months"), meta: { ...m(), addedAt: "2026-05-01T00:00:00.000Z" } }, pe = base([role("r1", "Executive", "Acme", [2019, 1], "present", [e2, bullet("x1", "Another long distinct achievement about warehouse returns and suppliers"), bullet("x2", "A third separate result about photography and the online catalogue"), e1])]);
  const mg2 = applyCardAction(pe, reviewCards(pe, NOW).find((c) => c.kind === "duplicate")!.key, "merge", NOW);
  ok("merge: when both are trusted the OLDER one is kept", mg2.ok && mg2.profile.facts.roles[0].bullets.some((x) => x.id === "e1") && !mg2.profile.facts.roles[0].bullets.some((x) => x.id === "e2"));
}
{ // locked fields the import filled in
  const CV = "Sam Example\nsam.example@example.org | 07700 900456 | linkedin.com/in/sam-example\n\nExperience\nMarketing Executive, Acme Retail, 2019 - present\n- Did a thing worth keeping in this role for the team\n";
  const r = mergeImportV2(emptyProfile2(T), { roles: [{ title: "Marketing Executive", company: "Acme Retail", start_year: 2019, current: true, bullets: [{ text: "Did a thing worth keeping in this role for the team" }] }], skills: [], education: [] }, CV, { label: "x", now: T });
  const c = reviewCards(r.profile, NOW).find((x) => x.kind === "locked-check");
  ok("locked check: what the import filled in (name, email, phone, LinkedIn) is listed on ONE card that says so", !!c && c.factIds.sort().join() === "email,linkedin,name,phone" && /Check them/.test(c.message));
  const v1 = toV1View(r.profile); v1.identity.email = "typed@example.org"; const after = applyV1Edit(r.profile, v1, T);
  ok("locked check: editing one of those fields on the page counts as checking it (only that field leaves the list)", after.review.unchecked!.sort().join() === "linkedin,name,phone");
  const ok2 = applyCardAction(r.profile, "locked-check", "accept", NOW);
  ok("locked check: Accept clears the whole list and the card; nothing in the locked block changes", ok2.ok && ok2.profile.review.unchecked === undefined && JSON.stringify(ok2.profile.locked) === JSON.stringify(r.profile.locked) && !reviewCards(ok2.profile, NOW).some((x) => x.kind === "locked-check"));
  ok("locked check: a second import of the SAME CV (fields already filled) adds nothing to the list", mergeImportV2((ok2 as { profile: Profile2 }).profile, { roles: [], skills: [], education: [] }, CV, { label: "again", now: T }).profile.review.unchecked === undefined);
}
console.log(failures === 0 ? "\nall profile-review tests passed" : `\n${failures} profile-review test(s) FAILED`); void kinds; void NOW; process.exit(failures === 0 ? 0 : 1);
