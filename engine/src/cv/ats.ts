// In-process ATS checks (phase 1 step 5): read the finished PDF with pdf.js and test what an applicant-tracking system will see.
// No poppler, no LaTeX, nothing to install on a user's Mac. Pure functions over the PDF bytes.
// Only the page-count rule can be overridden by the user (PRD 10); every other failure always blocks delivery.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { extraLines, profileToPersona } from "../profile.ts";
import type { Profile } from "../profile.ts";
import type { CvSelection } from "./selection.ts";
import { CV_HEADINGS, roleSpan } from "./html.ts";

export type PdfFont = { name: string; embedded: boolean; type3: boolean; kind: string }; // kind: how the font is stored in the PDF ("Type 3", "TrueType", "CIDFontType0" ...). Recorded as information; see PHASE1.md (font type decision)
export type ParsedPdf = {
  pages: number; title: string | null; tagged: boolean;
  text: string;        // visual reading order: lines top to bottom, items left to right, one line per row
  streamText: string;  // the order in the PDF's own content stream (what a parser that ignores layout sees)
  fonts: PdfFont[]; imageOps: number;
  overlaps: number;    // text runs that overlap horizontally on the same row: columns or layered text, which an ATS reads out of order
};

// Rejects if the promise does not settle in time, and always clears its timer (a leftover timer would keep the process alive).
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
}

export async function readPdf(data: Uint8Array | Buffer): Promise<ParsedPdf> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: false, fontExtraProperties: true, verbosity: 0 });
  const doc = await task.promise;
  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = (meta?.info ?? {}) as Record<string, unknown>;
    const visual: string[] = [], stream: string[] = [], fonts = new Map<string, PdfFont>();
    let imageOps = 0, tagged = false, overlaps = 0;
    const IMAGE_OPS = [pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject].filter((x) => x !== undefined);
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent({ disableNormalization: true }); // keep the original characters: pdf.js would otherwise turn a ligature glyph back into "fi" and hide it
      type Item = { str: string; x: number; y: number; w: number; eol: boolean };
      const items: Item[] = tc.items.filter((i: any) => "str" in i).map((i: any) => ({ str: i.str as string, x: i.transform[4] as number, y: i.transform[5] as number, w: i.width as number, eol: !!i.hasEOL }));
      for (const it of items) stream.push(it.str + (it.eol ? "\n" : ""));
      const rows: Item[][] = [];
      for (const it of items.filter((i) => i.str.trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x)) {
        const row = rows.find((r) => Math.abs(r[0].y - it.y) < 2.5);
        row ? row.push(it) : rows.push([it]);
      }
      for (const row of rows.sort((a, b) => b[0].y - a[0].y)) {
        row.sort((a, b) => a.x - b.x);
        row.forEach((it, i) => { if (i > 0 && it.x < row[i - 1].x + row[i - 1].w - 2) overlaps++; });
        let line = "";
        row.forEach((it, i) => { const prev = row[i - 1]; line += (prev && it.x - (prev.x + prev.w) > 1 && !line.endsWith(" ") && !it.str.startsWith(" ") ? " " : "") + it.str; });
        visual.push(line.replace(/\s+/g, " ").trim());
      }
      stream.push("\n");
      const ops = await page.getOperatorList();
      const fontIds = new Set<string>();
      ops.fnArray.forEach((fn: number, i: number) => { if (fn === pdfjs.OPS.setFont) fontIds.add(ops.argsArray[i][0]); if (IMAGE_OPS.includes(fn)) imageOps++; });
      for (const id of fontIds) {
        const f: any = await withTimeout(new Promise((res) => page.commonObjs.get(id, res)), 10_000, "the PDF is malformed: font information never arrived"); // never hang a job on a bad PDF
        const name = String(f?.name ?? id);
        fonts.set(name, { name, embedded: !!f && !f.missingFile && /^[A-Z]{6}\+/.test(name), type3: !!f?.isType3Font, kind: f?.isType3Font ? "Type 3" : String(f?.type ?? "unknown") });
      }
      if (n === 1) tagged = !!(await page.getStructTree().catch(() => null));
    }
    return { pages: doc.numPages, title: typeof info.Title === "string" && info.Title ? info.Title : null, tagged, text: visual.join("\n"), streamText: stream.join(""), fonts: [...fonts.values()], imageOps, overlaps };
  } finally { await task.destroy(); }
}

const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export type AtsExpect = {
  name: string; email?: string; locationLine?: string; rightToWork?: string;
  headings: string[];            // section headings expected, in order
  bullets: string[];             // chosen bullet texts in the order they should be read
  dates?: string[];              // the role date ranges as printed ("03/2021 – present"), compared exactly
  allowMultiPage?: boolean;      // the user's explicit "deliver anyway": turns a 2-page result into a warning (never more than 2)
};
export type AtsReport = { ok: boolean; errors: string[]; warnings: string[]; overflow: boolean; pages: number; fonts: PdfFont[] };

export function atsCheck(p: ParsedPdf, e: AtsExpect): AtsReport {
  const errors: string[] = [], warnings: string[] = [];
  let overflow = false;
  if (p.pages > 1) {
    overflow = true;
    if (e.allowMultiPage && p.pages === 2) warnings.push("the CV is 2 pages (delivered at the user's request)");
    else errors.push(`the CV is ${p.pages} pages; one page is the target`);
  }
  if (p.text.replace(/\s/g, "").length < 400) errors.push(`only ${p.text.replace(/\s/g, "").length} readable characters; the text did not render or is not selectable`);
  if (!p.title || !flat(p.title).includes(flat(e.name))) errors.push("the PDF has no document title naming the candidate");
  if (!p.tagged) warnings.push("the PDF has no tagged structure (reading order relies on layout only)");
  if (!p.fonts.length) errors.push("no fonts found in the PDF");
  for (const f of p.fonts) {
    if (f.type3) errors.push(`font "${f.name}" is stored as Type 3 (drawn shapes plus a text map); some ATS parsers read those badly, so the CV uses TrueType fonts only (a symbol, arrow or emoji the CV font lacks is the usual cause)`); // product decision, 2026-11-16
    if (!f.embedded) errors.push(`font "${f.name}" is not embedded; an ATS may substitute it and misread the text`);
  }
  if (p.overlaps > 0) errors.push(`${p.overlaps} text run(s) overlap on the same row (columns or layered text); an ATS would read them out of order`);
  if (p.imageOps > 0) errors.push(`${p.imageOps} image(s) in the PDF; an ATS cannot read text inside images`);
  const all = p.text + "\n" + p.streamText;
  if (/[ﬀ-ﬆ]/.test(all)) errors.push("ligature glyphs (fi, fl ...) in the text: an ATS may not read them");
  if (/[�-]|\(cid:/.test(all)) errors.push("unreadable or private-use characters in the PDF text");
  if (/\bundefined\b|\[object|\{\{|\bNaN\b|\[email\]|\[phone\]|\[linkedin\]/i.test(p.text)) errors.push("a placeholder or a masked contact detail is in the CV text");

  const lines = p.text.split("\n");
  const at = (h: string) => lines.indexOf(h);
  let last = -1;
  for (const h of e.headings) { const i = at(h); if (i < 0) errors.push(`section heading "${h}" not found as its own line`); else { if (i < last) errors.push(`section "${h}" is out of order`); last = i; } }
  if (!flat(p.text).includes(flat(e.name))) errors.push("the candidate's name is missing from the PDF text");
  // EXACT comparisons (whitespace collapsed, nothing else): a garbled pound sign, percent sign, dash, ampersand or apostrophe must not ship.
  const one = (s: string) => s.replace(/\s+/g, " ").trim(), hay = one(p.text);
  for (const [label, v] of [["email", e.email], ["location line", e.locationLine], ["right-to-work line", e.rightToWork]] as const) if (v && !hay.includes(one(v))) errors.push(`the ${label} is missing from the PDF text or was changed in it`);
  for (const d of e.dates ?? []) if (!hay.includes(one(d))) errors.push(`the date range "${d}" is missing from the PDF text or was changed in it`);

  // Keywords intact and reading order: every chosen bullet appears whole, and in the order the Writer ranked them.
  const body = flat(p.text); let from = 0, orderOk = true;
  for (const b of e.bullets) {
    const needle = flat(b), i = body.indexOf(needle, from);
    if (!needle) continue;
    if (body.indexOf(needle) < 0) errors.push(`a chosen bullet is missing or altered in the PDF text: "${b.slice(0, 60)}…"`);
    else if (!hay.includes(one(b))) errors.push(`a chosen bullet was garbled in the PDF (a symbol or punctuation mark differs from the profile): "${b.slice(0, 60)}…"`);
    if (body.indexOf(needle) >= 0) { if (i < 0) orderOk = false; else from = i + needle.length; }
  }
  if (!orderOk) errors.push("the chosen bullets do not read in the intended order");
  // The content stream must agree with the page layout, or a parser that ignores layout reads the CV in a different order.
  const streamFlat = flat(p.streamText), visualFlat = flat(p.text);
  const marks = [e.name, ...e.headings.map((h) => h.toLowerCase()), ...e.bullets].map(flat).filter((m) => m && visualFlat.includes(m) && streamFlat.includes(m)); // every heading and EVERY chosen bullet, not a sample
  const pos = (s: string) => marks.map((m) => s.indexOf(m));
  const visualPos = pos(visualFlat), streamPos = pos(streamFlat);
  const rank = (a: number[]) => a.map((v, i) => [v, i]).filter(([v]) => v >= 0).sort((x, y) => x[0] - y[0]).map(([, i]) => i).join();
  if (rank(visualPos) !== rank(streamPos)) errors.push("the content stream order differs from the page layout order; a parser that ignores layout would read the CV out of order");
  return { ok: errors.length === 0, errors, warnings, overflow, pages: p.pages, fonts: p.fonts };
}

// What a given CV must contain, derived from the same cleaned persona the checks and the renderer use.
export function expectationsFor(profile: Profile, sel: CvSelection, o: { allowMultiPage?: boolean; showRightToWork?: boolean } = {}): AtsExpect {
  const persona = profileToPersona(profile);
  const reworded = new Map((sel.rewrites ?? []).map((r) => [r.id, r.text]));
  const text = (id: string) => reworded.get(id) ?? persona.bullets.find((b) => b.id === id)!.text; // what is printed: the reworded text where there is one
  return {
    name: profile.identity.name, email: profile.identity.email, locationLine: profile.rules.location.cvLocationLines[0],
    rightToWork: (o.showRightToWork ?? true) ? profile.rules.rightToWork.statement.trim() || undefined : undefined,
    headings: CV_HEADINGS.filter((h) => h !== "SELECTED ACHIEVEMENTS" || sel.achievements.length).filter((h) => h !== "SKILLS" || sel.skills.length).filter((h) => h !== "EDUCATION" || profile.education.some((x) => x.status === "verified")).filter((h) => !["LANGUAGES", "CERTIFICATIONS", "PROJECTS"].includes(h) || extraLines(profile.extras)[h.toLowerCase() as "languages" | "certifications" | "projects"].length > 0),
    bullets: [...sel.achievements.map((a) => text(a.id)), ...sel.roles.flatMap((r) => r.bullets.map(text))],
    dates: sel.roles.map((r) => { const role = profile.roles.find((x) => x.id === r.role)!; return roleSpan(role); }).filter(Boolean),
    allowMultiPage: o.allowMultiPage,
  };
}
