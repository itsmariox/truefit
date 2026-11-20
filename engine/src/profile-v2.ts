// Profile schema v2 (design/PROFILE-SCHEMA-v2.md, phase 1 step A): the stored shape. Provenance decides trust (set by CODE, never by a model); hard facts are locked; the rest of the engine
// keeps reading the v1 SHAPE through `toV1View` (trusted -> verified, review -> draft), so the pipeline, the agents, the CV builder, Telegram and the current profile page do not change.
// Saves from the current page come back through `applyV1Edit`, which keeps everything the v1 view cannot carry (provenance, sources, languages, certifications, projects, the undo log).
import { PHONE } from "./persona.ts";
import { validateProfile } from "./profile.ts";
import type { DoNotUse, Extras, Profile, Rules, Status, YearMonth } from "./profile.ts";

export const PROFILE_V2_VERSION = 2;
export type Trust = "trusted" | "review";
export type Origin = "cv" | "said" | "typed" | "inferred" | "legacy";
export type Meta = { origin: Origin; trust: Trust; addedAt: string; sourceId?: string; quote?: string; confirmedIn?: "conversation"; acceptedAt?: string; acceptedBy?: "user" };
export type Bullet2 = { id: string; text: string; tags: string[]; metrics?: string[]; onlyForLenses?: number[]; meta: Meta };
export type RoleClaim = { sourceId: string; title: string; start: YearMonth | null; end: YearMonth | "present" | null }; // what one source said about the role (the contradiction detector compares them)
export type Role2 = { id: string; title: string; company: string; location: string; start: YearMonth | null; end: YearMonth | "present" | null; bullets: Bullet2[]; story?: { text: string; meta: Meta }; claims?: RoleClaim[]; meta: Meta };
export type Skill2 = { name: string; group?: string; level?: "core" | "working" | "familiar"; meta: Meta };
export type Education2 = { id: string; text: string; meta: Meta };
export type Language2 = { id: string; name: string; level: "native" | "fluent" | "professional" | "basic"; meta: Meta };
export type Certification2 = { id: string; name: string; issuer?: string; year?: number; meta: Meta };
export type Project2 = { id: string; name: string; text: string; tags: string[]; meta: Meta };
export type Lens2 = { id: number; name: string; headline: string; leadTags: string[]; meta: Meta };
export type Locked = {
  identity: { name: string; city: string; country: string };
  contact: { email?: string; phone?: string; linkedin?: string; links: string[] };
  work: { rightToWork: string; needsSponsorship: boolean; visaNote?: string };
};
export type Preferences = Omit<Rules, "rightToWork">;
export type Source = { id: string; kind: "cv" | "interview"; label: string; addedAt: string; textHash: string; text?: string };
export type Change = { at: string; actor: "user" | "import" | "interviewer" | "system"; summary: string; before?: unknown };
export type Profile2 = {
  schemaVersion: 2;
  locked: Locked;
  facts: { roles: Role2[]; skills: Skill2[]; education: Education2[]; languages: Language2[]; certifications: Certification2[]; projects: Project2[] };
  lenses: Lens2[];
  preferences: Preferences;
  guards: DoNotUse[];
  sources: Source[];
  review: { dismissed: string[]; unchecked?: ("name" | "email" | "phone" | "linkedin")[] }; // unchecked: locked fields the CV import filled in that the user has not yet confirmed or edited
  log: Change[];
};

const NOW0 = "1970-01-01T00:00:00.000Z";
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const trustOf = (s: Status): Trust => (s === "verified" ? "trusted" : "review");
const statusOf = (t: Trust): Status => (t === "trusted" ? "verified" : "draft");
const legacy = (s: Status, now: string): Meta => ({ origin: "legacy", trust: trustOf(s), addedAt: now });
const drop = <T extends object>(o: T): T => { for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k]; return o; };

// ---------- v1 -> v2 (on read; nothing is written by this function) ----------
export function migrateV1ToV2(p: Profile, now: string = NOW0): Profile2 {
  const rt = p.rules?.rightToWork ?? { statement: "", needsSponsorship: false };
  const { rightToWork: _rt, ...prefs } = p.rules ?? ({} as Rules); void _rt;
  return {
    schemaVersion: 2,
    locked: {
      identity: { name: p.identity?.name ?? "", city: p.identity?.city ?? "", country: p.identity?.country ?? "" },
      contact: drop({ email: p.identity?.email || undefined, phone: p.identity?.phone || undefined, linkedin: p.identity?.linkedin || undefined, links: [] as string[] }),
      work: { rightToWork: rt.statement ?? "", needsSponsorship: !!rt.needsSponsorship },
    },
    facts: {
      roles: (p.roles ?? []).map((r) => drop({
        id: r.id, title: r.title, company: r.company, location: r.location, start: r.start, end: r.end,
        bullets: (r.bullets ?? []).map((b) => drop({ id: b.id, text: b.text, tags: [...(b.tags ?? [])], onlyForLenses: b.onlyForFocus ? [...b.onlyForFocus] : undefined, meta: legacy(b.status, now) })),
        story: r.story ? { text: r.story.text, meta: legacy(r.story.status, now) } : undefined, meta: legacy(r.status, now),
      })),
      skills: (p.skills ?? []).map((s) => drop({ name: s.name, group: s.group, meta: legacy(s.status, now) })),
      education: (p.education ?? []).map((e) => ({ id: e.id, text: e.text, meta: legacy(e.status, now) })),
      languages: (p.extras?.languages ?? []).map((l) => ({ id: l.id, name: l.name, level: l.level, meta: legacy(l.status, now) })),
      certifications: (p.extras?.certifications ?? []).map((c) => drop({ id: c.id, name: c.name, issuer: c.issuer, year: c.year, meta: legacy(c.status, now) })),
      projects: (p.extras?.projects ?? []).map((j) => ({ id: j.id, name: j.name, text: j.text, tags: [] as string[], meta: legacy(j.status, now) })),
    },
    lenses: (p.focusTypes ?? []).map((f) => ({ id: f.id, name: f.name, headline: f.headline, leadTags: [...(f.leadTags ?? [])], meta: legacy(f.status, now) })),
    preferences: clone(prefs) as Preferences,
    guards: clone(p.doNotUse ?? []),
    sources: [], review: { dismissed: [] }, log: [],
  };
}

// ---------- v2 -> the v1 shape the rest of the engine reads ----------
// Languages, certifications and projects ride along as an optional `extras` block (left out when there are none, so a profile without them is byte for byte what it was).
const extrasView = (p: Profile2): { extras?: Extras } => {
  const f = p.facts; if (!f.languages.length && !f.certifications.length && !f.projects.length) return {};
  return { extras: {
    languages: f.languages.map((l) => ({ id: l.id, name: l.name, level: l.level, status: statusOf(l.meta.trust) })),
    certifications: f.certifications.map((c) => drop({ id: c.id, name: c.name, issuer: c.issuer, year: c.year, status: statusOf(c.meta.trust) })),
    projects: f.projects.map((j) => ({ id: j.id, name: j.name, text: j.text, status: statusOf(j.meta.trust) })),
  } };
};
export function toV1View(p: Profile2): Profile {
  const c = p.locked.contact;
  return {
    schemaVersion: 1,
    identity: drop({ name: p.locked.identity.name, email: c.email, phone: c.phone, linkedin: c.linkedin, city: p.locked.identity.city, country: p.locked.identity.country }),
    roles: p.facts.roles.map((r) => drop({
      id: r.id, title: r.title, company: r.company, location: r.location, start: r.start, end: r.end, status: statusOf(r.meta.trust),
      bullets: r.bullets.map((b) => drop({ id: b.id, text: b.text, tags: [...b.tags], status: statusOf(b.meta.trust), onlyForFocus: b.onlyForLenses ? [...b.onlyForLenses] : undefined })),
      story: r.story ? { text: r.story.text, status: statusOf(r.story.meta.trust) } : undefined,
    })),
    skills: p.facts.skills.map((s) => drop({ name: s.name, status: statusOf(s.meta.trust), group: s.group })),
    education: p.facts.education.map((e) => ({ id: e.id, text: e.text, status: statusOf(e.meta.trust) })),
    ...extrasView(p),
    focusTypes: p.lenses.map((f) => ({ id: f.id, name: f.name, headline: f.headline, leadTags: [...f.leadTags], status: statusOf(f.meta.trust) })),
    doNotUse: clone(p.guards),
    rules: { ...clone(p.preferences), rightToWork: { statement: p.locked.work.rightToWork, needsSponsorship: p.locked.work.needsSponsorship } },
  };
}

// ---------- a save from the current (v1) page, applied onto the stored v2 profile ----------
// What is unchanged keeps its meta byte for byte. A changed text becomes the user's own (`typed`). The v1 status decides trust (the page still has its ticks in this phase).
function metaFor(prev: Meta | undefined, status: Status, changed: boolean, now: string): Meta {
  const trust = trustOf(status);
  if (!prev) return { origin: "typed", trust, addedAt: now };
  if (!changed && prev.trust === trust) return prev;
  const m: Meta = { ...prev, trust };
  if (changed) { m.origin = "typed"; delete m.sourceId; delete m.quote; delete m.confirmedIn; }
  if (trust === "trusted" && prev.trust !== "trusted") { m.acceptedAt = now; m.acceptedBy = "user"; }
  return m;
}
const byKey = <T>(xs: T[], key: (x: T) => string) => new Map(xs.map((x) => [key(x), x] as const));
export function applyV1Edit(prev: Profile2, v1: Profile, now: string): Profile2 {
  const out = clone(prev);
  const id = v1.identity ?? ({} as Profile["identity"]), rt = v1.rules?.rightToWork ?? { statement: "", needsSponsorship: false };
  out.locked.identity = { name: id.name ?? "", city: id.city ?? "", country: id.country ?? "" };
  // editing a field the import filled in counts as checking it
  if (out.review.unchecked?.length) { const was = prev.locked, now2: Record<string, string | undefined> = { name: out.locked.identity.name, email: id.email || undefined, phone: id.phone || undefined, linkedin: id.linkedin || undefined }, before: Record<string, string | undefined> = { name: was.identity.name, email: was.contact.email, phone: was.contact.phone, linkedin: was.contact.linkedin }; out.review.unchecked = out.review.unchecked.filter((k) => now2[k] === before[k]); if (!out.review.unchecked.length) delete out.review.unchecked; }
  out.locked.contact = drop({ email: id.email || undefined, phone: id.phone || undefined, linkedin: id.linkedin || undefined, links: prev.locked.contact.links });
  out.locked.work = drop({ rightToWork: rt.statement ?? "", needsSponsorship: !!rt.needsSponsorship, visaNote: prev.locked.work.visaNote });
  const { rightToWork: _rt, ...prefs } = v1.rules ?? ({} as Rules); void _rt; out.preferences = clone(prefs) as Preferences;
  out.guards = clone(v1.doNotUse ?? []);
  const prevRoles = byKey(prev.facts.roles, (r) => r.id);
  out.facts.roles = (v1.roles ?? []).map((r) => {
    const pr = prevRoles.get(r.id), pb = byKey(pr?.bullets ?? [], (b) => b.id);
    const changed = !!pr && (pr.title !== r.title || pr.company !== r.company || pr.location !== r.location || !same(pr.start, r.start) || !same(pr.end, r.end));
    const bullets = (r.bullets ?? []).map((b) => {
      const o = pb.get(b.id), textChanged = !!o && o.text !== b.text;
      return drop({ id: b.id, text: b.text, tags: [...(b.tags ?? [])], metrics: o?.metrics, onlyForLenses: b.onlyForFocus ? [...b.onlyForFocus] : undefined, meta: metaFor(o?.meta, b.status, textChanged, now) });
    });
    const story = r.story ? { text: r.story.text, meta: metaFor(pr?.story?.meta, r.story.status, !!pr?.story && pr.story.text !== r.story.text, now) } : undefined;
    return drop({ id: r.id, title: r.title, company: r.company, location: r.location, start: r.start, end: r.end, bullets, story, claims: pr?.claims, meta: metaFor(pr?.meta, r.status, changed, now) });
  });
  const ps = byKey(prev.facts.skills, (s) => s.name);
  out.facts.skills = (v1.skills ?? []).map((s) => { const o = ps.get(s.name); return drop({ name: s.name, group: s.group, level: o?.level, meta: metaFor(o?.meta, s.status, false, now) }); });
  const pe = byKey(prev.facts.education, (e) => e.id);
  out.facts.education = (v1.education ?? []).map((e) => { const o = pe.get(e.id); return { id: e.id, text: e.text, meta: metaFor(o?.meta, e.status, !!o && o.text !== e.text, now) }; });
  if (v1.extras !== undefined) { // a page that sends no `extras` leaves them alone; one that sends it (even empty) is the new truth
    const x = v1.extras, pLang = byKey(prev.facts.languages, (l) => l.id), pCert = byKey(prev.facts.certifications, (c) => c.id), pProj = byKey(prev.facts.projects, (j) => j.id);
    out.facts.languages = (x.languages ?? []).map((l) => { const o = pLang.get(l.id); return { id: l.id, name: l.name, level: l.level, meta: metaFor(o?.meta, l.status, !!o && (o.name !== l.name || o.level !== l.level), now) }; });
    out.facts.certifications = (x.certifications ?? []).map((c) => { const o = pCert.get(c.id); return drop({ id: c.id, name: c.name, issuer: c.issuer, year: c.year, meta: metaFor(o?.meta, c.status, !!o && (o.name !== c.name || o.issuer !== c.issuer || o.year !== c.year), now) }); });
    out.facts.projects = (x.projects ?? []).map((j) => { const o = pProj.get(j.id); return { id: j.id, name: j.name, text: j.text, tags: o?.tags ?? [], meta: metaFor(o?.meta, j.status, !!o && (o.name !== j.name || o.text !== j.text), now) }; });
  }
  const pl = byKey(prev.lenses, (l) => String(l.id));
  out.lenses = (v1.focusTypes ?? []).map((f) => { const o = pl.get(String(f.id)); return { id: f.id, name: f.name, headline: f.headline, leadTags: [...(f.leadTags ?? [])], meta: metaFor(o?.meta, f.status, !!o && (o.name !== f.name || o.headline !== f.headline), now) }; });
  return out;
}

// ---------- validation ----------
const CONTACT = new RegExp(`@[A-Za-z0-9-]+\\.[A-Za-z]{2,}|linkedin\\.com|${PHONE.source}`, "i");
const ORIGINS = new Set(["cv", "said", "typed", "inferred", "legacy"]);
export function validateProfile2(p: Profile2, o: { requireDates?: boolean } = {}): string[] {
  if (!p || typeof p !== "object") return ["the profile is not an object"];
  if (p.schemaVersion !== PROFILE_V2_VERSION) return [`schemaVersion is ${p.schemaVersion}; this reader expects ${PROFILE_V2_VERSION}`];
  const e: string[] = [];
  for (const k of ["locked", "facts", "lenses", "preferences", "guards", "sources", "review", "log"] as const) if (!(k in p)) e.push(`${k} is missing`);
  if (e.length) return e;
  const sources = new Set(p.sources.map((s) => s.id));
  const metaOk = (where: string, m: Meta | undefined) => {
    if (!m || !ORIGINS.has(m.origin) || (m.trust !== "trusted" && m.trust !== "review")) { e.push(`${where} has no valid provenance`); return; }
    if (m.sourceId && !sources.has(m.sourceId)) e.push(`${where} points at a source that does not exist`);
  };
  const free = (where: string, s: string | undefined) => { if (s && CONTACT.test(s)) e.push(`${where} contains an email, phone number or LinkedIn link; contact details belong in the locked block only`); };
  const f = p.facts;
  for (const r of f.roles) { metaOk(`role ${r.id}`, r.meta); if (r.story) metaOk(`story of ${r.id}`, r.story.meta); for (const b of r.bullets) metaOk(`bullet ${b.id}`, b.meta); }
  f.skills.forEach((s) => metaOk(`skill "${s.name}"`, s.meta)); f.education.forEach((x) => metaOk(`education ${x.id}`, x.meta)); p.lenses.forEach((l) => metaOk(`lens ${l.id}`, l.meta));
  const ids = new Set<string>();
  for (const [kind, list] of [["language", f.languages], ["certification", f.certifications], ["project", f.projects]] as const) for (const x of list as { id: string; meta: Meta; name: string }[]) {
    if (!x.id || ids.has(x.id)) e.push(`${kind} id "${x.id}" is missing or repeated`); ids.add(x.id);
    if (!x.name?.trim()) e.push(`${kind} ${x.id} has no name`); metaOk(`${kind} ${x.id}`, x.meta); free(`${kind} ${x.id}`, x.name);
  }
  f.projects.forEach((x) => free(`project ${x.id}`, x.text)); f.certifications.forEach((x) => free(`certification ${x.id}`, x.issuer));
  p.sources.forEach((s) => { if (!s.id || !s.textHash) e.push("a source has no id or fingerprint"); });
  if (e.some((x) => /provenance|source that does not exist/.test(x))) return e; // the v1 view below needs every meta
  e.unshift(...validateProfile(toV1View(p), { requireDates: o.requireDates ?? false }));
  if (p.log.length > 500) e.push("the change log is longer than 500 entries");
  if (!Array.isArray(p.review.dismissed)) e.push("review.dismissed must be a list");
  return e;
}

// ---------- helpers other modules use ----------
export const emptyProfile2 = (now: string = NOW0): Profile2 => migrateV1ToV2({ schemaVersion: 1, identity: { name: "", city: "", country: "" }, roles: [], skills: [], education: [], focusTypes: [], doNotUse: [], rules: { salaryFloor: null, location: { current: "", targets: [], workModes: [], cvLocationLines: [] }, seniority: { levels: [], avoid: [] }, rightToWork: { statement: "", needsSponsorship: false }, avoidRoles: [] } }, now);
export const isV2 = (x: unknown): x is Profile2 => !!x && typeof x === "object" && (x as { schemaVersion?: number }).schemaVersion === PROFILE_V2_VERSION;
