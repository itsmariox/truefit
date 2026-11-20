// Languages, certifications and projects (design/PROFILE-SCHEMA-v2.md, wired into the CV in phase 2): printed by CODE word for word, only when trusted, and carried
// through the v1 view, the persona text, the Checker's guaranteed text and the ATS heading list.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyV1Edit, migrateV1ToV2, toV1View, validateProfile2 } from "../src/profile-v2.ts";
import { extraLines, profileToPersona, validateProfile, type Profile } from "../src/profile.ts";
import { renderCvHtml } from "../src/cv/html.ts";
import { loadFonts } from "../src/cv/render.ts";
import { expectationsFor } from "../src/cv/ats.ts";
import { guaranteedText } from "../src/pipeline.ts";
import { buildSelection, SUMMARY } from "./helpers.ts";
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const dir = path.dirname(fileURLToPath(import.meta.url)), clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const priya: Profile = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8")), NOW = new Date("2026-11-16T12:00:00Z"), T0 = "2026-01-01T00:00:00.000Z", T1 = "2026-02-02T00:00:00.000Z";
const withExtras = (): Profile => { const p = clone(priya); p.extras = { languages: [{ id: "l1", name: "Spanish", level: "fluent", status: "verified" }, { id: "l2", name: "German", level: "basic", status: "draft" }], certifications: [{ id: "c1", name: "Analytics certificate", issuer: "Example Academy", year: 2022, status: "verified" }], projects: [{ id: "j1", name: "Newsletter rebuild", text: "Rebuilt a weekly newsletter for 12,000 readers", status: "verified" }, { id: "j2", name: "Unchecked", text: "Not confirmed yet", status: "draft" }] }; return p; };
const fonts = await loadFonts(); const body = (h: string) => h.slice(h.indexOf("<body>"));
const render = (p: Profile) => body(renderCvHtml(p, buildSelection(profileToPersona(p, NOW), 1, SUMMARY), { fonts }));

{ const p = withExtras(), h = render(p), plain = render(priya);
  ok("cv: Languages, Certifications and Projects are printed after Education, as their own headings, word for word", h.indexOf("<h2>Education</h2>") < h.indexOf("<h2>Languages</h2>") && h.indexOf("<h2>Languages</h2>") < h.indexOf("<h2>Certifications</h2>") && h.indexOf("<h2>Certifications</h2>") < h.indexOf("<h2>Projects</h2>") && h.includes("<p>Spanish (fluent)</p>") && h.includes("<p>Analytics certificate, Example Academy, 2022</p>") && h.includes("<p>Newsletter rebuild: Rebuilt a weekly newsletter for 12,000 readers</p>"));
  ok("cv: an item still waiting for a look is NOT printed, and a profile without extras prints no extra headings", !h.includes("German") && !h.includes("Unchecked") && !/<h2>(Languages|Certifications|Projects)/.test(plain)); }
{ const p = withExtras(); p.extras!.languages = [{ id: "l2", name: "German", level: "basic", status: "draft" }]; const h = render(p);
  ok("cv: a heading is not printed when every item under it is unconfirmed", !h.includes("<h2>Languages</h2>")); }
{ const p = withExtras(), sel = buildSelection(profileToPersona(p, NOW), 1, SUMMARY), heads = expectationsFor(p, sel).headings, none = expectationsFor(priya, sel).headings;
  ok("ats: the expected headings include the extras that are printed, and only those", heads.includes("LANGUAGES") && heads.includes("CERTIFICATIONS") && heads.includes("PROJECTS") && !none.includes("LANGUAGES") && !none.includes("PROJECTS")); }
{ const p = withExtras(), t = profileToPersona(p, NOW).text;
  ok("persona: the text the models read lists the trusted extras and never the unconfirmed ones", t.includes("## Languages") && t.includes("Spanish (fluent)") && t.includes("Analytics certificate") && t.includes("Newsletter rebuild") && !t.includes("German") && !t.includes("Not confirmed yet"));
  const g = guaranteedText(p, profileToPersona(p, NOW));
  ok("checker: what code printed from the extras counts as guaranteed text (a complaint about it is the Checker's mistake)", g.includes("Spanish (fluent)") && !g.includes("German"));
  ok("lines: extraLines returns the printed lines of trusted items only", JSON.stringify(extraLines(p.extras).languages) === '["Spanish (fluent)"]'); }
{ const p = withExtras();
  ok("validate: a profile with extras is valid; contact details in a project, a bad language level, a missing name and a repeated id are each refused", validateProfile(p, { requireDates: false }).length === 0
    && (() => { const a = withExtras(); a.extras!.projects[0].text = "write to me@example.org"; return validateProfile(a, { requireDates: false }).some((x) => /contact details/.test(x)); })()
    && (() => { const a = withExtras(); (a.extras!.languages[0] as any).level = "legendary"; return validateProfile(a, { requireDates: false }).some((x) => /level/.test(x)); })()
    && (() => { const a = withExtras(); a.extras!.certifications[0].name = " "; return validateProfile(a, { requireDates: false }).some((x) => /no name/.test(x)); })()
    && (() => { const a = withExtras(); a.extras!.projects[1].id = "l1"; return validateProfile(a, { requireDates: false }).some((x) => /repeated/.test(x)); })()); }
{ const m = migrateV1ToV2(withExtras(), T0);
  ok("migrate: a v1 profile with extras becomes v2 facts, and the v1 view gives back exactly what went in", m.facts.languages.length === 2 && m.facts.projects.length === 2 && (() => { try { assert.deepStrictEqual(toV1View(m), withExtras()); return true; } catch { return false; } })() && validateProfile2(m).length === 0);
  const v1 = toV1View(m); v1.extras!.languages[1].status = "verified"; v1.extras!.projects[0].text = "Rebuilt a weekly newsletter for 15,000 readers"; v1.extras!.certifications = []; v1.extras!.languages.push({ id: "lNEW", name: "French", level: "basic", status: "verified" });
  const q = applyV1Edit(m, v1, T1);
  ok("edit: a tick makes a language trusted; a changed project text becomes the user's own; a removed certification is gone; a new one is typed", q.facts.languages[1].meta.trust === "trusted" && q.facts.projects[0].meta.origin === "typed" && q.facts.certifications.length === 0 && q.facts.languages.at(-1)!.meta.origin === "typed");
  const none = toV1View(m); delete none.extras; ok("edit: a page that sends no `extras` leaves them as they were", JSON.stringify(applyV1Edit(m, none, T1).facts.languages) === JSON.stringify(m.facts.languages)); }
console.log(failures === 0 ? "\nall profile-extras tests passed" : `\n${failures} profile-extras test(s) FAILED`); process.exit(failures === 0 ? 0 : 1);
