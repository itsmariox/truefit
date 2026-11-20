// Offline tests for the HTML CV and the PDF renderer (phase 1 step 4). Fixtures only. The PDF checks use poppler (pdfinfo, pdffonts,
// pdftotext) as an INDEPENDENT oracle on this development Mac; they are skipped, loudly, if poppler or a Chromium browser is missing.
// The product's own in-process checks arrive in step 5.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { profileToPersona } = await import("../src/profile.ts");
const { renderCvHtml, ACCENTS, CV_HEADINGS } = await import("../src/cv/html.ts");
const { ChromeCliRenderer, findChrome, loadFonts } = await import("../src/cv/render.ts");
const { buildSelection, buildMaxSelection, SUMMARY } = await import("./helpers.ts");
type P = import("../src/profile.ts").Profile;
const load = (f: string): P => JSON.parse(readFileSync(path.join(dir, "fixtures", f), "utf8"));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
let failures = 0;
const ok = (name: string, cond: boolean) => { if (!cond) failures++; console.log((cond ? "PASS " : "FAIL ") + name); };
const NOW = new Date("2026-11-16T12:00:00Z");
const priya = load("profile-priya.json"), sam = load("profile-sam.json");
const fonts = await loadFonts();
const sel = (p: P, focus = 1) => buildSelection(profileToPersona(p, NOW), focus, SUMMARY);
const html = (p: P, s = sel(p), o: Partial<Parameters<typeof renderCvHtml>[2]> = {}) => renderCvHtml(p, s, { fonts, ...o });
const body = (h: string) => h.slice(h.indexOf("<body>")); // the page, without the embedded font data

// ---- HTML content (pure, always runs)
const hp = html(priya), bp = body(hp);
ok("html: identity and contact details appear in the header, created by code", bp.includes("<h1>Priya Nair</h1>") && bp.includes('href="mailto:priya.nair@example.com"') && bp.includes("07700 900123") && bp.includes("Leeds, UK") && bp.includes("British citizen"));
ok("html: the headline is the focus type's; without a focus type it falls back to the latest role's title", bp.includes("Marketing Coordinator</p>") && body(html(((): P => { const x = clone(sam); x.focusTypes = []; return x; })(), buildSelection(profileToPersona(Object.assign(clone(sam), { focusTypes: [] }), NOW), null, SUMMARY))).includes('class="headline">Volunteer Coordinator'));
ok("html: sections in the ATS order, in recency order, with dates, company and place", (() => { const idx = ["Professional Summary", "Professional Experience", "Skills", "Education"].map((h) => bp.indexOf(`<h2>${h}</h2>`)); return idx.every((i, n) => i > 0 && (n === 0 || i > idx[n - 1])); })() && bp.indexOf("Northfield Retail") < bp.indexOf("Brightside Print") && bp.includes("03/2021 – present") && bp.includes("09/2018 – 02/2021") && bp.includes("Bradford, UK"));
ok("html: no tables, images, scripts or forms (ATS-safe, one column)", !/<(table|img|script|form|svg|canvas|iframe)/i.test(bp));
ok("html: special characters are escaped; apostrophes, pound signs and percent survive; nothing is double-escaped", bp.includes("Instagram &amp; Facebook") && bp.includes("£15,000") && bp.includes("customers’") && !bp.includes("&amp;amp;"));
ok("html: a bullet's bold lead-in is bolded exactly, and the rest of the bullet is verbatim around it", (() => {
  const s = sel(rich(), 1), a = s.achievements[0], text = profileToPersona(rich(), NOW).bullets.find((b) => b.id === a.id)!.text;
  const i = text.toLowerCase().indexOf(a.bold.toLowerCase()), esc = (x: string) => x.replace(/&/g, "&amp;");
  return s.achievements.length > 0 && i >= 0 && body(html(rich(), s)).includes(`<li>${esc(text.slice(0, i))}<b>${esc(text.slice(i, i + a.bold.length))}</b>${esc(text.slice(i + a.bold.length))}</li>`);
})());
function rich(): P { const r = clone(priya); for (let i = 0; i < 6; i++) r.roles[0].bullets.push({ id: `px${i}`, tags: [], text: `Extra verified result number ${i + 11} for testing the ranges.`, status: "verified" }); return r; }
ok("INVARIANT what was checked is what is printed: every rendered bullet equals its cleaned persona bullet, even if the raw profile text has double spaces, line breaks or a smuggled contact detail", (() => {
  const m = clone(priya); m.roles[0].bullets[0].text = "Grew the  newsletter\nlist from 1,200 to 3,600 subscribers.  Write to leak@example.org or 07700 900888 for details."; // messy on purpose
  const s = sel(m); s.achievements = [{ id: "pn1", bold: "Grew  the\nnewsletter list" }]; s.roles[0].bullets = s.roles[0].bullets.filter((b) => b !== "pn1");
  const persona = profileToPersona(m, NOW), printed = [...body(html(m, s)).matchAll(/<li>(.*?)<\/li>/g)].map((x) => x[1].replace(/<\/?b>/g, "").replace(/&amp;/g, "&"));
  const want = persona.bullets.find((b) => b.id === "pn1")!.text;
  return printed.includes(want) && !/leak@|900888/.test(body(html(m, s))) && /<b>Grew the newsletter list<\/b>/.test(body(html(m, s)));
})());
ok("INVARIANT: every printed bullet is exactly a persona bullet of the selection (nothing added, nothing altered)", (() => {
  const s = sel(rich()), persona = profileToPersona(rich(), NOW);
  const printed = [...body(html(rich(), s)).matchAll(/<li>(.*?)<\/li>/g)].map((x) => x[1].replace(/<\/?b>/g, "").replace(/&amp;/g, "&"));
  const chosen = [...s.achievements.map((a) => a.id), ...s.roles.flatMap((r) => r.bullets)].map((id) => persona.bullets.find((b) => b.id === id)!.text);
  return printed.length === chosen.length && printed.every((t, i) => chosen.includes(t));
})());
ok("html: drafts, canaries and do-not-use items can never appear", !/CANARY|Photoshop|Head of Marketing|9137|7741/.test(bp)); // the page body only: the embedded font data is base64 and can contain any digits
ok("html: a draft bullet, a bullet of a draft role, a draft skill and an unknown role are refused outright", (() => {
  const s = sel(priya); const t = (mut: (x: typeof s) => void) => { const c = clone(s); mut(c); try { html(priya, c); return false; } catch { return true; } };
  return t((c) => { c.roles[0].bullets[0] = "pn5"; }) && t((c) => { c.roles[0].bullets[0] = "pd1"; }) && t((c) => { c.skills.push("CANARY-DRAFT-SKILL"); }) && t((c) => { c.roles.push({ role: "draftco", bullets: ["pd1"] }); }) && t((c) => { c.focus_id = 3; });
})());
ok("html: the accent colour is one of the presets and is applied; an unknown colour is refused", html(priya, sel(priya), { accent: "forest" }).includes(ACCENTS.forest) && (() => { try { html(priya, sel(priya), { accent: "pink" as never }); return false; } catch { return true; } })());
ok("html: inherited object names are not accent colours", ["constructor", "toString", "__proto__"].every((k) => { try { html(priya, sel(priya), { accent: k as never }); return false; } catch { return true; } }));
ok("html: a content security policy blocks every network request and script, and no element or style can fetch anything", /Content-Security-Policy" content="default-src 'none'; font-src data:; style-src 'unsafe-inline'"/.test(hp) && !/\b(src|srcset|action|data-src)=|url\((?!"data:)|@import|<link/i.test(bp + hp.slice(0, hp.indexOf("<body>")).replace(/url\("data:[^"]*"\)/g, "")));
ok("html: skills are grouped by the profile's groups (first letter capitalised), and the right-to-work line can be switched off", bp.includes("<b>Tools:</b>") && !body(html(priya, sel(priya), { showRightToWork: false })).includes("British citizen") && !body(html(sam)).includes("<b>Skills:</b>"));
ok("html: the document has a title for the PDF metadata and the font is embedded as data, not fetched", hp.includes("<title>Priya Nair - CV</title>") && hp.includes("data:font/ttf;base64,") && !/https?:\/\/(?!schema)/.test(hp.replace(/href="https?:[^"]*"/g, "")));
ok("html: all eight section headings (the five, then Languages, Certifications, Projects) are known to the ATS checks", CV_HEADINGS.length === 8 && CV_HEADINGS.slice(5).join() === "LANGUAGES,CERTIFICATIONS,PROJECTS");

// ---- PDF (needs a Chromium browser and poppler; the assertions live in pdf-suite.ts and take any PdfRenderer)
const { pdfSuite, haveOracle } = await import("./pdf-suite.ts");
const REQUIRE = !!(process.env.CI || process.env.CVAPP_REQUIRE_RENDER); // on CI a skipped render suite is a failure, not a pass
let skipped = 0;
if (!findChrome() || !haveOracle()) {
  skipped = 1;
  console.log(`SKIP pdf: needs a Chromium browser (${findChrome() ? "found" : "missing"}) and poppler (${haveOracle() ? "found" : "missing"})${REQUIRE ? " -- required here, so this is a FAILURE" : ""}`);
  if (REQUIRE) failures++;
} else {
  const minimal = clone(sam); minimal.roles = [minimal.roles[0]]; minimal.skills = []; minimal.focusTypes = [];
  // a full three-role profile with 21 typical-length bullets, filled to the budget's maximum (15 bullets), 12 skills and 2 education lines
  const mkRole = (id: string, title: string, company: string, end: P["roles"][0]["end"], n: number, start: { y: number; m: number }) => ({ id, title, company, location: "Leeds, UK", start, end, status: "verified" as const, bullets: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}`, tags: ["x"], status: "verified" as const, text: `Delivered result number ${i + 1} for the ${company} team by redesigning a manual process, cutting turnaround by ${10 + i * 3}% and keeping stakeholders informed with clear weekly updates and documented handovers.` })) });
  const full: P = { ...clone(priya), roles: [mkRole("a", "Senior Coordinator", "Alpha Ltd", "present", 9, { y: 2022, m: 1 }), mkRole("b", "Coordinator", "Beta Ltd", { y: 2021, m: 12 }, 7, { y: 2019, m: 1 }), mkRole("c", "Assistant", "Gamma Ltd", { y: 2018, m: 12 }, 5, { y: 2016, m: 1 })],
    skills: Array.from({ length: 12 }, (_, i) => ({ name: `Skill number ${i + 1}`, status: "verified" as const, group: i < 6 ? "Tools" : "Methods" })), education: [{ id: "e1", text: "BA Business Management, University of Leeds, 2013 - 2016", status: "verified" }, { id: "e2", text: "Project management certificate, 2020", status: "verified" }] };
  const fullSel = buildMaxSelection(profileToPersona(full, NOW), 1, SUMMARY);
  ok("full profile: the maximum selection really is the fullest (15 bullets, 12 skills)", fullSel.achievements.length + fullSel.roles.reduce((n, r) => n + r.bullets.length, 0) === 15 && fullSel.skills.length === 12);
  const withExtras = (b: P): P => { const x = clone(b); x.extras = { languages: [{ id: "l1", name: "Spanish", level: "fluent", status: "verified" }], certifications: [{ id: "c1", name: "Analytics certificate", issuer: "Example Academy", year: 2022, status: "verified" }], projects: [{ id: "j1", name: "Newsletter rebuild", text: "Rebuilt a weekly newsletter for 12,000 readers", status: "verified" }] }; return x; };
  const special = { ...clone(priya) }; // the bullets that carry money, a percentage, an ampersand, a curly apostrophe and the date ranges
  const specialSel = buildSelection(profileToPersona(special, NOW), 1, SUMMARY);
  specialSel.roles = [{ role: "northfield", bullets: ["pn1", "pn2", "pn3", "pn4"] }, { role: "brightside", bullets: ["pb1", "pb2", "pb3"] }]; specialSel.achievements = [];
  await pdfSuite(new ChromeCliRenderer(), fonts, [
    { label: "full", profile: full, selection: fullSel },
    { label: "priya", profile: priya, selection: sel(priya) },
    { label: "special", profile: special, selection: specialSel, mustContain: ["£15,000", "22%", "Instagram & Facebook", "customers’", "03/2021 – present", "09/2018 – 02/2021", "1,200 to 3,600"] },
    { label: "sam", profile: sam, selection: sel(sam) },
    { label: "minimal", profile: minimal, selection: buildSelection(profileToPersona(minimal, NOW), null, SUMMARY) },
    { label: "rich", profile: rich(), selection: sel(rich()) },
    { label: "extras", profile: withExtras(priya), selection: sel(priya), mustContain: ["Spanish (fluent)", "Analytics certificate, Example Academy, 2022", "Newsletter rebuild: Rebuilt a weekly newsletter for 12,000 readers"] },
  ], ok);
  { // a full CV that no longer fits once the extras are printed is trimmed by the normal fit step (bullets first), never left on two pages, and the ATS check still passes
    const { makeCv } = await import("../src/cv/fit.ts"); const fx = withExtras(full), made = await makeCv(fx, fullSel, { renderer: new ChromeCliRenderer(), fonts });
    ok("fit: a full CV with languages, a certificate and a project is trimmed to ONE page by the usual fit step and passes every ATS check, with the three extra headings in the PDF text", made.fit.ok && made.fit.pages === 1 && made.report.ok && /\nLANGUAGES\n/.test(made.text) && /\nCERTIFICATIONS\n/.test(made.text) && /\nPROJECTS\n/.test(made.text) && made.fit.droppedBullets.length > 0);
  }
}
console.log(failures === 0 ? `\nall render tests passed${skipped ? " (PDF SUITE SKIPPED: nothing was rendered)" : ""}` : `\n${failures} render test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
