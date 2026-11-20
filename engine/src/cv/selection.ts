// The generic CV selection and its rules (phase 1 step 3). Built BESIDE the old rules.ts, which stays until the single cutover in step 7.
// The Writer proposes; this decides. Pure functions. Nothing here names a person, an employer or a place: everything comes from the
// profile (via ProfilePersona): roles, focus types, Do-not-use phrases, residence, years, and which bullets belong to which focus type.
import { numberTokens } from "../persona.ts";
import { cleanText } from "../profile.ts";
import { validateRewrite } from "./reword.ts";
import type { Bullet } from "../persona.ts";
import type { ProfilePersona } from "../profile.ts";

export type CvSelection = {
  focus_id: number | null;                       // null only when the profile has no verified focus types (the headline then falls back to the latest role title)
  summary: string;
  achievements: { id: string; bold: string }[];
  roles: { role: string; bullets: string[] }[];  // every role that has a selectable bullet, most recent first
  skills: string[];                              // one ordered list; grouping happens at render time from the profile
  questions: string[];
  notes: string;
  rewrites?: { id: string; text: string }[];     // light-rewording mode only: bullets the Writer reworded (already cleaned); the CV prints these instead of the originals
};
export type SelectionContext = Pick<ProfilePersona, "bullets" | "skills" | "archetypes" | "numbers" | "forbiddenPhrases" | "maxClaimedYears" | "roleOrder" | "residenceAllowed" | "residenceTargets" | "focusRestrictions" | "roleTerms">;

export const ACHIEVEMENTS_MAX = 3, SKILLS_MAX = 20, SKILLS_MIN = 2, BOLD_MAX_WORDS = 8;
// Per-role bullet limits by recency: latest role up to 6, second up to 4, the rest up to 2; floors 3, 2 and 1. Always capped by what the role has.
const ROLE_RANGE = [[3, 6], [2, 4], [1, 2]] as const;

const trail = (s: string) => s.replace(/[.,;:]+$/, ""); // the place pattern may swallow a sentence-ending full stop
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasTerm = (text: string, term: string) => new RegExp(`(^|[^A-Za-z0-9])${esc(term)}($|[^A-Za-z0-9])`, "i").test(text);
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const NUM_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const usable = (b: Bullet, ctx: SelectionContext, focus: number | null) => {
  if (b.status !== "confirmed" && b.status !== "cv") return false;
  const only = ctx.focusRestrictions?.[b.id];
  return !only || (focus !== null && only.includes(focus));
};

// How many bullets a selection needs, given the focus type. Guarantees that every profile that passes the start gate has at least one valid selection:
// achievements only use bullets left over after every role has its floor.
export function selectionBudget(ctx: SelectionContext, focus: number | null) {
  const pool = ctx.bullets.filter((b) => usable(b, ctx, focus));
  const roles = ctx.roleOrder.filter((r) => pool.some((b) => b.employer === r)).map((id, i) => {
    const avail = pool.filter((b) => b.employer === id).length, [lo, hi] = ROLE_RANGE[Math.min(i, ROLE_RANGE.length - 1)];
    return { id, avail, min: Math.min(lo, avail), max: Math.min(hi, avail) };
  });
  const surplus = pool.length - roles.reduce((n, r) => n + r.min, 0);
  const achievements = Math.max(0, Math.min(ACHIEVEMENTS_MAX, surplus));
  return { roles, achievements, skills: { min: Math.min(SKILLS_MIN, ctx.skills.allowed.length), max: SKILLS_MAX } };
}


// ---- scanners shared by the CV summary and by every extra (cover note, recruiter message, interview answers). Code enforces what no model is shown.
export type ScanContext = Pick<SelectionContext, "skills" | "forbiddenPhrases" | "residenceAllowed" | "residenceTargets">;
// `strict` (the CV summary): nothing the profile forbids, nothing unverified and no known gap may appear at all. Not strict (the extras): forbidden phrases and
// removed skills still may not appear, but an honest mention of a known gap or of an unverified skill is allowed ("I have not used X yet"): interview prep MUST
// answer for gaps, and a text that CLAIMS one is caught by the Checker as unsupported.
export function forbiddenTermProblems(text: string, ctx: ScanContext, subject = "text", strict = true): string[] {
  const e: string[] = [];
  for (const r of ctx.forbiddenPhrases) if (norm(text).includes(norm(r))) e.push(`${subject} uses a phrase the profile marks as do-not-use: "${r}"`);
  for (const t of ctx.skills.removed) if (hasTerm(text, t)) e.push(`${subject} mentions "${t}", a do-not-use skill (the profile says it must not be listed)`);
  if (strict) for (const t of [...ctx.skills.unverified, ...ctx.skills.knownGaps]) if (hasTerm(text, t)) e.push(`${subject} mentions "${t}", which is unverified or a known gap`);
  return e;
}
export function residenceProblems(text: string, ctx: ScanContext, subject = "text"): string[] {
  const e: string[] = [];
  // Residence is an allow-list: a place named after "based/living/located in" must be where the candidate really is.
  for (const m of text.matchAll(/\b(?:[Bb]ased|[Ll]iving|[Ll]ives|[Ll]ive|[Rr]esident|[Rr]esiding|[Ll]ocated)\s+in\s+(?:the\s+)?([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,2})/g)) {
    const place = trail(norm(m[1]));
    if (!ctx.residenceAllowed.some((a) => place === trail(a) || place.startsWith(trail(a) + " "))) e.push(`${subject} claims residence in "${trail(m[1])}"; the profile says the candidate is in ${ctx.residenceAllowed[0] ?? "a different place"}`);
  }
  // "X-based" is only checked for places the candidate wants to work in but does not live in (it also matches "cloud-based", so it is not a general check).
  for (const m of text.matchAll(/\b([A-Z][\w'.]*)[- ]based\b/g)) if (ctx.residenceTargets.includes(norm(m[1]))) e.push(`${subject} claims residence in "${m[1]}" ("${m[0]}"); the candidate does not live there`);
  return e;
}
export const scanText = (text: string, ctx: ScanContext, subject = "text", strict = true) => [...forbiddenTermProblems(text, ctx, subject, strict), ...residenceProblems(text, ctx, subject)];

export function validateSummary(summary: string, ctx: SelectionContext, focusId: number | null): string[] {
  const e: string[] = [];
  const w = words(summary).length;
  if (w < 20 || w > 70) e.push(`summary has ${w} words (needs 20 to 70)`);
  const sentences = summary.trim().split(/(?<=[.!?])\s+/).filter(Boolean).length;
  if (sentences < 2 || sentences > 3) e.push(`summary has ${sentences} sentences (needs 2 or 3)`);
  if (/[\\{}<>^~|]/.test(summary)) e.push("summary contains a character that is not allowed: \\ { } < > ^ ~ |");
  const unknown = numberTokens(summary).filter((t) => !ctx.numbers.has(t));
  if (unknown.length) e.push(`summary uses number(s) not found in the verified bullets: ${unknown.join(", ")}`);
  for (const m of summary.matchAll(/(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*\+?\s*(?:years|yrs)\b/gi)) {
    const n = /^\d/.test(m[1]) ? parseFloat(m[1]) : NUM_WORDS[m[1].toLowerCase()];
    if (n > ctx.maxClaimedYears) e.push(`summary claims ${m[0]} of experience; the profile supports about ${ctx.maxClaimedYears} at most`);
  }
  e.push(...forbiddenTermProblems(summary, ctx, "summary"));
  if (/\b(he|she|his|her|him|hers|i|my|me)\b/i.test(summary)) e.push("summary uses a pronoun; CV summaries use an implied first person (\"Builds…\")");
  e.push(...residenceProblems(summary, ctx, "summary"));
  if (/\b(passionate|results-driven|synergy|dynamic|rockstar|ninja|guru)\b/i.test(summary)) e.push("summary uses a banned buzzword");
  const soft = summary.match(/\b(learns? (new )?(tools|things|technologies)? ?(quickly|fast)|fast learner|quick learner|quick to learn|detail[- ]oriented|team player|hard[- ]working|self[- ]starter|go-getter|proven track record|excellent communicator)\b/i);
  if (soft) e.push(`summary uses self-praise that no fact backs ("${soft[0]}"); state facts instead`);
  void focusId;
  return e;
}

export type WriterMode = "choose-and-order" | "reword";
// A selection that drops bullets to fit a page also drops the rewrites of the bullets that are gone.
export const pruneRewrites = (sel: CvSelection): CvSelection => {
  if (!sel.rewrites) return sel;
  const ids = new Set([...sel.achievements.map((a) => a.id), ...sel.roles.flatMap((r) => r.bullets)]);
  const rewrites = sel.rewrites.filter((r) => ids.has(r.id));
  return { ...sel, rewrites: rewrites.length ? rewrites : undefined };
};
export function validateCvSelection(raw: unknown, ctx: SelectionContext, opts: { mode?: WriterMode } = {}): { errors: string[]; selection?: CvSelection } {
  const mode = opts.mode ?? "choose-and-order";
  const errors: string[] = [];
  const strs = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === "string");
  const s = raw as Partial<CvSelection> | null;
  if (!s || typeof s !== "object") return { errors: ["the selection is not an object"] };
  const hasFocus = ctx.archetypes.length > 0;
  if (hasFocus ? typeof s.focus_id !== "number" : s.focus_id != null) errors.push(hasFocus ? "focus_id missing" : "focus_id must be empty: the profile has no verified focus types");
  if (typeof s.summary !== "string") errors.push("summary missing");
  if (!Array.isArray(s.achievements)) errors.push("achievements missing");
  if (!Array.isArray(s.roles) || !s.roles.every((r) => r && typeof r.role === "string" && strs(r.bullets))) errors.push("roles missing or malformed");
  if (!strs(s.skills)) errors.push("skills missing");
  if (errors.length) return { errors };
  const rawRewrites = (s as { rewrites?: unknown }).rewrites;
  if (mode === "choose-and-order" && Array.isArray(rawRewrites) && rawRewrites.length) errors.push("rewrites are not allowed in choose-and-order mode (the Writer is in the wrong mode: bullets are copied word for word)");
  const rawIds = new Set<string>([...(s.achievements as { id?: unknown }[]).map((a) => String(a?.id)), ...(s.roles as { bullets: string[] }[]).flatMap((r) => r.bullets)]); // before any trimming
  const focus = hasFocus ? (s.focus_id as number) : null;
  if (hasFocus && !ctx.archetypes.some((a) => a.id === focus)) errors.push(`focus_id ${focus} is not a focus type of the profile`);
  const budget = selectionBudget(ctx, focus);
  const sel: CvSelection = { ...(s as CvSelection), focus_id: focus, questions: strs(s.questions) ? s.questions : [], notes: typeof s.notes === "string" ? s.notes : "" };
  delete sel.rewrites;
  // Too MANY items is a layout slip, not a fact problem: keep the first ones (the Writer orders by relevance). Roles come back in recency order.
  const order = new Map(ctx.roleOrder.map((r, i) => [r, i]));
  sel.roles = [...sel.roles].sort((a, b) => (order.get(a.role) ?? 99) - (order.get(b.role) ?? 99)).map((r) => ({ role: r.role, bullets: r.bullets.slice(0, budget.roles.find((x) => x.id === r.role)?.max ?? r.bullets.length) }));
  sel.achievements = sel.achievements.slice(0, ACHIEVEMENTS_MAX);
  sel.skills = sel.skills.slice(0, SKILLS_MAX);

  const byId = new Map<string, Bullet>(ctx.bullets.map((b) => [b.id, b]));
  // Light rewording: each rewrite must be for a bullet that is really on the CV, and must pass the mechanical checks against its original (cleaned the same
  // way the renderer cleans it, so what is checked is exactly what is printed). A rewrite of a bullet code trimmed for length is dropped silently.
  const rewriteOf = new Map<string, string>();
  if (mode === "reword") {
    const selectedIds = new Set([...sel.achievements.map((a) => String(a?.id)), ...sel.roles.flatMap((r) => r.bullets)]);
    if (!Array.isArray(rawRewrites) || !rawRewrites.every((r) => r && typeof r.id === "string" && typeof r.text === "string")) errors.push("rewrites missing or malformed (return an empty list when nothing is reworded)");
    else for (const r of rawRewrites as { id: string; text: string }[]) {
      if (rewriteOf.has(r.id)) { errors.push(`rewrites: ${r.id} appears twice`); continue; }
      const orig = byId.get(r.id);
      if (!selectedIds.has(r.id)) { if (!rawIds.has(r.id)) errors.push(`rewrites: ${r.id} is not a bullet of this CV`); continue; }
      if (!orig) continue; // an unknown id is reported by the bullet checks below
      const text = cleanText(r.text);
      if (text === orig.text) continue; // not actually reworded
      errors.push(...validateRewrite(orig.text, text, ctx, `reworded bullet ${r.id}`));
      rewriteOf.set(r.id, text);
    }
    sel.rewrites = rewriteOf.size ? [...rewriteOf].map(([id, text]) => ({ id, text })) : undefined;
  }
  const used = new Set<string>();
  const check = (label: string, list: string[], role: string | null, range: readonly [number, number]) => {
    if (list.length < range[0] || list.length > range[1]) errors.push(`${label}: ${list.length} bullets, needs ${range[0] === range[1] ? range[0] : `${range[0]} to ${range[1]}`}`);
    for (const id of list) {
      const b = byId.get(id);
      if (!b) { errors.push(`${label}: "${id}" is not a bullet of the profile`); continue; }
      if (b.status !== "confirmed" && b.status !== "cv") errors.push(`${label}: ${id} has status "${b.status}"; only verified bullets may be used`);
      if (role && b.employer !== role) errors.push(`${label}: ${id} belongs to ${b.employer}`);
      const only = ctx.focusRestrictions[id];
      if (only && (focus === null || !only.includes(focus))) errors.push(`${label}: ${id} may only be used under focus type ${only.join(" or ")}`);
      if (used.has(id)) errors.push(`${label}: ${id} is used more than once`);
      used.add(id);
    }
  };
  check("achievements", sel.achievements.map((a) => String(a?.id)), null, [budget.achievements, budget.achievements]);
  for (const a of sel.achievements) {
    const b = byId.get(String(a?.id));
    if (!b) continue;
    const bold = String(a.bold ?? "");
    if (!bold.trim()) errors.push(`achievements: ${a.id} has no bold lead-in`);
    else if (!norm(rewriteOf.get(String(a.id)) ?? b.text).includes(norm(bold))) errors.push(`achievements: "${bold}" is not a word-for-word piece of ${a.id}${rewriteOf.has(String(a.id)) ? " as it is printed (reworded)" : ""}`);
    else if (words(bold).length > BOLD_MAX_WORDS) a.bold = words(bold).slice(0, BOLD_MAX_WORDS).join(" ").replace(/[,;:]$/, ""); // layout only: trimmed by code
  }
  const seenRoles = new Set<string>();
  for (const r of sel.roles) {
    const b = budget.roles.find((x) => x.id === r.role);
    if (!b) { errors.push(`roles: "${r.role}" is not a role with usable bullets`); continue; }
    if (seenRoles.has(r.role)) errors.push(`roles: ${r.role} is listed twice`);
    seenRoles.add(r.role);
    check(`role ${r.role}`, r.bullets, r.role, [b.min, b.max]);
  }
  for (const b of budget.roles) if (!seenRoles.has(b.id)) errors.push(`roles: ${b.id} is missing (every role with usable bullets must be listed)`);

  const allowed = new Map(ctx.skills.allowed.map((x) => [norm(x), x]));
  const banned = new Set([...ctx.skills.removed, ...ctx.skills.unverified, ...ctx.skills.knownGaps].map(norm));
  if (sel.skills.length < budget.skills.min) errors.push(`skills: ${sel.skills.length} items, needs at least ${budget.skills.min}`);
  const seen = new Set<string>();
  for (const item of sel.skills) {
    const k = norm(item);
    if (banned.has(k)) errors.push(`skills: "${item}" is do-not-use, unverified or a known gap`);
    else if (!allowed.has(k)) errors.push(`skills: "${item}" is not one of the verified skills`);
    if (seen.has(k)) errors.push(`skills: "${item}" is listed twice`);
    seen.add(k);
  }
  errors.push(...validateSummary(sel.summary, ctx, focus));
  return { errors, selection: errors.length ? undefined : sel };
}
