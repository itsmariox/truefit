// Adapter: reads a markdown persona (facts.md, bullet-bank.md, archetypes.md) into a Profile, so an existing persona can run on the
// generic engine and be compared with the old parser. Generic on purpose: no employer or person names in this file.
// Identity and Rules are not parseable from prose reliably, so the caller supplies them.
// Deliberate mapping: status `cv` (on the old CV, not re-checked) becomes `verified`, exactly as the old engine treated it.
import { BULLET_LINE, parseArchetypes, parseSkills, unescapeMd } from "./persona.ts";
import { PROFILE_SCHEMA_VERSION } from "./profile.ts";
import type { DoNotUse, Identity, Profile, ProfileBullet, Role, Rules, Skill, YearMonth } from "./profile.ts";

const slug = (s: string) => (s.trim().split(/\s+/)[0] ?? "role").toLowerCase().replace(/[^a-z0-9]/g, "") || "role";
const DATES = /(\d{2})\/(\d{4})\s*[–-]\s*(?:(\d{2})\/(\d{4})|(present))/i;

export function profileFromMarkdown(files: Record<string, string>, o: { identity: Identity; rules: Rules }): Profile {
  const roles: Role[] = [];
  let current: Role | null = null, skip = false;
  for (const line of (files["bullet-bank.md"] ?? "").split("\n")) {
    const h = line.match(/^## (.+)$/);
    if (h) {
      skip = /candidates|unverified/i.test(h[1]); // "ask before use": never a selectable bullet, as in the old parser
      if (skip) { current = null; continue; }
      const company = h[1].replace(/\s*\(.*$/, "").trim(), detail = (h[1].match(/\((.*)\)\s*$/) ?? [])[1] ?? "";
      const d = detail.match(DATES);
      const start: YearMonth | null = d ? { m: Number(d[1]), y: Number(d[2]) } : null;
      const end: YearMonth | "present" | null = d ? (d[5] ? "present" : { m: Number(d[3]), y: Number(d[4]) }) : null;
      const title = detail.replace(DATES, "").replace(/[,\s]+$/, "").trim() || company;
      current = { id: slug(company), title, company, location: "", start, end, status: "verified", bullets: [] };
      roles.push(current);
      continue;
    }
    if (skip || !current) continue;
    const m = line.match(BULLET_LINE);
    if (!m) continue;
    if (m[4] === "retired") continue; // retired claims are not carried over as bullets
    const b: ProfileBullet = { id: m[1], tags: m[2].split(",").map((t) => t.trim()).filter(Boolean), text: unescapeMd(m[3]).trim(), status: m[4] === "unverified" ? "draft" : "verified" };
    current.bullets.push(b);
  }
  // facts.md is the source of truth for role titles, dates and places ("## Company, Title (MM/YYYY – MM/YYYY, Place)"), and for education.
  const facts = files["facts.md"] ?? "";
  for (const m of facts.matchAll(/^## ([^,\n]+), (.+?) \((\d{2})\/(\d{4}) [–-] (?:(\d{2})\/(\d{4})|(present))(?:, ([^)]+))?\)/gim)) {
    const role = roles.find((r) => r.id === slug(m[1]));
    if (!role) continue;
    role.title = m[2].trim(); role.start = { m: Number(m[3]), y: Number(m[4]) };
    role.end = m[7] ? "present" : { m: Number(m[5]), y: Number(m[6]) };
    if (m[8]) role.location = m[8].trim();
  }
  const education: Profile["education"] = [];
  const edu = facts.match(/^- Education:\s*(.+)$/m)?.[1];
  if (edu) edu.split(";").forEach((part, i) => {
    const text = part.replace(/`[^`]*`/g, "").replace(/\s+/g, " ").trim().replace(/[.,]$/, "");
    if (text) education.push({ id: `edu-${i + 1}`, text, status: /`(confirmed|cv)`/.test(part) ? "verified" : /`(unverified|pending)`/.test(part) ? "draft" : "verified" });
  });
  const sk = parseSkills(facts);
  const skills: Skill[] = [...sk.allowed.map((name) => ({ name, status: "verified" as const })), ...sk.unverified.map((name) => ({ name, status: "draft" as const }))];
  const doNotUse: DoNotUse[] = [
    ...sk.removed.map((text, i) => ({ id: `skill-${i + 1}`, kind: "skill" as const, text, note: "removed from the persona" })),
    ...sk.knownGaps.map((text, i) => ({ id: `gap-${i + 1}`, kind: "gap" as const, text, note: "known gap" })),
  ];
  const focusTypes = parseArchetypes(files["archetypes.md"] ?? "").map((a) => ({ id: a.id, name: a.name, headline: a.headline, leadTags: a.tags, status: "verified" as const }));
  return { schemaVersion: PROFILE_SCHEMA_VERSION, identity: o.identity, roles, skills, education, focusTypes, doNotUse, rules: o.rules };
}
