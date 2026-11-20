// CV import for schema v2 (design/PROFILE-SCHEMA-v2.md, phase 1 step B). Everything that sets TRUST or fills a LOCKED field is plain code on this Mac:
//  - contact details and a proposed name are read from the UNMASKED CV text by code, never from Claude's answer;
//  - a bullet, skill or education line is TRUSTED only when its words are found word for word in the (masked) CV text; anything else stays under review;
//  - the masked CV text is kept as a source, and a second import of the same CV matches against it, so legacy items are UPGRADED, never duplicated.
import { createHash } from "node:crypto";
import { PHONE } from "./persona.ts";
import { cleanText } from "./profile.ts";
import { IMPORT_LIMITS, maskForImport } from "./profile-import.ts";
import type { Bullet2, Meta, Profile2, Role2, Skill2, Education2, Source } from "./profile-v2.ts";
import type { YearMonth } from "./profile.ts";

type Raw = { roles?: unknown; skills?: unknown; education?: unknown };
export type ImportResultV2 = { profile: Profile2; added: { roles: number; bullets: number; skills: number; education: number }; upgraded: number; notFromCv: number; dropped: number; proposedName: string | null; sourceId: string; duplicateSource: boolean };

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const str = (x: unknown, max: number) => (typeof x === "string" ? cleanText(x).slice(0, max) : "");
const ym = (y: unknown, m: unknown): YearMonth | null => (Number.isInteger(y) && (y as number) >= 1950 && (y as number) <= 2100 ? { y: y as number, m: Number.isInteger(m) && (m as number) >= 1 && (m as number) <= 12 ? (m as number) : 1 } : null);
let seq = 0; const nid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

// ---------- contacts and the name, from the raw text, by code ----------
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const LINKEDIN = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/[^\s|,;)]+/i;
const PROFILE_LINKS = /\b(?:https?:\/\/)?(?:www\.)?(?:github\.com|gitlab\.com|behance\.net|dribbble\.com|medium\.com)\/[^\s|,;)]+/gi;
const PHONE_LOOSE = /(?<![\d/])(?:\+|00[ ]?)?\(?\d{2,5}\)?[ .-]?\d{3,4}[ .-]?\d{3,4}(?:[ .-]?\d{2,4})?(?![\d/])/g;
export function extractContacts(raw: string): { email?: string; phone?: string; linkedin?: string; links: string[] } {
  const out: { email?: string; phone?: string; linkedin?: string; links: string[] } = { links: [] };
  const e = raw.match(EMAIL); if (e) out.email = e[0];
  const l = raw.match(LINKEDIN); if (l) out.linkedin = /^https?:/i.test(l[0]) ? l[0] : `https://${l[0].replace(/^www\./i, "www.")}`;
  const strong = raw.match(PHONE); const loose = [...raw.matchAll(PHONE_LOOSE)].map((m) => m[0]).find((m) => m.replace(/\D/g, "").length >= 9 && (/^[+0(]/.test(m.trim()) || /\d\.\d/.test(m)));
  const ph = (strong && strong[0]) || loose; if (ph) out.phone = ph.trim();
  out.links = [...new Set([...raw.matchAll(PROFILE_LINKS)].map((m) => (/^https?:/i.test(m[0]) ? m[0] : `https://${m[0]}`)))].slice(0, 5);
  return out;
}
const HEADINGS = /^(curriculum vitae|resume|résumé|cv|profile|contact|personal details|personal statement|summary|about me)$/i;
const PARTICLES = new Set(["de", "da", "del", "van", "von", "der", "den", "la", "le", "di", "bin", "al", "el"]);
export function proposeName(raw: string): string | null {
  for (const line of raw.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8)) {
    if (line.length > 50 || /[\d@:/|]/.test(line) || HEADINGS.test(line)) continue;
    const words = line.split(/\s+/); if (words.length < 2 || words.length > 4) continue;
    if (words.every((w) => /^\p{Lu}[\p{L}'’.-]*$/u.test(w) || PARTICLES.has(w.toLowerCase()))) return words.join(" ");
  }
  return null;
}

// ---------- the merge ----------
const metaCv = (sourceId: string, trust: "trusted" | "review", now: string): Meta => ({ origin: "cv", trust, addedAt: now, sourceId });
export function mergeImportV2(prev: Profile2, raw: Raw, rawCv: string, o: { label: string; now: string }): ImportResultV2 {
  const L = IMPORT_LIMITS, out: Profile2 = JSON.parse(JSON.stringify(prev)), masked = maskForImport(rawCv), source = norm(masked);
  const textHash = createHash("sha256").update(masked).digest("hex");
  let src: Source | undefined = out.sources.find((s) => s.textHash === textHash); const duplicateSource = !!src;
  if (!src) { src = { id: `src-${textHash.slice(0, 8)}`, kind: "cv", label: o.label.slice(0, 80) || "CV", addedAt: o.now, textHash, text: masked }; out.sources.push(src); }
  const sourceId = src.id, has = (t: string) => { const n = norm(t); return n.length > 0 && ` ${source} `.includes(` ${n} `); }, found = (t: string) => has(maskForImport(t)); // whole words only: "Go" is not "good", "Acme" is not "Acmeville"
  let dropped = 0, notFromCv = 0, upgraded = 0; const added = { roles: 0, bullets: 0, skills: 0, education: 0 };
  // every bullet already in the profile, by its words
  const bulletAt = new Map<string, Bullet2>(); for (const r of out.facts.roles) for (const b of r.bullets) bulletAt.set(norm(b.text), b);
  const upgrade = (m: Meta) => { if (m.trust === "trusted" && m.origin !== "legacy") return false; m.origin = "cv"; m.trust = "trusted"; m.sourceId = sourceId; delete m.quote; return true; };
  for (const r of (Array.isArray(raw.roles) ? raw.roles : []).slice(0, L.roles) as Record<string, unknown>[]) {
    const title = str(r?.title, L.field), company = str(r?.company, L.field); if (!title && !company) { dropped++; continue; }
    const start = ym(r.start_year, r.start_month), end: YearMonth | "present" | null = r.current === true ? "present" : ym(r.end_year, r.end_month);
    let role: Role2 | undefined = out.facts.roles.find((x) => norm(x.company) === norm(company) && (norm(x.title) === norm(title) || (!!x.start && !!start && x.start.y === start.y)));
    if (!role) {
      const exact = !!company && !!title && has(company) && has(title);
      role = { id: nid("r"), title: title || "Role", company: company || "Company", location: str(r.location, L.field), start, end, bullets: [], claims: [], meta: metaCv(sourceId, exact ? "trusted" : "review", o.now) };
      out.facts.roles.push(role); added.roles++;
    } else if (role.meta.origin === "legacy" && role.meta.trust === "review" && has(role.company) && has(role.title)) { if (upgrade(role.meta)) upgraded++; }
    if (!(role.claims ?? []).some((c) => c.sourceId === sourceId)) role.claims = [...(role.claims ?? []), { sourceId, title: title || role.title, start, end }];
    for (const b of (Array.isArray(r.bullets) ? r.bullets : []).slice(0, L.bulletsPerRole) as Record<string, unknown>[]) {
      const text = str(b?.text, L.bulletChars); if (!text) continue;
      if (typeof b?.text === "string" && cleanText(b.text) !== b.text.replace(/\s+/g, " ").trim()) { dropped++; continue; } // it held a contact detail the model should not have
      const have = bulletAt.get(norm(text));
      if (have) { if (found(text) && upgrade(have.meta)) upgraded++; continue; } // the same words are already there: upgrade, never duplicate
      const exact = found(text); if (!exact) notFromCv++;
      const bullet: Bullet2 = { id: nid("b"), text, tags: (Array.isArray(b?.tags) ? b.tags : []).map((t) => str(t, 30).toLowerCase()).filter(Boolean).slice(0, 3), meta: metaCv(sourceId, exact ? "trusted" : "review", o.now) };
      role.bullets.push(bullet); bulletAt.set(norm(text), bullet); added.bullets++;
    }
  }
  const haveSkill = new Map<string, Skill2>(out.facts.skills.map((s) => [norm(s.name), s] as const));
  for (const s of (Array.isArray(raw.skills) ? raw.skills : []).slice(0, L.skills)) {
    const n = str(s, 60); if (!n) continue; const have = haveSkill.get(norm(n));
    if (!found(n)) { if (!have) dropped++; continue; }
    if (have) { if (upgrade(have.meta)) upgraded++; continue; }
    const sk: Skill2 = { name: n, meta: metaCv(sourceId, "trusted", o.now) }; out.facts.skills.push(sk); haveSkill.set(norm(n), sk); added.skills++;
  }
  const haveEdu = new Map<string, Education2>(out.facts.education.map((e) => [norm(e.text), e] as const));
  for (const e of (Array.isArray(raw.education) ? raw.education : []).slice(0, L.education)) {
    const t = str(e, 200); if (!t) continue; const have = haveEdu.get(norm(t));
    if (!found(t)) { if (!have) dropped++; continue; }
    if (have) { if (upgrade(have.meta)) upgraded++; continue; }
    const ed: Education2 = { id: nid("e"), text: t, meta: metaCv(sourceId, "trusted", o.now) }; out.facts.education.push(ed); haveEdu.set(norm(t), ed); added.education++;
  }
  // Decision B: "code re-matches every earlier item word for word against the CV". Claude's answer may skip or reword an item, so every legacy or unmatched item whose words ARE in this CV is upgraded here too.
  const earlier = (m: Meta) => m.origin === "legacy" || (m.origin === "cv" && m.trust === "review");
  for (const r of out.facts.roles) {
    if (earlier(r.meta) && has(r.company) && has(r.title) && upgrade(r.meta)) upgraded++;
    for (const b of r.bullets) if (earlier(b.meta) && b.meta.trust === "review" && found(b.text) && upgrade(b.meta)) upgraded++;
  }
  for (const sk of out.facts.skills) if (earlier(sk.meta) && sk.meta.trust === "review" && found(sk.name) && upgrade(sk.meta)) upgraded++;
  for (const ed of out.facts.education) if (earlier(ed.meta) && ed.meta.trust === "review" && found(ed.text) && upgrade(ed.meta)) upgraded++;
  // locked fields: filled by code from the raw text, and ONLY while they are empty (an import never overwrites what the user has)
  const c = extractContacts(rawCv), lc = out.locked.contact;
  const filled: NonNullable<Profile2["review"]["unchecked"]> = [];
  if (!lc.email && c.email) { lc.email = c.email; filled.push("email"); } if (!lc.phone && c.phone) { lc.phone = c.phone; filled.push("phone"); } if (!lc.linkedin && c.linkedin) { lc.linkedin = c.linkedin; filled.push("linkedin"); }
  lc.links = [...new Set([...lc.links, ...c.links])].slice(0, 5);
  let proposedName: string | null = null;
  if (!out.locked.identity.name.trim()) { proposedName = proposeName(rawCv); if (proposedName) { out.locked.identity.name = proposedName; filled.push("name"); } }
  if (filled.length) out.review.unchecked = [...new Set([...(out.review.unchecked ?? []), ...filled])];
  out.log = [...out.log, { at: o.now, actor: "import" as const, summary: `imported ${src.label}: ${added.roles} role(s), ${added.bullets} bullet(s), ${added.skills} skill(s), ${added.education} education line(s); ${upgraded} earlier item(s) matched the CV${duplicateSource ? " (this CV had been imported before)" : ""}` }].slice(-500);
  return { profile: out, added, upgraded, notFromCv, dropped, proposedName, sourceId, duplicateSource };
}
