// Review cards for schema v2 (design/PROFILE-SCHEMA-v2.md section 6): COMPUTED from the profile, never stored (only the user's dismissals are). Conservative on purpose: every card has a stable
// key, so a dismissal stays dismissed until the facts behind it change. Plain code, no AI.
import type { Profile2, Role2 } from "./profile-v2.ts";

export type CardKind = "contradiction" | "overlap" | "duplicate" | "needs-review" | "gap" | "locked-check";
export type ReviewCard = { key: string; kind: CardKind; factIds: string[]; message: string; options: ("accept" | "dismiss" | "merge" | "edit")[] };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (d: { y: number; m: number } | "present" | null) => (d === "present" ? "now" : d ? `${MONTHS[d.m - 1]} ${d.y}` : "no date");
const monthIndex = (d: { y: number; m: number }) => d.y * 12 + d.m - 1;
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 2));
const jaccard = (a: Set<string>, b: Set<string>) => { let i = 0; for (const x of a) if (b.has(x)) i++; return a.size + b.size - i === 0 ? 0 : i / (a.size + b.size - i); };
const roleName = (r: Role2) => `${r.title} at ${r.company}`;
const span = (r: Role2, nowIdx: number): [number, number] | null => (r.start ? [monthIndex(r.start), r.end === "present" ? nowIdx : r.end ? monthIndex(r.end) : nowIdx] : null);

export function reviewCards(p: Profile2, now: Date = new Date()): ReviewCard[] {
  const out: ReviewCard[] = [], nowIdx = now.getUTCFullYear() * 12 + now.getUTCMonth(), roles = p.facts.roles;
  const add = (c: ReviewCard) => { if (!p.review.dismissed.includes(c.key) && !out.some((x) => x.key === c.key)) out.push(c); };
  // 1. what each source said about a role disagrees
  for (const r of roles) {
    const cl = r.claims ?? []; if (cl.length < 2) continue;
    const starts = new Set(cl.map((c) => (c.start ? monthIndex(c.start) : -1)).filter((x) => x >= 0)), ends = new Set(cl.map((c) => (c.end === "present" ? "p" : c.end ? String(monthIndex(c.end)) : "")).filter(Boolean)), titles = new Set(cl.map((c) => norm(c.title)));
    const what = [starts.size > 1 && "the start date", ends.size > 1 && "the end date", titles.size > 1 && "the job title"].filter(Boolean) as string[];
    if (what.length) add({ key: `contradiction:${r.id}:${what.join("+")}`, kind: "contradiction", factIds: [r.id], message: `Your CVs disagree about ${what.join(" and ")} of ${roleName(r)}: ${cl.map((c) => `${c.title}, ${label(c.start)} to ${label(c.end)}`).join(" / ")}.`, options: ["edit", "dismiss"] });
  }
  // 2. two roles that overlap by more than three months
  for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) {
    const a = span(roles[i], nowIdx), b = span(roles[j], nowIdx); if (!a || !b) continue;
    const overlap = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
    if (overlap > 3) add({ key: `overlap:${[roles[i].id, roles[j].id].sort().join(":")}`, kind: "overlap", factIds: [roles[i].id, roles[j].id], message: `${roleName(roles[i])} and ${roleName(roles[j])} overlap by ${overlap} months. Were you really doing both jobs at the same time? If yes, keep it as it is. If not, fix a date.`, options: ["edit", "dismiss"] });
  }
  // 3. near-duplicate bullets (kept from two CVs)
  const bullets = roles.flatMap((r) => r.bullets.map((b) => ({ b, w: words(b.text) })));
  for (let i = 0; i < bullets.length; i++) for (let j = i + 1; j < bullets.length; j++) {
    if (norm(bullets[i].b.text) === norm(bullets[j].b.text) || bullets[i].w.size < 5 || bullets[j].w.size < 5) continue;
    if (jaccard(bullets[i].w, bullets[j].w) >= 0.8) add({ key: `duplicate:${[bullets[i].b.id, bullets[j].b.id].sort().join(":")}`, kind: "duplicate", factIds: [bullets[i].b.id, bullets[j].b.id], message: `Two achievements say almost the same thing: "${bullets[i].b.text}" and "${bullets[j].b.text}".`, options: ["merge", "dismiss"] });
  }
  // 4. items waiting for a look, one card per place so a big import is not a wall of cards
  for (const r of roles) {
    const waiting = r.bullets.filter((b) => b.meta.trust === "review"); if (!waiting.length) continue;
    add({ key: `needs-review:${r.id}`, kind: "needs-review", factIds: waiting.map((b) => b.id), message: `${waiting.length} achievement${waiting.length === 1 ? "" : "s"} in ${roleName(r)} ${waiting.length === 1 ? "is" : "are"} not used in CVs yet because ${waiting.length === 1 ? "it wasn't" : "they weren't"} found word for word in your CV.`, options: ["accept", "edit", "dismiss"] });
  }
  const un = p.review.unchecked ?? [];
  if (un.length) add({ key: "locked-check", kind: "locked-check", factIds: [...un], message: `The import filled in your ${un.map((k) => (k === "linkedin" ? "LinkedIn link" : k)).join(", ")} from your CV. Check ${un.length === 1 ? "it" : "them"}: they go on every CV.`, options: ["accept", "edit"] });
  for (const [name, list] of [["skills", p.facts.skills.filter((s) => s.meta.trust === "review").map((s) => s.name)], ["education lines", p.facts.education.filter((e) => e.meta.trust === "review").map((e) => e.id)], ["roles", roles.filter((r) => r.meta.trust === "review").map((r) => r.id)], ["stories", roles.filter((r) => r.story?.meta.trust === "review").map((r) => r.id)]] as const) {
    if (list.length) add({ key: `needs-review:${name}`, kind: "needs-review", factIds: [...list], message: `${list.length} ${name === "roles" ? (list.length === 1 ? "role" : "roles") : name === "stories" ? (list.length === 1 ? "story" : "stories") : name} waiting for a look (not used in CVs yet).`, options: ["accept", "edit", "dismiss"] });
  }
  // 5. gaps: a role with no start date, and the current role with fewer than three usable achievements
  for (const r of roles) if (!r.start) add({ key: `gap:undated:${r.id}`, kind: "gap", factIds: [r.id], message: `${roleName(r)} has no start date.`, options: ["edit", "dismiss"] });
  const current = roles.filter((r) => r.end === "present" || (r.start && !r.end));
  for (const r of current) { const n = r.bullets.filter((b) => b.meta.trust === "trusted").length; if (n < 3) add({ key: `gap:thin:${r.id}`, kind: "gap", factIds: [r.id], message: `${roleName(r)} has ${n === 0 ? "no usable achievements" : n === 1 ? "one usable achievement" : `${n} usable achievements`}. Three or more give your CVs more to choose from.`, options: ["edit", "dismiss"] }); }
  return out;
}

// Dismissing a card stores its key; the card comes back only if its facts change (the key then changes too).
export function dismissCard(p: Profile2, key: string): Profile2 { const q = JSON.parse(JSON.stringify(p)) as Profile2; if (!q.review.dismissed.includes(key)) q.review.dismissed.push(key); return q; }

// ---------- what a card's buttons do (the page sends only the card's key and an action; the card is looked up here, never trusted from the page) ----------
export type CardAction = "accept" | "dismiss" | "merge";
const trustMeta = (m: { trust: string; acceptedAt?: string; acceptedBy?: "user" }, now: string) => { if (m.trust !== "trusted") { m.trust = "trusted"; m.acceptedAt = now; m.acceptedBy = "user"; } };
export function applyCardAction(p: Profile2, key: string, action: CardAction, now: Date = new Date(), at: string = now.toISOString()): { ok: true; profile: Profile2 } | { ok: false; reason: "no_card" | "not_allowed" } {
  const card = reviewCards(p, now).find((c) => c.key === key); if (!card) return { ok: false, reason: "no_card" };
  if (action === "dismiss") return { ok: true, profile: dismissCard(p, key) };
  const q = JSON.parse(JSON.stringify(p)) as Profile2;
  if (action === "merge") {
    if (card.kind !== "duplicate" || card.factIds.length !== 2) return { ok: false, reason: "not_allowed" };
    const found = card.factIds.map((id) => { for (const r of q.facts.roles) { const i = r.bullets.findIndex((b) => b.id === id); if (i >= 0) return { r, i, b: r.bullets[i] }; } return null; });
    if (!found[0] || !found[1]) return { ok: false, reason: "no_card" };
    // keep the trusted one; if both (or neither) are trusted keep the older one; the other is deleted
    const rank = (x: NonNullable<(typeof found)[number]>) => (x.b.meta.trust === "trusted" ? 0 : 1);
    const [keep, drop] = rank(found[0]) !== rank(found[1]) ? (rank(found[0]) < rank(found[1]) ? [found[0], found[1]] : [found[1], found[0]]) : found[0]!.b.meta.addedAt <= found[1]!.b.meta.addedAt ? [found[0], found[1]] : [found[1], found[0]];
    void keep; drop!.r.bullets.splice(drop!.i, 1);
    q.log = [...q.log, { at, actor: "user" as const, summary: "merged two near-identical achievements (kept one)" }].slice(-500);
    return { ok: true, profile: q };
  }
  if (card.kind === "locked-check") { delete q.review.unchecked; q.log = [...q.log, { at, actor: "user" as const, summary: "confirmed the details filled in from a CV" }].slice(-500); return { ok: true, profile: q }; }
  if (card.kind !== "needs-review") return { ok: false, reason: "not_allowed" };
  let n = 0;
  for (const id of card.factIds) {
    for (const r of q.facts.roles) {
      if (r.id === id) { if (key === "needs-review:stories") { if (r.story) { trustMeta(r.story.meta, at); n++; } } else if (key === `needs-review:roles`) { trustMeta(r.meta, at); n++; } }
      for (const b of r.bullets) if (b.id === id) { trustMeta(b.meta, at); n++; }
    }
    for (const s of q.facts.skills) if (s.name === id && key === "needs-review:skills") { trustMeta(s.meta, at); n++; }
    for (const e of q.facts.education) if (e.id === id) { trustMeta(e.meta, at); n++; }
  }
  if (!n) return { ok: false, reason: "no_card" };
  q.log = [...q.log, { at, actor: "user" as const, summary: `accepted ${n} item(s) waiting for a look` }].slice(-500);
  return { ok: true, profile: q };
}
