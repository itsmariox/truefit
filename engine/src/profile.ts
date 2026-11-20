// The structured profile: the single source of truth for one user's career facts (PRD 02, 15). Pure functions, no AI, no files.
// profileToPersona() turns it into the `Persona` shape the rest of the engine already consumes, so rules, pipeline and agents
// keep working unchanged while they are made generic in the next steps.
//
// Trust: only "verified" items ever reach `text`, `bullets`, `skills.allowed`, `numbers` or the stories. Drafts and Do-not-use items are
// kept in code-only fields. Identity (name, email, phone, LinkedIn) never reaches a model: the CV header is filled by code.
import { createHash } from "node:crypto";
import { PHONE, maskContacts, minimise, numberTokens } from "./persona.ts";
import type { Archetype, Bullet, Persona } from "./persona.ts";

export const PROFILE_SCHEMA_VERSION = 1;
export type Status = "draft" | "verified";
export type YearMonth = { y: number; m: number }; // m is 1 to 12
export type Item = { text: string; status: Status };

export type ProfileBullet = { id: string; text: string; tags: string[]; status: Status; onlyForFocus?: number[] }; // onlyForFocus: usable only when the CV leads with one of these focus types
export type Role = {
  id: string; title: string; company: string; location: string;
  start: YearMonth | null; end: YearMonth | "present" | null; // null only for imported, undated roles (validation flags it)
  status: Status; bullets: ProfileBullet[]; story?: Item;
};
export type Skill = { name: string; status: Status; group?: string };
// Extras: languages, certifications and projects. Printed by CODE word for word on the CV (like education), never rewritten. Absent when there are none.
export type ExtraLanguage = { id: string; name: string; level: "native" | "fluent" | "professional" | "basic"; status: Status };
export type ExtraCertification = { id: string; name: string; issuer?: string; year?: number; status: Status };
export type ExtraProject = { id: string; name: string; text: string; status: Status };
export type Extras = { languages: ExtraLanguage[]; certifications: ExtraCertification[]; projects: ExtraProject[] };
export const LANGUAGE_LEVELS = ["native", "fluent", "professional", "basic"] as const;
export const extraLines = (x: Extras | undefined) => ({
  languages: (x?.languages ?? []).filter((l) => l.status === "verified").map((l) => `${l.name.trim()} (${l.level})`),
  certifications: (x?.certifications ?? []).filter((c) => c.status === "verified").map((c) => [c.name.trim(), c.issuer?.trim(), c.year ? String(c.year) : ""].filter(Boolean).join(", ")),
  projects: (x?.projects ?? []).filter((j) => j.status === "verified").map((j) => `${j.name.trim()}: ${j.text.trim()}`),
});
export type FocusType = { id: number; name: string; headline: string; leadTags: string[]; status: Status };
// kind: "phrase" = a wording or claim that must never appear; "skill" = a skill that must never be listed; "gap" = something the user lacks.
export type DoNotUse = { id: string; kind: "phrase" | "skill" | "gap"; text: string; note: string };
export type Identity = { name: string; email?: string; phone?: string; linkedin?: string; city: string; country: string };
export type Rules = {
  salaryFloor: { amount: number; currency: string } | null;
  location: { current: string; targets: string[]; workModes: ("onsite" | "hybrid" | "remote")[]; cvLocationLines: string[] };
  seniority: { levels: string[]; avoid: string[] };
  rightToWork: { statement: string; needsSponsorship: boolean };
  avoidRoles: string[];
  availability?: string; // optional, free text such as "available immediately" or "one month notice"; used by cover notes, recruiter messages and the verdict
};
export type Profile = {
  schemaVersion: number;
  identity: Identity;
  roles: Role[];
  skills: Skill[];
  education: (Item & { id: string })[];
  extras?: Extras;
  focusTypes: FocusType[];
  doNotUse: DoNotUse[];
  rules: Rules;
};

const STATUSES = new Set(["draft", "verified"]);
const CONTACT = new RegExp(`@[A-Za-z0-9-]+\\.[A-Za-z]{2,}|linkedin\\.com|${PHONE.source}`, "i");
const ym = (d: YearMonth) => d.y * 12 + (d.m - 1);
const validYm = (d: unknown): d is YearMonth => !!d && typeof d === "object" && Number.isInteger((d as YearMonth).y) && (d as YearMonth).y >= 1950 && (d as YearMonth).y <= 2100 && Number.isInteger((d as YearMonth).m) && (d as YearMonth).m >= 1 && (d as YearMonth).m <= 12;

export function validateProfile(p: Profile, o: { requireDates?: boolean } = {}): string[] {
  const requireDates = o.requireDates ?? true;
  const e: string[] = [];
  if (p?.schemaVersion !== PROFILE_SCHEMA_VERSION) e.push(`schemaVersion is ${p?.schemaVersion}; this engine reads version ${PROFILE_SCHEMA_VERSION}`);
  if (!p || typeof p !== "object") return e.concat("the profile is not an object");
  const free = (where: string, s: string) => { if (CONTACT.test(s)) e.push(`${where} contains an email, phone number or LinkedIn link; contact details belong in identity only`); };
  const status = (where: string, s: string) => { if (!STATUSES.has(s)) e.push(`${where} has status "${s}" (draft or verified)`); };
  if (!p.identity?.name?.trim()) e.push("identity.name is empty");
  const roleIds = new Set<string>(), bulletIds = new Set<string>();
  for (const r of p.roles ?? []) {
    if (!r.id || roleIds.has(r.id)) e.push(`role id "${r.id}" is missing or repeated`); roleIds.add(r.id);
    if (!r.title?.trim() || !r.company?.trim()) e.push(`role ${r.id}: title and company are required`);
    status(`role ${r.id}`, r.status);
    if (requireDates) {
      if (!validYm(r.start)) e.push(`role ${r.id}: start date missing or invalid`);
      if (r.end !== "present" && !validYm(r.end)) e.push(`role ${r.id}: end date missing or invalid (use "present" if ongoing)`);
    }
    if (validYm(r.start) && validYm(r.end) && ym(r.end) < ym(r.start)) e.push(`role ${r.id}: ends before it starts`);
    for (const b of r.bullets ?? []) {
      if (!b.id || bulletIds.has(b.id)) e.push(`bullet id "${b.id}" is missing or repeated`); bulletIds.add(b.id);
      if (!b.text?.trim()) e.push(`bullet ${b.id} is empty`);
      status(`bullet ${b.id}`, b.status); free(`bullet ${b.id}`, b.text ?? "");
    }
    if (r.story) { status(`story of ${r.id}`, r.story.status); free(`story of ${r.id}`, r.story.text); }
  }
  for (const s of p.skills ?? []) { status(`skill "${s.name}"`, s.status); free(`skill "${s.name}"`, s.name); }
  for (const x of p.education ?? []) { status(`education ${x.id}`, x.status); free(`education ${x.id}`, x.text); }
  if (p.extras !== undefined) {
    const ex = p.extras, ids = new Set<string>();
    for (const [kind, list] of [["language", ex?.languages], ["certification", ex?.certifications], ["project", ex?.projects]] as const) {
      if (!Array.isArray(list)) { e.push(`extras.${kind}s must be a list`); continue; }
      if (list.length > 30) e.push(`extras has more than 30 ${kind}s`);
      for (const x of list as { id: string; name: string; status: string; text?: string; issuer?: string; level?: string; year?: number }[]) {
        if (!x?.id || ids.has(x.id)) e.push(`${kind} id "${x?.id}" is missing or repeated`); ids.add(x?.id);
        if (typeof x?.name !== "string" || !x.name.trim()) e.push(`${kind} ${x?.id} has no name`); else if (x.name.length > 120) e.push(`${kind} ${x.id} name is too long`);
        status(`${kind} ${x?.id}`, x?.status); free(`${kind} ${x?.id}`, x?.name ?? ""); free(`${kind} ${x?.id}`, x?.text ?? ""); free(`${kind} ${x?.id}`, x?.issuer ?? "");
        if (kind === "language" && !(LANGUAGE_LEVELS as readonly string[]).includes(x?.level ?? "")) e.push(`language ${x?.id} has level "${x?.level}"`);
        if (kind === "project" && (typeof x?.text !== "string" || !x.text.trim() || x.text.length > 400)) e.push(`project ${x?.id} needs a description of up to 400 characters`);
        if (kind === "certification" && x?.year !== undefined && !(Number.isInteger(x.year) && x.year >= 1950 && x.year <= 2100)) e.push(`certification ${x?.id} has a year outside 1950 to 2100`);
      }
    }
  }
  const fids = new Set<number>();
  for (const f of p.focusTypes ?? []) {
    if (!Number.isInteger(f.id) || f.id < 1 || fids.has(f.id)) e.push(`focus type id ${f.id} is missing or repeated`); fids.add(f.id);
    status(`focus type ${f.id}`, f.status); free(`focus type ${f.id}`, f.headline);
  }
  if (p.rules?.availability) free("rules.availability", p.rules.availability);
  for (const d of p.doNotUse ?? []) if (!["phrase", "skill", "gap"].includes(d.kind) || !d.text?.trim()) e.push(`do-not-use item ${d.id} is invalid`);
  return e;
}

// The start gate (PRD 02): identity (name, city, email, country), one role with at least 3 verified bullets, and the Rules page filled in.
export function meetsStartGate(p: Profile): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!p.identity?.name?.trim() || !p.identity.city?.trim()) missing.push("your name and city");
  if (!p.identity?.email?.trim() || !p.identity.country?.trim()) missing.push("your email and country");
  if (!(p.roles ?? []).some((r) => r.bullets.filter((b) => b.status === "verified").length >= 3)) missing.push("one role with at least 3 verified bullets");
  const l = p.rules?.location;
  if (!l?.current?.trim() || !l.workModes?.length || !l.cvLocationLines?.some((x) => x.trim())) missing.push("where you are and where you want to work");
  if (!p.rules?.rightToWork?.statement?.trim()) missing.push("your right to work");
  return { ok: missing.length === 0, missing };
}

// Years of employment from verified, dated roles (overlaps counted once), rounded up. Replaces config.maxClaimedYears.
export function claimedYearsMax(p: Profile, now = new Date()): number {
  const nowYm = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const spans = (p.roles ?? []).filter((r) => r.status === "verified" && validYm(r.start) && (r.end === "present" || validYm(r.end)))
    .map((r) => [ym(r.start as YearMonth), r.end === "present" ? nowYm + 1 : ym(r.end as YearMonth) + 1] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let months = 0, curEnd = -Infinity, curStart = 0;
  for (const [s, en] of spans) {
    if (s > curEnd) { if (curEnd > -Infinity) months += curEnd - curStart; curStart = s; curEnd = en; } else curEnd = Math.max(curEnd, en);
  }
  if (curEnd > -Infinity) months += curEnd - curStart;
  return Math.ceil(months / 12);
}

const fmt = (d: YearMonth | "present" | null) => d === "present" ? "present" : d ? `${String(d.m).padStart(2, "0")}/${d.y}` : "dates not given";
export const cleanText = (s: string) => maskContacts(s).replace(PHONE, "[phone]").replace(/\s+/g, " ").trim();
const clean = cleanText; // second line of defence; validateProfile reports contact details first

const endKey = (r: Role) => r.end === "present" ? Infinity : r.end ? ym(r.end) : -1;
const startKey = (r: Role) => r.start ? ym(r.start) : -1;
const UK_FAMILY = ["uk", "u.k.", "united kingdom", "great britain", "britain"];
const UK_NATIONS = ["england", "scotland", "wales", "northern ireland"];
const norm = (s: string) => s.toLowerCase().replace(/^the\s+/, "").replace(/\s+/g, " ").trim();
// Places the candidate may say they are based in: their city and country (with the UK names if the country is the UK).
function residence(p: Profile): { allowed: string[]; targets: string[] } {
  const country = norm(p.identity.country ?? ""), inUk = UK_FAMILY.includes(country);
  const allowed = [norm(p.identity.city ?? ""), country, ...(inUk ? UK_FAMILY : [])].filter(Boolean);
  const targetPlaces = p.rules.location.targets.flatMap((t) => t.split(/[;,]| and /)).map((t) => norm(t.replace(/\b(remote|hybrid|on-?site|working|work)\b/gi, ""))).filter(Boolean);
  const targets = [...new Set([...targetPlaces, ...(inUk ? [] : [...UK_FAMILY, ...UK_NATIONS])])].filter((t) => !allowed.includes(t));
  return { allowed: [...new Set(allowed)], targets };
}

export type ProfilePersona = Persona & {
  forbiddenPhrases: string[]; maxClaimedYears: number; stories: string;
  roleOrder: string[];                        // role ids, most recent first (ongoing first, undated last)
  residenceAllowed: string[]; residenceTargets: string[]; // lower-case places: where the candidate is, and where they only want to work
  focusRestrictions: Record<string, number[]>; // bullet id -> focus type ids it may be used under
  roleTerms: string[];                         // titles and companies of the verified roles: a reworded bullet may not swap or add one
};

export function profileToPersona(p: Profile, now = new Date()): ProfilePersona {
  const roles = p.roles.filter((r) => r.status === "verified");
  const bullets: Bullet[] = roles.flatMap((r) => r.bullets.filter((b) => b.status === "verified").map((b) => ({
    id: b.id, tags: b.tags, text: clean(b.text), status: "confirmed", employer: r.id, ventureOnly: b.tags.includes("venture-only"),
  })));
  const verifiedSkills = p.skills.filter((s) => s.status === "verified");
  const archetypes: Archetype[] = p.focusTypes.filter((f) => f.status === "verified").sort((a, b) => a.id - b.id)
    .map((f) => ({ id: f.id, name: f.name, headline: f.headline, tags: f.leadTags }));
  const skills = {
    allowed: verifiedSkills.map((s) => s.name),
    removed: p.doNotUse.filter((d) => d.kind === "skill").map((d) => d.text),
    unverified: p.skills.filter((s) => s.status === "draft").map((s) => s.name),
    knownGaps: p.doNotUse.filter((d) => d.kind === "gap").map((d) => d.text),
  };
  const lines: string[] = ["## Roles"];
  for (const r of roles) {
    lines.push(`${r.title}, ${r.company}, ${fmt(r.start)} - ${fmt(r.end)}, ${r.location}`);
    for (const b of r.bullets.filter((x) => x.status === "verified")) lines.push(`- [${b.id}] [${b.tags.join(", ")}] ${clean(b.text)}`); // the id and tags sit outside the text, which stays verbatim
  }
  lines.push("", "## Skills", verifiedSkills.map((s) => s.name).join("; "));
  const edu = p.education.filter((x) => x.status === "verified");
  if (edu.length) lines.push("", "## Education", ...edu.map((x) => `- ${clean(x.text)}`));
  const xl = extraLines(p.extras);
  for (const [h, list] of [["Languages", xl.languages], ["Certifications", xl.certifications], ["Projects", xl.projects]] as const) if (list.length) lines.push("", `## ${h}`, ...list.map((x) => `- ${clean(x)}`));
  if (archetypes.length) lines.push("", "## Focus types", ...archetypes.map((a) => `${a.id}. ${a.headline} (lead tags: ${a.tags.join(", ")})`));
  const ru = p.rules, floor = ru.salaryFloor;
  lines.push("", "## Rules",
    `- Salary floor: ${floor ? `${floor.currency} ${floor.amount.toLocaleString("en-GB")}` : "none set"}`,
    `- Based in: ${ru.location.current}. Wants: ${ru.location.targets.join("; ") || "not stated"}. Work modes: ${ru.location.workModes.join(", ")}`,
    `- Allowed CV location lines: ${ru.location.cvLocationLines.map((x) => `"${x}"`).join(" or ")}`,
    `- Seniority: ${ru.seniority.levels.join(", ") || "not stated"}. Avoid: ${ru.seniority.avoid.join(", ") || "none"}`,
    `- Right to work: ${ru.rightToWork.statement}${ru.rightToWork.needsSponsorship ? " (needs sponsorship)" : " (no sponsorship needed)"}`,
    `- Roles to avoid: ${ru.avoidRoles.join("; ") || "none"}`,
    ...(ru.availability?.trim() ? [`- Availability: ${clean(ru.availability)}`] : []));
  const text = `<profile>\n${minimise(lines.join("\n"))}\n</profile>`; // Do-not-use items and drafts are deliberately absent: the code enforces them
  const stories = roles.filter((r) => r.story?.status === "verified").map((r) => `${r.title}, ${r.company}: ${clean(r.story!.text)}`).join("\n\n");
  return {
    text, hash: createHash("sha256").update(text).digest("hex").slice(0, 16), files: {},
    bullets, skills, archetypes,
    numbers: new Set(bullets.flatMap((b) => numberTokens(b.text))), // verified bullets only: no dates, no Rules, no drafts
    forbiddenPhrases: p.doNotUse.filter((d) => d.kind === "phrase").map((d) => d.text),
    maxClaimedYears: claimedYearsMax(p, now), stories,
    roleOrder: roles.slice().sort((a, b) => endKey(b) - endKey(a) || startKey(b) - startKey(a)).map((r) => r.id), // by how recently each role ended (ongoing first), then by start
    roleTerms: [...new Set(roles.flatMap((r) => [r.title, r.company]).filter((x) => x.trim().length > 1))],
    residenceAllowed: residence(p).allowed, residenceTargets: residence(p).targets,
    focusRestrictions: Object.fromEntries(roles.flatMap((r) => r.bullets.filter((b) => b.status === "verified" && b.onlyForFocus?.length).map((b) => [b.id, b.onlyForFocus!]))),
  };
}
