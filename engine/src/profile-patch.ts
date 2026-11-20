// applyPatch (design/PROFILE-SCHEMA-v2.md section 7): the ONE door through which an agent changes a profile. CODE decides what is allowed, stamps provenance and records how to undo;
// the model only proposes ops. Interviewer writes to the locked block (name, contact, right to work) are always refused. Every interviewer op starts as `review` unless the caller
// passes a `confirmation` (the user pressed "Yes, save it" in the chat): then it is trusted, origin `said`, with the user's own words as the quote.
import { validateProfile2 } from "./profile-v2.ts";
import type { Meta, Profile2 } from "./profile-v2.ts";

export type Actor = "user" | "import" | "interviewer" | "system";
export type PatchOp =
  | { op: "addBullet"; roleId: string; text: string; tags?: string[] }
  | { op: "editBullet"; id: string; text: string }
  | { op: "removeBullet"; id: string }
  | { op: "removeSkill"; name: string }
  | { op: "removeFact"; kind: "education" | "language" | "certification" | "project"; id: string }
  | { op: "addRole"; title: string; company: string; location?: string; start?: { y: number; m: number }; end?: { y: number; m: number } | "present" }
  | { op: "removeRole"; id: string }
  | { op: "addSkill"; name: string; group?: string }
  | { op: "addEducation"; text: string }
  | { op: "addLanguage"; name: string; level: "native" | "fluent" | "professional" | "basic" }
  | { op: "addCertification"; name: string; issuer?: string; year?: number }
  | { op: "addProject"; name: string; text: string }
  | { op: "setLocked"; field: "name" | "city" | "country" | "email" | "phone" | "linkedin" | "rightToWork"; value: string };
export type Confirmation = { quote: string; at: string }; // the user's own words, captured by the app, never by the model
export type PatchResult = { ok: true; profile: Profile2; undo: PatchOp[]; touched: string[] } | { ok: false; reason: "locked" | "not_found" | "invalid" | "too_long" | "duplicate"; detail: string };

let seq = 0; const nid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const MAX_OPS = 20, MAX_TEXT = 400;

export function applyPatch(prev: Profile2, ops: PatchOp[], actor: Actor, o: { now: string; confirmation?: Confirmation }): PatchResult {
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > MAX_OPS) return { ok: false, reason: "invalid", detail: `a patch has 1 to ${MAX_OPS} operations` };
  const p = clone(prev), undo: PatchOp[] = [], touched: string[] = [];
  const meta = (): Meta => {
    if (actor === "interviewer") return o.confirmation ? { origin: "said", trust: "trusted", addedAt: o.now, confirmedIn: "conversation", quote: o.confirmation.quote.slice(0, 500), acceptedAt: o.confirmation.at, acceptedBy: "user" } : { origin: "said", trust: "review", addedAt: o.now };
    if (actor === "import") return { origin: "cv", trust: "review", addedAt: o.now };
    return { origin: "typed", trust: "trusted", addedAt: o.now };
  };
  const findBullet = (id: string) => { for (const r of p.facts.roles) { const i = r.bullets.findIndex((b) => b.id === id); if (i >= 0) return { r, i }; } return null; };
  for (const op of ops) {
    if (op.op === "setLocked") { // hard facts: only the user, ever
      if (actor !== "user") return { ok: false, reason: "locked", detail: `${op.field} is a hard fact: only you can change it` };
      const L = p.locked, v = String(op.value ?? "").slice(0, 200);
      if (op.field === "rightToWork") { undo.push({ op: "setLocked", field: op.field, value: L.work.rightToWork }); L.work.rightToWork = v; }
      else if (op.field === "name" || op.field === "city" || op.field === "country") { undo.push({ op: "setLocked", field: op.field, value: L.identity[op.field] }); L.identity[op.field] = v; }
      else { undo.push({ op: "setLocked", field: op.field, value: L.contact[op.field] ?? "" }); if (v) L.contact[op.field] = v; else delete L.contact[op.field]; }
      touched.push(op.field); continue;
    }
    if (op.op === "removeRole") { if (actor === "interviewer" && !o.confirmation) return { ok: false, reason: "invalid", detail: "a removal needs the user's yes" }; const i = p.facts.roles.findIndex((r) => r.id === op.id); if (i < 0) return { ok: false, reason: "not_found", detail: "that role does not exist" }; p.facts.roles.splice(i, 1); touched.push(op.id); continue; }
    if (op.op === "addRole") {
      const title = String(op.title ?? "").replace(/\s+/g, " ").trim().slice(0, 120), company = String(op.company ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (!title || !company) return { ok: false, reason: "invalid", detail: "a role needs a title and a company" };
      const ymOk = (d: { y: number; m: number } | undefined) => !d || (Number.isInteger(d.y) && d.y >= 1950 && d.y <= 2100 && Number.isInteger(d.m) && d.m >= 1 && d.m <= 12);
      if (!ymOk(op.start) || (op.end !== "present" && !ymOk(op.end as { y: number; m: number } | undefined))) return { ok: false, reason: "invalid", detail: "that date is not a real month" };
      if (p.facts.roles.some((r) => norm(r.title) === norm(title) && norm(r.company) === norm(company))) return { ok: false, reason: "duplicate", detail: "that role is already there" };
      const r = { id: nid("r"), title, company, location: String(op.location ?? "").trim().slice(0, 120), start: op.start ?? null, end: op.end ?? null, bullets: [], meta: meta() };
      p.facts.roles.push(r); undo.push({ op: "removeRole", id: r.id }); touched.push(r.id); continue;
    }
    if (op.op === "removeSkill") { const i = p.facts.skills.findIndex((s) => s.name === op.name); if (i < 0) return { ok: false, reason: "not_found", detail: "that skill does not exist" }; if (actor === "interviewer" && !o.confirmation) return { ok: false, reason: "invalid", detail: "a removal needs the user's yes" }; undo.push({ op: "addSkill", name: op.name }); p.facts.skills.splice(i, 1); touched.push(op.name); continue; }
    if (op.op === "removeFact") { if (actor === "interviewer" && !o.confirmation) return { ok: false, reason: "invalid", detail: "a removal needs the user's yes" }; const list = (op.kind === "education" ? p.facts.education : op.kind === "language" ? p.facts.languages : op.kind === "certification" ? p.facts.certifications : p.facts.projects) as { id: string }[]; const i = list.findIndex((x) => x.id === op.id); if (i < 0) return { ok: false, reason: "not_found", detail: "that item does not exist" }; list.splice(i, 1); touched.push(op.id); continue; }
    const text = "text" in op ? op.text : "name" in op ? op.name : "";
    if (typeof text !== "string" || text.length > MAX_TEXT || ("text" in op && !text.trim())) return { ok: false, reason: text.length > MAX_TEXT ? "too_long" : "invalid", detail: "text is empty or longer than 400 characters" };
    if (op.op === "addBullet") {
      const r = p.facts.roles.find((x) => x.id === op.roleId); if (!r) return { ok: false, reason: "not_found", detail: "that role does not exist" };
      if (r.bullets.some((b) => norm(b.text) === norm(op.text))) return { ok: false, reason: "duplicate", detail: "that achievement is already there" };
      const b = { id: nid("b"), text: op.text.trim(), tags: (op.tags ?? []).map((t) => String(t).toLowerCase().slice(0, 30)).slice(0, 3), meta: meta() }; r.bullets.push(b); undo.push({ op: "removeBullet", id: b.id }); touched.push(b.id);
    } else if (op.op === "editBullet") {
      const f = findBullet(op.id); if (!f) return { ok: false, reason: "not_found", detail: "that achievement does not exist" };
      undo.push({ op: "editBullet", id: op.id, text: f.r.bullets[f.i].text }); f.r.bullets[f.i] = { ...f.r.bullets[f.i], text: op.text.trim(), meta: meta() }; touched.push(op.id);
    } else if (op.op === "removeBullet") {
      const f = findBullet(op.id); if (!f) return { ok: false, reason: "not_found", detail: "that achievement does not exist" };
      if (actor === "interviewer" && !o.confirmation) return { ok: false, reason: "invalid", detail: "a removal needs the user's yes" };
      undo.push({ op: "addBullet", roleId: f.r.id, text: f.r.bullets[f.i].text, tags: f.r.bullets[f.i].tags }); f.r.bullets.splice(f.i, 1); touched.push(op.id);
    } else if (op.op === "addSkill") {
      if (p.facts.skills.some((s) => norm(s.name) === norm(op.name))) return { ok: false, reason: "duplicate", detail: "that skill is already there" };
      p.facts.skills.push({ name: op.name.trim(), ...(op.group ? { group: op.group.trim().slice(0, 40) } : {}), meta: meta() }); undo.push({ op: "removeSkill", name: op.name.trim() }); touched.push(op.name);
    } else if (op.op === "addEducation") {
      const e = { id: nid("e"), text: op.text.trim(), meta: meta() }; p.facts.education.push(e); undo.push({ op: "removeFact", kind: "education", id: e.id }); touched.push(e.id);
    } else if (op.op === "addLanguage") {
      if (p.facts.languages.some((l) => norm(l.name) === norm(op.name))) return { ok: false, reason: "duplicate", detail: "that language is already there" };
      const l = { id: nid("l"), name: op.name.trim(), level: op.level, meta: meta() }; p.facts.languages.push(l); undo.push({ op: "removeFact", kind: "language", id: l.id }); touched.push(l.id);
    } else if (op.op === "addCertification") {
      const c = { id: nid("c"), name: op.name.trim(), ...(op.issuer ? { issuer: op.issuer.trim() } : {}), ...(op.year ? { year: op.year } : {}), meta: meta() }; p.facts.certifications.push(c); undo.push({ op: "removeFact", kind: "certification", id: c.id }); touched.push(c.id);
    } else if (op.op === "addProject") {
      const j = { id: nid("j"), name: op.name.trim(), text: op.text.trim(), tags: [] as string[], meta: meta() }; p.facts.projects.push(j); undo.push({ op: "removeFact", kind: "project", id: j.id }); touched.push(j.id);
    } else return { ok: false, reason: "invalid", detail: "unknown operation" };
  }
  const errors = validateProfile2(p, { requireDates: false }).filter((e) => !/identity\.name is empty/.test(e) || p.locked.identity.name.trim());
  if (errors.length) return { ok: false, reason: "invalid", detail: errors[0] };
  p.log = [...p.log, { at: o.now, actor: actor === "interviewer" ? "interviewer" as const : actor === "import" ? "import" as const : actor === "system" ? "system" as const : "user" as const, summary: `${actor}: ${ops.map((x) => x.op).join(", ")}`, before: undo.slice().reverse() }].slice(-500);
  return { ok: true, profile: p, undo: undo.slice().reverse(), touched };
}
