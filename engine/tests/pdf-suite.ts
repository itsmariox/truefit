// The PDF assertions, written against ANY PdfRenderer so the same checks run unchanged on headless Chrome today and on Electron's printToPDF
// later (Electron's page size, margins and tagging options must be verified against its docs, not assumed to match Chrome's command line).
// Poppler (pdfinfo, pdffonts, pdftotext) is an independent oracle on the development Mac.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CV_HEADINGS, renderCvHtml } from "../src/cv/html.ts";
import { extraLines } from "../src/profile.ts";
import type { FontUrls } from "../src/cv/html.ts";
import type { PdfRenderer } from "../src/cv/render.ts";
import type { CvSelection } from "../src/cv/selection.ts";
import type { Profile } from "../src/profile.ts";

const tool = (cmd: string, args: string[]) => { try { return execFileSync(cmd, args, { encoding: "utf8", env: { PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" }, timeout: 30_000 }); } catch { return null; } };
export const haveOracle = () => tool("pdfinfo", ["-v"]) !== null || tool("pdfinfo", ["-h"]) !== null;
const flat = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
const oneLine = (x: string) => x.replace(/\s+/g, " ");

export type PdfCase = { label: string; profile: Profile; selection: CvSelection; mustContain?: string[] }; // mustContain: exact strings that must survive into the PDF text (money, percent, dates, ampersand, curly apostrophe)
export async function pdfSuite(renderer: PdfRenderer, fonts: FontUrls, cases: PdfCase[], ok: (name: string, cond: boolean) => void) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "cvapp-pdf-"));
  try {
    for (const { label, profile: p, selection: s, mustContain } of cases) {
      const pdf = await renderer.renderPdf(renderCvHtml(p, s, { fonts }));
      const f = path.join(tmp, `${label}.pdf`); writeFileSync(f, pdf);
      const info = tool("pdfinfo", [f]) ?? "", text = tool("pdftotext", [f, "-"]) ?? "", fontsOut = tool("pdffonts", [f]) ?? "";
      ok(`pdf ${label}: one A4 page, with a title and a tagged structure`, /^Pages:\s+1$/m.test(info) && /A4/.test(info) && /^Title:\s+.+ - CV$/m.test(info) && /^Tagged:\s+yes/m.test(info));
      ok(`pdf ${label}: the bundled font is embedded as a normal CID TrueType font (never Type 3) and no other family is used`, /CrimsonText/.test(fontsOut) && fontsOut.split("\n").slice(2).filter(Boolean).every((l) => /CrimsonText/.test(l) && /CID TrueType/.test(l) && /\byes\b/.test(l)));
      ok(`pdf ${label}: the name, the headings in order and every chosen bullet extract as text, with no ligature glyphs or placeholders`, (() => {
        const lines = text.split("\n").map((l) => l.trim()); let last = -1;
        const headings = CV_HEADINGS.filter((h) => h !== "SELECTED ACHIEVEMENTS" || s.achievements.length).filter((h) => h !== "SKILLS" || s.skills.length).filter((h) => h !== "EDUCATION" || p.education.some((e) => e.status === "verified")).filter((h) => !["LANGUAGES", "CERTIFICATIONS", "PROJECTS"].includes(h) || (extraLines(p.extras) as Record<string, string[]>)[h.toLowerCase()].length > 0);
        const inOrder = headings.every((h) => { const i = lines.indexOf(h); const good = i > last; last = i; return good; });
        const bullets = [...s.achievements.map((a) => a.id), ...s.roles.flatMap((r) => r.bullets)].map((id) => p.roles.flatMap((r) => r.bullets).find((b) => b.id === id)!.text);
        return text.includes(p.identity.name.toUpperCase()) && inOrder && bullets.every((b) => flat(text).includes(flat(b).slice(0, 60))) && !/[ﬀ-ﬆ]/.test(text) && !/CANARY|undefined|\[object/.test(text);
      })());
      ok(`pdf ${label}: the PDF text carries the contact details from the identity block`, text.includes(p.identity.email!) && text.includes(p.rules.location.cvLocationLines[0]));
      if (mustContain) ok(`pdf ${label}: special characters survive into the PDF text exactly (an ATS reads dates, money and percentages from it)`, mustContain.every((m) => oneLine(text).includes(m)));
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
