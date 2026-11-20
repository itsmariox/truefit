// Offline tests for font coverage (phase 1 step 5 review). The bundled font is new, so which characters it really has matters: a missing glyph
// makes Chrome print the character in another system font (arrows and emoji end up as Type 3 fonts), which the ATS check refuses. Fixtures only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { profileToPersona } = await import("../src/profile.ts");
const { renderCvHtml, unsupportedInProfile, UnsupportedCharactersError } = await import("../src/cv/html.ts");
const { fontCoverage } = await import("../src/cv/fontcoverage.ts");
const { ChromeCliRenderer, findChrome, loadFonts, FONTS_DIR } = await import("../src/cv/render.ts");
const { readPdf, atsCheck, expectationsFor } = await import("../src/cv/ats.ts");
const { buildSelection, SUMMARY } = await import("./helpers.ts");
type P = import("../src/profile.ts").Profile;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
let failures = 0;
const ok = (name: string, cond: boolean) => { if (!cond) failures++; console.log((cond ? "PASS " : "FAIL ") + name); };
const NOW = new Date("2026-11-16T12:00:00Z");
const priya: P = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8"));
const fonts = await loadFonts(), covers = fonts.covers!;

const SUPPORTED = { accents: "Zoë, Siobhán, Łukasz, Nguyễn, café, Müller, Škoda, Ångström, naïve, façade, ő, ñ", currency: "€2,400 and £15,000 and $500K and ¥100", arrows: "Moved data A → B and B ← C", punct: "“smart quotes”, ‘single’, – en, — em, … ellipsis, • bullet, · dot, ½ and ¼, × and ÷, ± and °, ™ ® ©" };
const UNSUPPORTED = { doubleArrow: "Implication ⇒ done", emoji: "Shipped 🚀 on time ✅" }; // the font has the single arrows → and ← but not the double arrow or emoji (checked against its cmap table and against Chrome)
const all = (o: Record<string, string>) => [...Object.values(o).join("")].filter((c) => !/\s/.test(c));
ok("coverage: the font's own table says which characters it has (letters, accents, Vietnamese, currency, quotes, dashes, fractions yes; arrows and emoji no)", all(SUPPORTED).every((c) => covers(c.codePointAt(0)!)) && !covers(0x21d2) && !covers(0x1f680) && !covers(0x2705) && covers(0x2192));

const profileWith = (cases: Record<string, string>): P => { const p = clone(priya); p.identity.name = "Siobhán Nguyễn-Łukasz"; p.roles[0].company = "Café Œuvre Ltd"; p.roles[0].location = "Zürich, CH"; let i = 0; for (const [k, v] of Object.entries(cases)) p.roles[0].bullets.push({ id: `g${i++}`, tags: ["x"], status: "verified", text: `Case ${k}: ${v}.` }); return p; };
const selFor = (p: P, n: number) => { const s = buildSelection(profileToPersona(p, NOW), 1, SUMMARY); s.roles[0].bullets = Array.from({ length: n }, (_, i) => `g${i}`); s.achievements = []; return s; };
const bad = profileWith({ ...SUPPORTED, ...UNSUPPORTED }), badSel = selFor(bad, 6);
let err: unknown = null; try { renderCvHtml(bad, badSel, { fonts }); } catch (e) { err = e; }
ok("refuse up front: unsupported characters stop the render with a plain message that names them (not a late, unexplained Type 3 error)", err instanceof UnsupportedCharactersError && ["⇒", "🚀", "✅"].every((c) => (err as InstanceType<typeof UnsupportedCharactersError>).chars.includes(c)) && !(err as Error).message.includes("é") && /Replace them in your profile/.test((err as Error).message));
const found = unsupportedInProfile(bad, covers);
ok("the profile editor can ask: which characters in this profile cannot be printed, and where", found.length === 2 && found.every((f) => /^bullet g[45]$/.test(f.where)) && found.flatMap((f) => f.chars).includes("⇒") && found.flatMap((f) => f.chars).includes("🚀") && unsupportedInProfile(priya, covers).length === 0);
ok("a renderer without coverage information does not enforce it (the check stays opt-in for callers that load the font themselves)", (() => { try { renderCvHtml(bad, badSel, { fonts: { regular: fonts.regular, bold: fonts.bold, italic: fonts.italic } }); return true; } catch { return false; } })());

if (!findChrome()) { console.log("SKIP chrome part: needs a Chromium browser"); }
else {
  const renderer = new ChromeCliRenderer();
  const good = profileWith(SUPPORTED), goodSel = selFor(good, 4);
  const pdf = await renderer.renderPdf(renderCvHtml(good, goodSel, { fonts })), parsed = await readPdf(pdf), rep = atsCheck(parsed, expectationsFor(good, goodSel));
  ok("accents, currency symbols and typographic punctuation all print in the bundled font only (no fallback font), and the production check passes", parsed.fonts.length === 3 && parsed.fonts.every((f) => /CrimsonText/.test(f.name) && !f.type3 && f.embedded) && rep.ok && rep.warnings.length === 0);
  ok("they come out of the PDF text exactly", Object.values(SUPPORTED).every((v) => parsed.text.replace(/\s+/g, " ").includes(v)) && parsed.text.includes("SIOBHÁN NGUYỄN-ŁUKASZ".normalize("NFC")));
  // The coverage table must agree with what Chrome really does: force the unsupported text through anyway and watch the fonts.
  const forced = await renderer.renderPdf(renderCvHtml(bad, badSel, { fonts: { regular: fonts.regular, bold: fonts.bold, italic: fonts.italic } }));
  const forcedParsed = await readPdf(forced), forcedRep = atsCheck(forcedParsed, expectationsFor(bad, badSel));
  ok("the coverage table agrees with Chrome: forcing the double arrow and emoji through adds fallback fonts stored as Type 3, which the ATS check refuses with the hint about symbols", forcedParsed.fonts.some((f) => f.type3 && !/CrimsonText/.test(f.name)) && !forcedRep.ok && forcedRep.errors.some((e) => /Type 3.*symbol, arrow or emoji/.test(e)));
}
ok("the font file used is the bundled one, so the coverage table describes the shipped font", readFileSync(path.join(FONTS_DIR, "CrimsonText-Regular.ttf")).length === 107200);
console.log(failures === 0 ? "\nall glyphs tests passed" : `\n${failures} glyphs test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
