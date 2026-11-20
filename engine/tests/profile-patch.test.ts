// applyPatch: the one door for agents. Code refuses locked writes, stamps provenance, needs the user's confirmation for trust, and records how to undo.
import { emptyProfile2, type Profile2 } from "../src/profile-v2.ts";
import { applyPatch, type PatchOp } from "../src/profile-patch.ts";
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const T = "2026-01-01T00:00:00.000Z", T1 = "2026-02-02T00:00:00.000Z";
const base = (): Profile2 => { const p = emptyProfile2(T); p.locked.identity = { name: "Sam Example", city: "Leeds", country: "UK" }; p.locked.contact.email = "sam@example.org"; p.locked.work.rightToWork = "Right to work in the UK";
  p.facts.roles = [{ id: "r1", title: "Executive", company: "Acme", location: "Leeds", start: { y: 2020, m: 1 }, end: "present", bullets: [{ id: "b1", text: "Grew the list by 40%", tags: [], meta: { origin: "typed", trust: "trusted", addedAt: T } }], meta: { origin: "typed", trust: "trusted", addedAt: T } }]; return p; };
const C = { quote: "I cut report time in half", at: T1 };
const add: PatchOp[] = [{ op: "addBullet", roleId: "r1", text: "Cut report time by half" }];

{ const r = applyPatch(base(), add, "interviewer", { now: T1 });
  ok("interviewer: an added achievement starts under review (origin said), nothing is trusted without the user's yes", r.ok && r.profile.facts.roles[0].bullets[1].meta.trust === "review" && r.profile.facts.roles[0].bullets[1].meta.origin === "said"); }
{ const r = applyPatch(base(), add, "interviewer", { now: T1, confirmation: C });
  const m = r.ok ? r.profile.facts.roles[0].bullets[1].meta : null;
  ok("interviewer + confirmation: trusted, origin said, confirmedIn conversation, the user's own words kept as the quote", !!m && m.trust === "trusted" && m.confirmedIn === "conversation" && m.quote === C.quote && m.acceptedBy === "user"); }
for (const f of ["name", "city", "country", "email", "phone", "linkedin", "rightToWork"] as const) {
  const r = applyPatch(base(), [{ op: "setLocked", field: f, value: "x" }], "interviewer", { now: T1, confirmation: C });
  ok(`locked: the interviewer can never write ${f}, even with a confirmation`, !r.ok && r.reason === "locked");
}
{ const r = applyPatch(base(), [{ op: "setLocked", field: "city", value: "York" }], "user", { now: T1 }), u = r.ok ? applyPatch(r.profile, r.undo, "user", { now: T1 }) : null;
  ok("locked: the user can change a hard fact, and the undo puts it back", r.ok && r.profile.locked.identity.city === "York" && !!u && u.ok && u.profile.locked.identity.city === "Leeds"); }
{ const r = applyPatch(base(), [{ op: "removeBullet", id: "b1" }], "interviewer", { now: T1 });
  ok("delete: an interviewer removal without the user's yes is refused", !r.ok);
  const r2 = applyPatch(base(), [{ op: "removeBullet", id: "b1" }], "interviewer", { now: T1, confirmation: C }), u = r2.ok ? applyPatch(r2.profile, r2.undo, "user", { now: T1 }) : null;
  ok("delete: with the yes it works and the undo brings the same words back", r2.ok && r2.profile.facts.roles[0].bullets.length === 0 && !!u && u.ok && u.profile.facts.roles[0].bullets[0].text === "Grew the list by 40%"); }
{ const r = applyPatch(base(), [{ op: "editBullet", id: "b1", text: "Grew the list by 45%" }], "interviewer", { now: T1 }), u = r.ok ? applyPatch(r.profile, r.undo, "user", { now: T1 }) : null;
  ok("edit: an interviewer edit of a trusted bullet drops it to review (it is no longer the user's exact words), and undo restores the text", r.ok && r.profile.facts.roles[0].bullets[0].meta.trust === "review" && !!u && u.ok && u.profile.facts.roles[0].bullets[0].text === "Grew the list by 40%"); }
{ ok("refused: unknown role, duplicate, empty, too long, contact details in text, too many ops, no ops",
    !applyPatch(base(), [{ op: "addBullet", roleId: "nope", text: "x y z" }], "interviewer", { now: T1 }).ok
    && !applyPatch(base(), [{ op: "addBullet", roleId: "r1", text: "grew the LIST by 40" }], "interviewer", { now: T1 }).ok
    && !applyPatch(base(), [{ op: "addBullet", roleId: "r1", text: "  " }], "interviewer", { now: T1 }).ok
    && !applyPatch(base(), [{ op: "addBullet", roleId: "r1", text: "x".repeat(401) }], "interviewer", { now: T1 }).ok
    && !applyPatch(base(), [{ op: "addBullet", roleId: "r1", text: "Email me at me@example.org" }], "interviewer", { now: T1 }).ok
    && !applyPatch(base(), Array.from({ length: 21 }, () => add[0]), "interviewer", { now: T1 }).ok
    && !applyPatch(base(), [], "interviewer", { now: T1 }).ok); }
{ const p = base(), snap = JSON.stringify(p); applyPatch(p, [{ op: "addSkill", name: "SQL" }, { op: "addBullet", roleId: "nope", text: "x y z" }], "interviewer", { now: T1 });
  ok("atomic: a patch with one bad operation changes nothing, and the input is never modified", JSON.stringify(p) === snap); }
{ const r = applyPatch(base(), [{ op: "addSkill", name: "SQL" }, { op: "addEducation", text: "BA Business" }, { op: "addLanguage", name: "Spanish", level: "fluent" }, { op: "addCertification", name: "Analytics", year: 2022 }, { op: "addProject", name: "Newsletter", text: "Rebuilt it" }], "interviewer", { now: T1, confirmation: C });
  ok("other fact types: skill, education, language, certificate and project are added with the same provenance, and the log records who and how to undo", r.ok && r.profile.facts.skills[0].meta.origin === "said" && r.profile.facts.languages.length === 1 && r.profile.facts.projects[0].meta.trust === "trusted" && r.profile.log.at(-1)!.actor === "interviewer" && Array.isArray(r.profile.log.at(-1)!.before)); }
{ const b = base(), r = applyPatch(b, [{ op: "addSkill", name: "SQL" }, { op: "addEducation", text: "BA Business" }, { op: "addLanguage", name: "Spanish", level: "fluent" }, { op: "addCertification", name: "Analytics" }, { op: "addProject", name: "Newsletter", text: "Rebuilt it" }, { op: "addBullet", roleId: "r1", text: "Cut report time by half" }], "interviewer", { now: T1, confirmation: C }), u = r.ok ? applyPatch(r.profile, r.undo, "user", { now: T1 }) : null;
  ok("undo: one undo takes back every kind of fact a patch added, leaving the facts exactly as they were", !!u && u.ok && JSON.stringify(u.profile.facts) === JSON.stringify(b.facts)); }
{ const r = applyPatch(base(), [{ op: "addRole", title: "Assistant", company: "Brightside", start: { y: 2018, m: 1 }, end: { y: 2020, m: 2 } }], "interviewer", { now: T1, confirmation: C }), u = r.ok ? applyPatch(r.profile, r.undo, "user", { now: T1 }) : null;
  ok("role: a confirmed job is added with provenance (said, trusted), and undo removes it", r.ok && r.profile.facts.roles.length === 2 && r.profile.facts.roles[1].meta.origin === "said" && r.profile.facts.roles[1].meta.trust === "trusted" && !!u && u.ok && u.profile.facts.roles.length === 1);
  ok("role: refused without a title or company, with an impossible month, a duplicate, and without the user's yes it starts under review", !applyPatch(base(), [{ op: "addRole", title: "", company: "X" }], "user", { now: T1 }).ok && !applyPatch(base(), [{ op: "addRole", title: "A", company: "B", start: { y: 2020, m: 13 } }], "user", { now: T1 }).ok && !applyPatch(base(), [{ op: "addRole", title: "Executive", company: "acme" }], "user", { now: T1 }).ok && (() => { const q = applyPatch(base(), [{ op: "addRole", title: "A", company: "B" }], "interviewer", { now: T1 }); return q.ok && q.profile.facts.roles[1].meta.trust === "review"; })()); }
console.log(failures === 0 ? "\nall profile-patch tests passed" : `\n${failures} profile-patch test(s) FAILED`); process.exit(failures === 0 ? 0 : 1);
