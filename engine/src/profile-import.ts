// CV import (phase 5b): what is sent to Claude, and what is done with the answer. Pure functions, no AI, no files.
// PRIVACY: the CV text is sent to Claude, but first every email address, phone number and LinkedIn link is replaced (`importableText`); the name is NOT removed (it is part of the CV text and is
// not needed or used by the import, and the Importer is told to leave it out). Nothing from the answer is trusted: every item becomes a DRAFT, text must appear in the CV, limits are enforced.
import { cleanText } from "./profile.ts";
import type { Profile, ProfileBullet, Role } from "./profile.ts";

export const IMPORT_LIMITS = { chars: 60_000, roles: 30, bulletsPerRole: 14, bulletChars: 400, skills: 60, education: 12, field: 120 };
export const importableText = (raw: string): string => cleanText(String(raw).replace(/\r/g, "")).slice(0, IMPORT_LIMITS.chars);
// `cleanText` also collapses all whitespace; keep line breaks for the model by masking line by line.
// Beyond cleanText (email, LinkedIn, common phone shapes) the import also masks: phone numbers with brackets or dots, obfuscated emails ("name [at] site.com") and profile links on common sites (found by the independent review, 2026-11-18). Postal addresses are NOT masked: they cannot be told apart from role text reliably.
const EXTRA_PHONE = /(?<![\d/])(?:\+|00[ ]?)?\(?\d{2,5}\)?[ .-]?\d{3,4}[ .-]?\d{3,4}(?:[ .-]?\d{2,4})?(?![\d/])/g;
const OBFUSCATED_EMAIL = /[\w.+-]+\s*[\[(]\s*at\s*[\])]\s*[\w-]+(?:\s*[\[(]\s*dot\s*[\])]\s*|\.)[\w.-]+/gi;
const PROFILE_LINK = /\b(?:https?:\/\/)?(?:www\.)?(?:github\.com|gitlab\.com|twitter\.com|x\.com|instagram\.com|facebook\.com|behance\.net|dribbble\.com|medium\.com)\/[^\s|,;]+/gi;
const maskExtra = (l: string) => l.replace(OBFUSCATED_EMAIL, "[email]").replace(PROFILE_LINK, "[link]").replace(EXTRA_PHONE, (m) => (m.replace(/\D/g, "").length >= 9 && (/^[+0(]/.test(m.trim()) || /\d\.\d/.test(m)) ? "[phone]" : m));
export function maskForImport(raw: string): string { return String(raw).replace(/\r/g, "").split("\n").map((l) => maskExtra(cleanText(l))).join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, IMPORT_LIMITS.chars); }

type Raw = { roles?: unknown; skills?: unknown; education?: unknown };
export type ImportResult = { profile: Profile; added: { roles: number; bullets: number; skills: number; education: number }; notFromCv: number; dropped: number };
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const str = (x: unknown, max: number) => (typeof x === "string" ? cleanText(x).slice(0, max) : "");
const ym = (y: unknown, m: unknown) => (Number.isInteger(y) && (y as number) >= 1950 && (y as number) <= 2100 ? { y: y as number, m: Number.isInteger(m) && (m as number) >= 1 && (m as number) <= 12 ? (m as number) : 1 } : null);
let seq = 0; const id = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

// Merges the Importer's answer into a COPY of the profile. Everything added is a draft. A bullet whose words are not found in the CV text is still added (as a draft) but counted in notFromCv,
// so the screen can tell the person to check it; skills and education lines not found in the CV are dropped (the Importer was told never to add any).
export function mergeImport(profile: Profile, raw: Raw, cvText: string): ImportResult {
  const L = IMPORT_LIMITS, out: Profile = JSON.parse(JSON.stringify(profile)), source = norm(cvText);
  let dropped = 0, notFromCv = 0; const added = { roles: 0, bullets: 0, skills: 0, education: 0 };
  const have = new Set(out.roles.flatMap((r) => r.bullets.map((b) => norm(b.text)))), haveSkill = new Set(out.skills.map((s) => norm(s.name))), haveEdu = new Set(out.education.map((e) => norm(e.text)));
  for (const r of (Array.isArray(raw.roles) ? raw.roles : []).slice(0, L.roles) as Record<string, unknown>[]) {
    const title = str(r?.title, L.field), company = str(r?.company, L.field); if (!title && !company) { dropped++; continue; }
    const bullets: ProfileBullet[] = [];
    for (const b of (Array.isArray(r.bullets) ? r.bullets : []).slice(0, L.bulletsPerRole) as Record<string, unknown>[]) {
      const text = str(b?.text, L.bulletChars); if (!text || have.has(norm(text))) { if (text) dropped++; continue; }
      if (typeof b?.text === "string" && cleanText(b.text) !== b.text.replace(/\s+/g, " ").trim()) { dropped++; continue; } // it held a contact detail the model should not have: skip it
      if (!source.includes(norm(text))) notFromCv++;
      have.add(norm(text)); bullets.push({ id: id("b"), text, tags: (Array.isArray(b?.tags) ? b.tags : []).map((t) => str(t, 30).toLowerCase()).filter(Boolean).slice(0, 3), status: "draft" });
    }
    const role: Role = { id: id("r"), title: title || "Role", company: company || "Company", location: str(r.location, L.field), start: ym(r.start_year, r.start_month), end: r.current === true ? "present" : ym(r.end_year, r.end_month), status: "draft", bullets };
    out.roles.push(role); added.roles++; added.bullets += bullets.length;
  }
  for (const s of (Array.isArray(raw.skills) ? raw.skills : []).slice(0, L.skills)) { const n = str(s, 60); if (!n || haveSkill.has(norm(n))) continue; if (!source.includes(norm(n))) { dropped++; continue; } haveSkill.add(norm(n)); out.skills.push({ name: n, status: "draft" }); added.skills++; }
  for (const e of (Array.isArray(raw.education) ? raw.education : []).slice(0, L.education)) { const t = str(e, 200); if (!t || haveEdu.has(norm(t))) continue; if (!source.includes(norm(t))) { dropped++; continue; } haveEdu.add(norm(t)); out.education.push({ id: id("e"), text: t, status: "draft" }); added.education++; }
  return { profile: out, added, notFromCv, dropped };
}
