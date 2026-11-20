// The CV as HTML (phase 1 step 4): one Oxford-style, one-column, ATS-safe page built from a Profile and a validated CvSelection.
// Pure function, no files, no network. Text is escaped for HTML; bullets are copied word for word from the profile; contact details come
// from the identity block here in code (no model ever sees them). Only VERIFIED bullets of VERIFIED roles can be rendered.
import { cleanText, extraLines, profileToPersona } from "../profile.ts";
import type { Profile, Role, YearMonth } from "../profile.ts";
import type { CvSelection } from "./selection.ts";

// ATS-safe accent colours (all dark enough to print and read). The user picks one in Settings > Writing (PRD 14).
export const ACCENTS = { oxford: "#002147", forest: "#1b4332", plum: "#4a1942", slate: "#2b3a4a", charcoal: "#222222" } as const;
export type Accent = keyof typeof ACCENTS;
export const CV_HEADINGS = ["PROFESSIONAL SUMMARY", "SELECTED ACHIEVEMENTS", "PROFESSIONAL EXPERIENCE", "SKILLS", "EDUCATION", "LANGUAGES", "CERTIFICATIONS", "PROJECTS"] as const;
export type FontUrls = { regular: string; bold: string; italic: string; covers?: (codePoint: number) => boolean }; // data: URLs or file URLs; `covers` says which characters the font really has (see fontcoverage.ts)

// Thrown when the CV would print a character the bundled font does not have (it would silently fall back to another font, which the ATS check refuses).
export class UnsupportedCharactersError extends Error {
  chars: string[];
  constructor(chars: string[]) { super(`These characters cannot be printed in the CV font: ${chars.join(" ")}. Replace them in your profile with plain letters, numbers or common punctuation.`); this.chars = chars; this.name = "UnsupportedCharactersError"; }
}
const unsupported = (text: string, covers: (cp: number) => boolean) => [...new Set([...text].filter((c) => !/\s/.test(c) && !covers(c.codePointAt(0)!)))];
// For the profile editor: which characters in this profile the CV font cannot print, and where.
export function unsupportedInProfile(p: Profile, covers: (cp: number) => boolean): { where: string; chars: string[] }[] {
  const fields: [string, string][] = [["your name", p.identity.name], ["your city", p.identity.city], ...p.roles.filter((r) => r.status === "verified").flatMap((r): [string, string][] => [[`role ${r.id} title`, r.title], [`role ${r.id} company`, r.company], [`role ${r.id} location`, r.location], ...r.bullets.filter((b) => b.status === "verified").map((b): [string, string] => [`bullet ${b.id}`, b.text])]),
    ...p.skills.filter((s) => s.status === "verified").map((s): [string, string] => [`skill ${s.name}`, s.name]), ...p.education.filter((e) => e.status === "verified").map((e): [string, string] => [`education ${e.id}`, e.text]), ...Object.entries(extraLines(p.extras)).flatMap(([k, ls]): [string, string][] => ls.map((t, i) => [`${k} ${i + 1}`, t])), ...p.focusTypes.filter((f) => f.status === "verified").map((f): [string, string] => [`headline ${f.id}`, f.headline])];
  return fields.map(([where, text]) => ({ where, chars: unsupported(text, covers) })).filter((x) => x.chars.length);
}

export type CvHtmlOptions = { accent?: Accent; fonts: FontUrls; showRightToWork?: boolean };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const date = (d: YearMonth | "present" | null) => d === "present" ? "present" : d ? `${String(d.m).padStart(2, "0")}/${d.y}` : "";
export const roleSpan = (r: Role) => r.start ? `${date(r.start)} – ${date(r.end)}` : "";
const url = (s: string) => /^https?:\/\//i.test(s) ? s : `https://${s}`;

// Bold the chosen lead-in inside the bullet text (case-insensitive, first match); everything else is the bullet verbatim.
function bulletHtml(text: string, bold?: string): string {
  const lead = bold?.replace(/\s+/g, " ").trim(); // the validator compares with collapsed whitespace, so the renderer must too
  if (lead) {
    const i = text.toLowerCase().indexOf(lead.toLowerCase());
    if (i >= 0) return `${esc(text.slice(0, i))}<b>${esc(text.slice(i, i + lead.length))}</b>${esc(text.slice(i + lead.length))}`;
  }
  return esc(text);
}

export function renderCvHtml(profile: Profile, sel: CvSelection, opts: CvHtmlOptions): string {
  const key = opts.accent ?? "oxford";
  if (!Object.hasOwn(ACCENTS, key)) throw new Error(`unknown accent colour "${key}"`); // hasOwn: "constructor" and other inherited names are not colours
  const accent = ACCENTS[key];
  const roleById = new Map(profile.roles.filter((r) => r.status === "verified").map((r) => [r.id, r]));
  // INVARIANT: what was checked is what is printed. Bullet text comes from the same derivation the validators, the summary rules and the
  // Checker use (profileToPersona: verified items only, contact details masked, whitespace collapsed), never from the raw profile.
  const bulletById = new Map(profileToPersona(profile).bullets.filter((b) => roleById.has(b.employer)).map((b) => [b.id, b.text] as const));
  for (const r of sel.rewrites ?? []) if (bulletById.has(r.id)) bulletById.set(r.id, cleanText(r.text)); // light-rewording mode: print the validated reworded text (already cleaned; cleaning is idempotent)
  const textOf = (id: string) => { const t = bulletById.get(id); if (t === undefined) throw new Error(`bullet "${id}" is not a verified bullet of a verified role; it cannot be on a CV`); return t; };

  const id = profile.identity, rules = profile.rules;
  const focus = sel.focus_id === null ? null : profile.focusTypes.find((f) => f.id === sel.focus_id && f.status === "verified");
  if (sel.focus_id !== null && !focus) throw new Error(`focus type ${sel.focus_id} is not a verified focus type`);
  const firstRole = roleById.get(sel.roles[0]?.role ?? "");
  const headline = focus?.headline ?? firstRole?.title ?? "";
  const contact = [
    id.email ? `<a href="mailto:${esc(id.email)}">${esc(id.email)}</a>` : "",
    id.linkedin ? `<a href="${esc(url(id.linkedin))}">${esc(id.linkedin.replace(/^https?:\/\//i, ""))}</a>` : "",
    id.phone ? esc(id.phone) : "",
    rules.location.cvLocationLines[0] ? esc(rules.location.cvLocationLines[0]) : "",
  ].filter(Boolean).join(" | ");
  const right = (opts.showRightToWork ?? true) && rules.rightToWork.statement.trim() ? esc(rules.rightToWork.statement.trim()) : "";

  const achievements = sel.achievements.length
    ? `<h2>Selected Achievements</h2>\n<ul>\n${sel.achievements.map((a) => `<li>${bulletHtml(textOf(a.id), a.bold)}</li>`).join("\n")}\n</ul>` : "";
  const experience = sel.roles.map((s) => {
    const r = roleById.get(s.role);
    if (!r) throw new Error(`role "${s.role}" is not a verified role`);
    return `<div class="role"><b>${esc(r.title)}</b><span>${esc(roleSpan(r))}</span></div>\n<div class="role sub"><span>${esc(r.company)}</span><span>${esc(r.location)}</span></div>\n<ul>\n${s.bullets.map((b) => `<li>${bulletHtml(textOf(b))}</li>`).join("\n")}\n</ul>`;
  }).join("\n");

  // Skills: one ordered list from the Writer, grouped by the profile's skill groups (first-appearance order); ungrouped skills go under "Skills".
  const verified = new Map(profile.skills.filter((s) => s.status === "verified").map((s) => [norm(s.name), s]));
  const groups = new Map<string, string[]>();
  for (const name of sel.skills) { const s = verified.get(norm(name)); if (!s) throw new Error(`skill "${name}" is not a verified skill`); const g = s.group?.trim() || "Skills"; groups.set(g, [...(groups.get(g) ?? []), s.name]); }
  const skills = groups.size ? `<h2>Skills</h2>\n${[...groups].map(([g, items]) => `<p class="skills">${groups.size === 1 && g === "Skills" ? "" : `<b>${esc(g.charAt(0).toUpperCase() + g.slice(1))}:</b> `}${items.map(esc).join(", ")}</p>`).join("\n")}` : "";
  const edu = profile.education.filter((e) => e.status === "verified");
  const education = edu.length ? `<h2>Education</h2>\n${edu.map((e) => `<p>${esc(e.text)}</p>`).join("\n")}` : "";
  const xl = extraLines(profile.extras), extra = (h: string, lines: string[]) => (lines.length ? `<h2>${h}</h2>\n${lines.map((l) => `<p>${esc(l)}</p>`).join("\n")}` : "");
  const extras = [extra("Languages", xl.languages), extra("Certifications", xl.certifications), extra("Projects", xl.projects)].filter(Boolean).join("\n");

  if (opts.fonts.covers) { // refuse up front, naming the characters, instead of letting the browser fall back to a font the ATS check will reject
    const printed = [id.name, headline, contact, right, sel.summary, achievements, experience, skills, education, extras].join("\n").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
    const bad = unsupported(printed, opts.fonts.covers);
    if (bad.length) throw new UnsupportedCharactersError(bad);
  }
  const face = (w: string, style: string, u: string) => `@font-face{font-family:"CV Serif";font-weight:${w};font-style:${style};src:url("${u}") format("truetype")}`;
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:; style-src 'unsafe-inline'">
<title>${esc(id.name)} - CV</title>
<style>
${face("400", "normal", opts.fonts.regular)}
${face("700", "normal", opts.fonts.bold)}
${face("400", "italic", opts.fonts.italic)}
@page{size:A4;margin:0.45in 0.65in}
:root{--accent:${accent}}
body{font:10.4pt/1.2 "CV Serif",Georgia,serif;margin:0;color:#000;font-variant-ligatures:none}
header{text-align:center}
h1{color:var(--accent);font-size:22pt;margin:0 0 4pt;letter-spacing:.5pt;text-transform:uppercase}
.headline{font-size:12pt;margin:0 0 4pt}
.contact{font-size:9pt;margin:0}
a{color:inherit;text-decoration:none}
h2{color:var(--accent);font-size:12pt;text-transform:uppercase;margin:8pt 0 4pt;border-bottom:.6pt solid var(--accent);padding-bottom:1pt}
ul{margin:2pt 0 0;padding-left:1.3em}li{margin:1.5pt 0}
.role{display:flex;justify-content:space-between;margin-top:3pt;break-inside:avoid}.role.sub{font-style:italic;margin-top:0}
.role+.role+ul+.role{margin-top:6pt}
p{margin:0}.skills+.skills{margin-top:2pt}
</style></head><body>
<header><h1>${esc(id.name)}</h1>${headline ? `<p class="headline">${esc(headline)}</p>` : ""}
<p class="contact">${contact}${right ? `<br>${right}` : ""}</p></header>
<h2>Professional Summary</h2>
<p>${esc(sel.summary)}</p>
${achievements}
<h2>Professional Experience</h2>
${experience}
${skills}
${education}
${extras}
</body></html>
`;
}
