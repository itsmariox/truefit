// Offline tests for the in-process ATS checks and the fit-to-one-page loop (phase 1 step 5). Fixtures only; no real data, no Claude.
// Good PDFs must pass; each deliberately broken PDF or synthetic reading must fail with the intended reason. poppler is only an oracle.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONAL } from "./personal-terms.ts";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { profileToPersona } = await import("../src/profile.ts");
const { renderCvHtml } = await import("../src/cv/html.ts");
const { ChromeCliRenderer, findChrome, loadFonts } = await import("../src/cv/render.ts");
const { readPdf, atsCheck, expectationsFor } = await import("../src/cv/ats.ts");
const { fitToOnePage, makeCv } = await import("../src/cv/fit.ts");
const { validateCvSelection } = await import("../src/cv/selection.ts");
const { buildSelection, buildMaxSelection, fullProfile, FILLER, SUMMARY } = await import("./helpers.ts");
type P = import("../src/profile.ts").Profile;
const load = (f: string): P => JSON.parse(readFileSync(path.join(dir, "fixtures", f), "utf8"));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
let failures = 0, skipped = 0;
const ok = (name: string, cond: boolean) => { if (!cond) failures++; console.log((cond ? "PASS " : "FAIL ") + name); };
const REQUIRE = !!(process.env.CI || process.env.CVAPP_REQUIRE_RENDER);
if (!findChrome()) {
  skipped = 1; console.log(`SKIP ats: needs a Chromium browser${REQUIRE ? " -- required here, so this is a FAILURE" : ""}`);
  if (REQUIRE) failures++;
  console.log(failures ? "\nats tests FAILED" : "\nall ats tests passed (SKIPPED: nothing was rendered)"); process.exit(failures ? 1 : 0);
}
const NOW = new Date("2026-11-16T12:00:00Z");
const priya = load("profile-priya.json"), sam = load("profile-sam.json");
const fonts = await loadFonts(), renderer = new ChromeCliRenderer();
const render = (p: P, s: ReturnType<typeof buildSelection>, mutate: (h: string) => string = (h) => h) => renderer.renderPdf(mutate(renderCvHtml(p, s, { fonts })));
const sel = (p: P, focus: number | null = 1) => buildSelection(profileToPersona(p, NOW), focus, SUMMARY);
const has = (errs: string[], re: RegExp) => errs.some((e) => re.test(e));
const minimal = clone(sam); minimal.roles = [minimal.roles[0]]; minimal.skills = []; minimal.focusTypes = [];
const full = fullProfile(priya), fullSel = buildMaxSelection(profileToPersona(full, NOW), 1, SUMMARY);
const specialSel = sel(priya); specialSel.roles = [{ role: "northfield", bullets: ["pn1", "pn2", "pn3", "pn4"] }, { role: "brightside", bullets: ["pb1", "pb2", "pb3"] }]; specialSel.achievements = [];
const goods: [string, P, ReturnType<typeof sel>][] = [["priya", priya, sel(priya)], ["sam", sam, sel(sam)], ["minimal", minimal, sel(minimal, null)], ["full", full, fullSel], ["special", priya, specialSel]];

// ---- 1. good PDFs pass, and the in-process reader agrees with poppler
const oracle = (() => { try { execFileSync("/opt/homebrew/bin/pdfinfo", ["-v"], { stdio: "ignore" }); return true; } catch { return false; } })();
const tmp = mkdtempSync(path.join(os.tmpdir(), "cvapp-ats-"));
for (const [label, p, s] of goods) {
  const pdf = await render(p, s), parsed = await readPdf(pdf), rep = atsCheck(parsed, expectationsFor(p, s));
  ok(`good ${label}: every ATS check passes with no warnings (${parsed.pages} page, ${parsed.fonts.length} fonts)`, rep.ok && rep.errors.length === 0 && rep.warnings.length === 0 && parsed.pages === 1 && parsed.tagged && parsed.imageOps === 0 && parsed.fonts.every((f) => f.embedded));
  if (oracle) {
    const f = path.join(tmp, `${label}.pdf`); writeFileSync(f, pdf);
    const pop = execFileSync("/opt/homebrew/bin/pdftotext", [f, "-"], { encoding: "utf8" }), pages = Number((execFileSync("/opt/homebrew/bin/pdfinfo", [f], { encoding: "utf8" }).match(/Pages:\s+(\d+)/) ?? [])[1]);
    const mine = parsed.text.replace(/[^a-z0-9]/gi, "").toLowerCase();
    ok(`good ${label}: the in-process reader agrees with poppler (same page count, every substantial line of poppler's text is in ours)`, pages === parsed.pages && pop.split("\n").filter((l) => l.trim().length > 25).every((l) => mine.includes(l.replace(/[^a-z0-9]/gi, "").toLowerCase())));
  }
}
{ const parsed = await readPdf(await render(priya, specialSel)); const one = parsed.text.replace(/\s+/g, " ");
  ok("good special: £15,000, 22%, an ampersand, a curly apostrophe and date ranges with an en dash come out of the in-process reader exactly", ["£15,000", "22%", "Instagram & Facebook", "customers’", "03/2021 – present", "09/2018 – 02/2021", "1,200 to 3,600"].every((s) => one.includes(s))); }

// ---- 2. deliberately broken real PDFs
const base = (mut: (h: string) => string, p = priya, s = sel(p)) => render(p, s, mut).then(async (pdf) => atsCheck(await readPdf(pdf), expectationsFor(p, s)));
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const r1 = await base((h) => h.replace("default-src 'none';", "default-src 'none'; img-src data:;").replace("<h2>Professional Summary</h2>", `<h2>Professional Summary</h2><img alt="" width="40" height="40" src="data:image/png;base64,${png}">`));
ok("broken: an image in the PDF is refused", !r1.ok && has(r1.errors, /image/));
// (A real ligature glyph cannot be produced with the bundled font: it has no such glyph and Chrome writes the two letters instead, so this check is exercised on a synthetic reading.)
const goodForLig = await readPdf(await render(priya, sel(priya)));
const r2 = atsCheck({ ...goodForLig, text: goodForLig.text.replace("Builds", "Buildﬁ") }, expectationsFor(priya, sel(priya)));
ok("broken: a ligature glyph (the single character fi) in the text is refused", !r2.ok && has(r2.errors, /ligature/));
const r3 = await base((h) => h.replace("<body>", '<body><div style="display:flex;flex-direction:column-reverse">').replace("</body>", "</div></body>"));
ok("broken: a layout whose visual order differs from the content-stream order is refused (headings out of order and stream mismatch)", !r3.ok && (has(r3.errors, /out of order/) || has(r3.errors, /stream order/)));
const r4 = await base((h) => h.replace(/<title>.*?<\/title>/, "<title></title>"));
ok("broken: a PDF with no document title is refused", !r4.ok && has(r4.errors, /title/));
const handmade = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 52>>stream\nBT /F1 12 Tf 72 700 Td (Plain text in an unembedded font) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
const r5 = atsCheck(await readPdf(Buffer.from(handmade)), expectationsFor(priya, sel(priya)));
ok("broken: a font that is not embedded (here Helvetica) is refused", !r5.ok && has(r5.errors, /not embedded/));
const smuggle = clone(priya); smuggle.roles[0].bullets[0].text += " Write to leak@example.org";
const r6 = await base((h) => h, smuggle, sel(smuggle));
ok("broken: a masked contact detail in the CV text is refused (placeholder text)", !r6.ok && has(r6.errors, /placeholder or a masked contact/));
const undefSel = sel(priya); undefSel.summary = "Builds practical programmes that teams adopt, from undefined results to steady delivery. Brings clear reporting to busy teams.";
const r7 = atsCheck(await readPdf(await render(priya, undefSel)), expectationsFor(priya, undefSel));
ok("broken: the word undefined in the text is refused", !r7.ok && has(r7.errors, /placeholder/));

// a hand-made PDF with a real Type 3 font (no third-party font needed): proves the reader really reports Type 3 and the check refuses it
const t3content = "BT /F1 12 Tf 72 700 Td (aaa) Tj ET", t3proc = "1000 0 0 0 1000 1000 d1\n0 0 800 800 re f";
const t3pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${t3content.length}>>stream\n${t3content}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type3/FontBBox[0 0 1000 1000]/FontMatrix[0.001 0 0 0.001 0 0]/CharProcs<</sq 6 0 R>>/Encoding<</Type/Encoding/Differences[97/sq]>>/FirstChar 97/LastChar 97/Widths[1000]>>endobj\n6 0 obj<</Length ${t3proc.length}>>stream\n${t3proc}\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
const t3 = await readPdf(Buffer.from(t3pdf));
ok("type 3: a real Type 3 font in a real PDF is reported as Type 3 by the reader, and the check refuses it", t3.fonts.length === 1 && t3.fonts[0].type3 === true && t3.fonts[0].kind === "Type 3" && has(atsCheck(t3, expectationsFor(priya, sel(priya))).errors, /Type 3/));
// real columns: CSS multi-column layout. Visual rows interleave the columns while the content stream reads column by column.
const cols = await base((h) => h.replace("<h2>Professional Experience</h2>", '<div style="column-count:2;column-gap:20pt"><h2>Professional Experience</h2>').replace("<h2>Skills</h2>", "</div><h2>Skills</h2>"), full, fullSel);
ok("columns: a two-column layout (rows interleave the columns, the content stream reads column by column) is refused", !cols.ok && has(cols.errors, /missing or altered/) && cols.errors.length >= 6); // the columns split every bullet across interleaved rows, so the whole bullets are not found
const goodForOverlap = await readPdf(await render(priya, sel(priya)));
ok("overlap: no good CV has overlapping text runs, and overlapping text is refused", [goodForOverlap].every((g) => g.overlaps === 0) && has(atsCheck({ ...goodForOverlap, overlaps: 2 }, expectationsFor(priya, sel(priya))).errors, /overlap/));
ok("stream order: a swap of two bullets in the content stream alone (layout unchanged) is caught, now for every bullet and not a sample", (() => { const g = goodForOverlap, e = expectationsFor(priya, sel(priya)); const [x, y] = [e.bullets[e.bullets.length - 2], e.bullets[e.bullets.length - 1]]; const sw = g.streamText.replace(x, "@@X@@").replace(y, x).replace("@@X@@", y); return sw !== g.streamText && has(atsCheck({ ...g, streamText: sw }, e).errors, /stream order/); })());

// ---- 3. expectation mismatches on a good PDF (name, contact, headings, bullets, order)
const good0 = await readPdf(await render(priya, sel(priya))), e0 = expectationsFor(priya, sel(priya)), good0special = await readPdf(await render(priya, specialSel));
ok("mismatch: a wrong name, a missing email, a missing location line and a missing right-to-work line are each reported", has(atsCheck(good0, { ...e0, name: "Someone Else" }).errors, /name is missing/) && has(atsCheck(good0, { ...e0, email: "nobody@example.net" }).errors, /email is missing/) && has(atsCheck(good0, { ...e0, locationLine: "Atlantis" }).errors, /location line/) && has(atsCheck(good0, { ...e0, rightToWork: "Martian" }).errors, /right-to-work/));
ok("mismatch: a missing or out-of-order heading is reported", has(atsCheck(good0, { ...e0, headings: [...e0.headings, "CERTIFICATIONS"] }).errors, /"CERTIFICATIONS" not found/) && has(atsCheck(good0, { ...e0, headings: [...e0.headings].reverse() }).errors, /out of order/));
ok("mismatch: an altered bullet is reported as missing, and bullets in the wrong order are reported", has(atsCheck(good0, { ...e0, bullets: [...e0.bullets, "A bullet that was never printed on this page"] }).errors, /missing or altered/) && has(atsCheck(good0, { ...e0, bullets: [...e0.bullets].reverse() }).errors, /intended order/));
ok("synthetic: untagged PDFs and a hundred-character text are judged correctly (untagged is a warning; almost no text is an error)", (() => { const a = atsCheck({ ...good0, tagged: false }, e0), b = atsCheck({ ...good0, text: "tiny", streamText: "tiny" }, e0); return a.ok && has(a.warnings, /tagged/) && !b.ok && has(b.errors, /readable characters/); })());
ok("synthetic: font, image, private-use and replacement-character failures are each reported", has(atsCheck({ ...good0, fonts: [{ name: "Arial", embedded: false, type3: false, kind: "TrueType" }] }, e0).errors, /Arial/) && has(atsCheck({ ...good0, imageOps: 2 }, e0).errors, /2 image/) && has(atsCheck({ ...good0, text: good0.text + "" }, e0).errors, /private-use/) && has(atsCheck({ ...good0, streamText: good0.streamText + "�" }, e0).errors, /private-use/));

ok("exact: a garbled pound sign, a percent sign, an en dash in a date range, an ampersand or a curly apostrophe is reported even though letters and digits still match", (() => {
  const sp = expectationsFor(priya, specialSel), g = good0special;
  const bad = (from: string, to: string) => atsCheck({ ...g, text: g.text.replace(from, to) }, sp);
  // missing glyphs are the realistic failure: the symbol silently disappears, letters and digits still match, so only an exact comparison sees it
  return has(bad("£15,000", "15,000").errors, /garbled/) && has(bad("22%", "22").errors, /garbled/) && has(bad("Instagram & Facebook", "Instagram Facebook").errors, /garbled/) && has(bad("customers’ questions", "customers questions").errors, /garbled/) && has(bad("03/2021 – present", "03/2021 present").errors, /date range/) && has(bad("priya.nair@example.com", "priya.nair@example.co").errors, /email/) && has(bad("£15,000", "E15,000").errors, /garbled|missing or altered/);
})());
ok("fonts: the report carries each font's storage type; the bundled font is a normal TrueType font, never Type 3", good0.fonts.length === 3 && good0.fonts.every((f) => f.kind.length > 0 && !f.type3 && f.embedded) && atsCheck(good0, e0).fonts === good0.fonts);
ok("fonts: a Type 3 font is refused (a product decision: TrueType only), while an embedded TrueType font passes", has(atsCheck({ ...good0, fonts: [{ name: "AAAAAA+Some-Font", embedded: true, type3: true, kind: "Type 3" }] }, e0).errors, /Type 3/) && atsCheck({ ...good0, fonts: [{ name: "AAAAAA+Some-Font", embedded: true, type3: false, kind: "TrueType" }] }, e0).ok);

// ---- 4. the page-count override is the ONLY override
const wordy = fullProfile(priya, FILLER.repeat(2)), // about 44 words per bullet: a full selection runs to 2 pages
   wordySel = buildMaxSelection(profileToPersona(wordy, NOW), 1, SUMMARY);
const wordyPdf = await readPdf(await render(wordy, wordySel));
ok("override: a wordy full CV runs to 2 pages; the page rule alone fails it", wordyPdf.pages === 2 && has(atsCheck(wordyPdf, expectationsFor(wordy, wordySel)).errors, /2 pages/));
const ov = atsCheck(wordyPdf, expectationsFor(wordy, wordySel, { allowMultiPage: true }));
ok("override: 'deliver anyway' turns exactly the 2-page error into a warning and nothing else", ov.ok && ov.overflow && has(ov.warnings, /2 pages/));
ok("override: it never covers 3 pages, or any other failure (ligature, font, image, order)", has(atsCheck({ ...wordyPdf, pages: 3 }, expectationsFor(wordy, wordySel, { allowMultiPage: true })).errors, /3 pages/) && !atsCheck({ ...wordyPdf, text: wordyPdf.text + "ﬁ" }, expectationsFor(wordy, wordySel, { allowMultiPage: true })).ok && !atsCheck({ ...wordyPdf, imageOps: 1 }, expectationsFor(wordy, wordySel, { allowMultiPage: true })).ok);

const huge3 = fullProfile(priya, FILLER.repeat(6)), huge3Sel = buildMaxSelection(profileToPersona(huge3, NOW), 1, SUMMARY);
const m3 = await makeCv(huge3, huge3Sel, { renderer, fonts, allowMultiPage: true });
ok("override (real PDF): even with 'deliver anyway' a CV of 3 or more pages is still refused", m3.report.pages >= 3 && !m3.report.ok && has(m3.report.errors, /pages; one page is the target/));

// ---- 5. the fit loop
const o = { renderer, fonts };
const fit0 = await fitToOnePage(full, fullSel, o);
ok("fit: a CV that already fits is rendered once and nothing is dropped", fit0.ok && fit0.renders === 1 && fit0.droppedBullets.length === 0 && fit0.pages === 1);
const fit1 = await fitToOnePage(wordy, wordySel, o), ctxW = profileToPersona(wordy, NOW);
ok("fit: a CV that runs over is trimmed until it fits, dropping only bullets", fit1.ok && fit1.pages === 1 && fit1.droppedBullets.length > 0 && fit1.droppedSkills.length === 0 && fit1.renders === fit1.droppedBullets.length + 1);
ok("fit: what is dropped is the least relevant (the END of each list); what is kept is a prefix, in order, with nothing altered", fit1.selection.roles.every((r, i) => r.bullets.every((b, j) => b === wordySel.roles[i].bullets[j])) && fit1.selection.achievements.length === wordySel.achievements.length && JSON.stringify(fit1.selection.achievements) === JSON.stringify(wordySel.achievements) && fit1.selection.summary === wordySel.summary);
ok("fit: the trimmed selection is still a VALID selection (every role at or above its floor, achievements untouched)", validateCvSelection(fit1.selection, ctxW).errors.length === 0 && fit1.selection.roles.every((r) => r.bullets.length >= 1));
ok("fit: the exact order of removal is deterministic: the role with the most spare bullets first, the oldest role on a tie (a5, b3, a4, c1, b2, a3 ...)", (() => {
  const want = ["a5", "b3", "a4", "c1", "b2", "a3"]; // hand-worked from roles a (6 bullets, floor 3), b (4, floor 2), c (2, floor 1): spare 3/2/1, then ties go to the older role
  return fit1.droppedBullets.length > 0 && fit1.droppedBullets.every((id, i) => id === want[i]);
})());
const huge = fullProfile(priya, FILLER.repeat(6)), hugeSel = buildMaxSelection(profileToPersona(huge, NOW), 1, SUMMARY);
const fit2 = await fitToOnePage(huge, hugeSel, { ...o, maxRenders: 60 });
ok("fit: when it cannot fit at the normal minimums it says so plainly instead of delivering or looping", !fit2.ok && /normal minimums/.test(fit2.reason ?? "") && fit2.pages > 1);
const fit3 = await fitToOnePage(huge, hugeSel, { ...o, shorter: true, maxRenders: 60 });
ok("fit: 'shorter version' mode goes below the floors (one bullet per role, then achievements) and reaches one page or says it cannot", fit3.pages === 1 ? (fit3.ok && fit3.droppedBullets.length > fit2.droppedBullets.length) : (!fit3.ok && /one bullet per role/.test(fit3.reason ?? "")));
const m1 = await makeCv(wordy, wordySel, o);
ok("makeCv: fits, then passes every ATS check on the final PDF", m1.fit.ok && m1.report.ok && m1.report.pages === 1 && m1.report.warnings.length === 0);
const m2 = await makeCv(wordy, wordySel, { ...o, allowMultiPage: true });
ok("makeCv: with 'deliver anyway' the full selection is delivered untouched on 2 pages, with a warning, and every other check still ran", m2.report.ok && m2.report.pages === 2 && m2.fit.droppedBullets.length === 0 && JSON.stringify(m2.fit.selection) === JSON.stringify(wordySel) && m2.report.warnings.length === 1);

// ---- 6. hygiene
const srcs = ["ats.ts", "fit.ts"].map((f) => readFileSync(path.join(dir, "..", "src", "cv", f), "utf8")).join("");
ok("the new modules contain no employer, person or place names", !PERSONAL.test(srcs));
rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? `\nall ats tests passed${skipped ? " (SKIPPED)" : ""}` : `\n${failures} ats test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
