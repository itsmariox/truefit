// Phase 5: the profile handlers on the REAL core (real database), engine validator and start gate. Nothing the page sends is trusted.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startApp } from "../src/main/core/app-core.ts";
import { createHost } from "../src/main/core/host.ts";
import { createProfileHandlers, plainProblems } from "../src/main/profile-handlers.ts";
import { rig, priya } from "./core-rig.ts";
import { fakeQuery } from "../src/main/core/fake-claude.ts";
import { channels, INVALID } from "../src/shared/contract.ts";
import { profileToPersona } from "../../engine/src/profile.ts";
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-prof-")); mkdirSync(path.join(root, "tmp"));
const clone = () => JSON.parse(JSON.stringify(priya));
try {
  const R = rig(root); const host = createHost({ start: () => startApp(R.deps()), onReady: () => undefined }); await host.start();
  const h = createProfileHandlers({ host });
  const none = await h["profile:get"](undefined);
  ok("1. a new install has no profile: status 'none' and all five start-gate needs listed in plain words (name and city, email and country, a role, where you work, right to work)", none.status === "none" && none.profile === null && !none.gate.ok && none.gate.missing.length === 5 && none.gate.missing[1] === "your email and country");
  const empty = clone(); empty.identity.name = "  "; const bad = await h["profile:save"]({ profile: empty, baseUpdatedAt: undefined });
  ok("2. a profile with no name is refused with a plain sentence (not 'identity.name is empty') and nothing is saved", !bad.ok && bad.errors.join(" ").includes("Your name is empty") && (await h["profile:get"](undefined)).status === "none");
  const leak = clone(); leak.roles[0].bullets[0].text = "Call me on priya@example.com"; const lk = await h["profile:save"]({ profile: leak, baseUpdatedAt: undefined });
  ok("3. an email address typed into a bullet is refused, naming the ROLE (not an internal id) and saying contact details belong in Hard facts", !lk.ok && lk.errors.some((e) => e.includes("Marketing Coordinator at Northfield Retail") && /Hard facts section/.test(e)) && !lk.errors.join(" ").includes("pn1"));
  const good = await h["profile:save"]({ profile: clone(), baseUpdatedAt: undefined });
  ok("4. a good profile is saved and the gate says ready", good.ok && good.gate.ok && good.gate.missing.length === 0 && (await h["profile:get"](undefined)).status === "ok");
  const fs1 = clone(); fs1.focusTypes = [{ id: 1, name: "Ops", headline: "Operations lead", leadTags: ["ops"], status: "verified" }, { id: 2, name: "Growth", headline: "", leadTags: [], status: "draft" }]; fs1.roles[0].story = { text: "I turned the team around.", status: "draft" }; fs1.roles[0].bullets[0].onlyForFocus = [1];
  const fsr = await h["profile:save"]({ profile: fs1, baseUpdatedAt: undefined }); const fsg: any = await h["profile:get"](undefined);
  ok("4b. a profile with focus types, a draft story and a bullet limited to a focus type is accepted by the engine and comes back unchanged", fsr.ok && fsg.profile.focusTypes.length === 2 && fsg.profile.roles[0].story.status === "draft" && fsg.profile.roles[0].bullets[0].onlyForFocus[0] === 1);
  const fs2 = clone(); fs2.focusTypes = [{ id: 1, name: "A", headline: "h", leadTags: [], status: "verified" }, { id: 1, name: "B", headline: "h", leadTags: [], status: "verified" }];
  ok("4c. two focus types with the same number are refused by the engine", !(await h["profile:save"]({ profile: fs2, baseUpdatedAt: undefined })).ok);
  const thin = clone(); thin.roles.forEach((r: any) => r.bullets.forEach((b: any, i: number) => { if (i > 0) b.status = "draft"; })); thin.rules.rightToWork.statement = "";
  const t = await h["profile:save"]({ profile: thin, baseUpdatedAt: undefined });
  ok("5. saving a profile that is not ready is allowed (work in progress) and the gate lists what is still needed: 3 verified bullets and the right to work", t.ok && !t.gate.ok && t.gate.missing.join("|") === "one role with at least 3 verified bullets|your right to work" && !t.warnings.some((w) => /not ready to build/.test(w)));
  const got = await h["profile:get"](undefined); ok("6. what was saved is what comes back (including the drafts)", got.status === "ok" && JSON.stringify(got.profile).includes('"draft"'));
  const again = await h["profile:save"]({ profile: { ...clone(), schemaVersion: 99 }, baseUpdatedAt: undefined });
  ok("7. a profile from a different version is refused in plain words", !again.ok && again.errors.some((e) => /different version/.test(e)));
  ok("8. the contract refuses a non-object, an array, and anything over 400,000 characters before it reaches the handler", channels["profile:save"].request({ profile: "x" }) === INVALID && channels["profile:save"].request({ profile: [] }) === INVALID && channels["profile:save"].request({ profile: { a: "x".repeat(400_001) } }) === INVALID && channels["profile:save"].request({ profile: {}, extra: 1 }) === INVALID && channels["profile:save"].request({ profile: clone() }) !== INVALID);
  ok("9. plain problems never show raw ids for roles, bullets or the schema", plainProblems(priya as never, ["role northfield: title and company are required", "bullet pn2 is empty", "schemaVersion is 3; this engine reads version 1"]).join("|") === "Marketing Coordinator at Northfield Retail: title and company are required|a bullet of Marketing Coordinator at Northfield Retail is empty|This profile was made by a different version of the app.");
  // ---- CV import (fake Claude only) ----
  const controls = { importAnswer: { roles: [{ title: "Marketing Coordinator", company: "Northfield Retail", location: "Leeds", start_year: 2021, start_month: 3, end_year: null, end_month: null, current: true, bullets: [{ text: "Grew the newsletter list from 1,200 to 3,600 subscribers in 12 months.", tags: ["email"] }] }], skills: ["Google Analytics"], education: [] } as unknown, seen: [] as { role: string; prompt: string }[] };
  let tick = 0; // a clock that moves on EVERY reading, so two readings in one action can never agree by luck
  const R2 = rig(path.join(root, "imp") && (mkdirSync(path.join(root, "imp", "tmp"), { recursive: true }), path.join(root, "imp"))); const host2 = createHost({ start: () => startApp({ ...R2.deps(), now: () => new Date(Date.parse("2026-11-18T10:00:00Z") + 7 * tick++), query: ((a: any) => fakeQuery(priya, controls)(a)) as never }), onReady: () => undefined }); await host2.start(); const h2 = createProfileHandlers({ host: host2 }); const c2 = host2.core()!; c2.access.chooseMode("subscription"); c2.access.acceptNotice();
  const CV = "Sam Example\nsam@example.com | 07700 900456 | linkedin.com/in/sam\nMarketing Coordinator, Northfield Retail, Leeds, March 2021 - Present\n- Grew the newsletter list from 1,200 to 3,600 subscribers in 12 months.\nSkills: Google Analytics\n";
  const tooShort = await h2["profile:import"]({ text: "hi" }); ok("12. a text that is too short is refused before any call", tooShort.status === "refused" && tooShort.reason === "too_short" && controls.seen.length === 0);
  const imp = await h2["profile:import"]({ text: CV });
  ok("13. ONE call is made; what was sent holds the CV but no email, phone or LinkedIn link", imp.status === "ok" && controls.seen.length === 1 && controls.seen[0].role === "importer" && /Northfield Retail/.test(controls.seen[0].prompt) && !/sam@example|07700|linkedin\.com/.test(controls.seen[0].prompt));
  const gotAfter: any = await h2["profile:get"](undefined);
  ok("14. (behaviour change, schema v2) the import SAVES at once: the role, bullet and skill the CV really contains are TRUSTED (verified in the page's shape), the stored profile is no longer 'none', and the page gets the saved time", imp.status === "ok" && imp.added.roles === 1 && imp.added.bullets === 1 && imp.added.skills === 1 && gotAfter.status === "ok" && gotAfter.updatedAt === imp.updatedAt && JSON.stringify(imp.profile).includes('"verified"') && !JSON.stringify(imp.profile).includes('"draft"') && imp.upgraded === 0);
  ok("14b. contacts and the proposed name were read from the RAW CV by code and sit in the locked block: the email and phone are in the saved profile although none was sent to Claude, and the name is proposed", gotAfter.profile.identity.email === "sam@example.com" && gotAfter.profile.identity.phone === "07700 900456" && gotAfter.profile.identity.name === "Sam Example" && (imp as any).proposedName === "Sam Example");
  { const stale: any = await h2["profile:save"]({ profile: gotAfter.profile, baseUpdatedAt: "2000-01-01T00:00:00.000Z" }); const fresh: any = await h2["profile:save"]({ profile: gotAfter.profile, baseUpdatedAt: gotAfter.updatedAt });
    ok("14c. a save made from a page opened BEFORE the import is refused with a plain sentence and changes nothing (an open editor can no longer wipe imported facts); a save from the current time is accepted and returns a new time", stale.ok === false && /changed somewhere else/.test(stale.errors[0]) && fresh.ok === true && typeof fresh.updatedAt === "string"); }
  { // languages, certificates and projects through the real save and read (phase 2)
    const cur: any = await h2["profile:get"](undefined), p = JSON.parse(JSON.stringify(cur.profile));
    p.extras = { languages: [{ id: "l1", name: "Spanish", level: "fluent", status: "verified" }], certifications: [{ id: "c1", name: "Analytics certificate", issuer: "Example Academy", year: 2022, status: "verified" }], projects: [{ id: "j1", name: "Newsletter rebuild", text: "Rebuilt a weekly newsletter", status: "draft" }] };
    const sv: any = await h2["profile:save"]({ profile: p, baseUpdatedAt: cur.updatedAt }), back: any = await h2["profile:get"](undefined);
    ok("15x. languages, certificates and projects are saved and come back on the page's profile, and the CV text the models read lists only the trusted ones", sv.ok && back.profile.extras?.languages[0].name === "Spanish" && back.profile.extras.certifications[0].year === 2022 && back.profile.extras.projects[0].status === "draft" && profileToPersona(back.profile).text.includes("Spanish (fluent)") && !profileToPersona(back.profile).text.includes("Newsletter rebuild"));
    const bad = JSON.parse(JSON.stringify(back.profile)); bad.extras.projects[0].text = "mail me at me@example.org"; const refused: any = await h2["profile:save"]({ profile: bad, baseUpdatedAt: back.updatedAt });
    ok("15y. a project with contact details in it is refused with a plain reason and nothing is saved", !refused.ok && refused.errors.some((e: string) => /Contact details belong/.test(e)) && (await h2["profile:get"](undefined) as any).profile.extras.projects[0].text === "Rebuilt a weekly newsletter");
    { const g: any = await h2["profile:get"](undefined), s1: any = await h2["profile:save"]({ profile: g.profile, baseUpdatedAt: g.updatedAt }), s2: any = await h2["profile:save"]({ profile: g.profile, baseUpdatedAt: s1.updatedAt });
      ok("15v. two Saves in a row, each using the time the last one returned as its base (on the moving clock), both succeed, and the returned time is the stored one", s1.ok && s2.ok && s2.updatedAt === (await h2["profile:get"](undefined) as any).updatedAt); }
  }
  { const ps = plainProblems(priya as any, ["language l9 has no name", "project j2 needs a description of up to 400 characters", "certification c1 has a year outside 1950 to 2100", "language l1 has level \"x\"", "extras has more than 30 projects"]).join(" | ");
    ok("15z. extras problems are plain sentences with no internal ids", !/\b(l9|j2|c1|l1)\b/.test(ps) && /A language has no name/.test(ps) && /short description/.test(ps) && /between 1950 and 2100/.test(ps) && /Pick a level/.test(ps) && /up to 30/.test(ps)); }
  { // review cards through the bridge (phase 2)
    const ov = await h2["profile:overview"](undefined), lk = ov.cards.find((c) => c.kind === "locked-check");
    ok("15a. the overview lists a card for what the import filled in (name, email, phone, LinkedIn), computed from the STORED profile, and lists the CV it came from", !!lk && /email/.test(lk.message) && ov.sources.length === 1 && ov.sources[0].kind === "cv");
    const bad = await h2["profile:card"]({ key: "does-not-exist", action: "accept" }), wrong = await h2["profile:card"]({ key: "locked-check", action: "merge" });
    ok("15b. an unknown card key, or an action the card does not allow (merge on a details card), is refused and changes nothing", !bad.ok && (bad as any).reason === "no_card" && !wrong.ok && (wrong as any).reason === "not_allowed" && (await h2["profile:overview"](undefined)).cards.some((c) => c.kind === "locked-check"));
    const done = await h2["profile:card"]({ key: "locked-check", action: "accept" });
    ok("15c. Accept on that card clears it, returns the saved profile in the page's shape with a new saved time and the fresh overview, and the stored profile now carries the change", done.ok && !done.overview.cards.some((c) => c.kind === "locked-check") && typeof done.updatedAt === "string" && (done.profile as any).schemaVersion === 1 && !JSON.stringify(done.profile).includes("\"meta\"") && Array.isArray((done as any).overview?.cards) && (done.profile as any).identity.email === "sam@example.com" && !(await h2["profile:overview"](undefined)).cards.some((c) => c.kind === "locked-check"));
    { const g: any = await h2["profile:get"](undefined), sv2: any = await h2["profile:save"]({ profile: g.profile, baseUpdatedAt: done.ok ? done.updatedAt : "x" });
      ok("15w. after a card action the saved time handed back IS the stored one (on a clock that moves on every reading), so the very next Save with that time as its base is accepted, not refused as stale", done.ok && done.updatedAt === g.updatedAt && sv2.ok); }
  }
  const R3 = rig(path.join(root, "imp3") && (mkdirSync(path.join(root, "imp3", "tmp"), { recursive: true }), path.join(root, "imp3"))); const host3 = createHost({ start: () => startApp(R3.deps()), onReady: () => undefined }); await host3.start(); const c3 = host3.core()!; c3.access.chooseMode("subscription"); c3.access.acceptNotice(); R3.script.next = "auth";
  const failed = await createProfileHandlers({ host: host3 })["profile:import"]({ text: CV });
  ok("15. when Claude is not signed in the answer is the approved plain sign-in message (no error text) and nothing is added", failed.status === "refused" && failed.reason === "claude" && failed.message?.title === "Claude needs you to sign in again");
  await c2.shutdown({ finalBackup: false }); await c3.shutdown({ finalBackup: false });
  await host.core()!.shutdown({ finalBackup: false });
} finally { rmSync(root, { recursive: true, force: true }); }
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); } else console.log("\nALL PASS");
