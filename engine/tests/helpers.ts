// Shared test helpers. Builds a valid CvSelection by policy from a persona context: the proof that one exists, and a ready-made input for renderers.
import { selectionBudget } from "../src/cv/selection.ts";
import type { CvSelection, SelectionContext } from "../src/cv/selection.ts";
export function buildSelection(ctx: SelectionContext & { skills: SelectionContext["skills"] }, focus: number | null, summary: string): CvSelection {
  const b = selectionBudget(ctx, focus);
  const take = new Map(ctx.bullets.map((x) => [x.id, x]));
  const pool = (r: string) => ctx.bullets.filter((x) => x.employer === r && (!ctx.focusRestrictions[x.id] || (focus !== null && ctx.focusRestrictions[x.id].includes(focus)))).map((x) => x.id);
  const roles = b.roles.map((r) => ({ role: r.id, bullets: pool(r.id).slice(0, r.min) }));
  const rest = b.roles.flatMap((r) => pool(r.id).slice(r.min));
  const achievements = rest.slice(0, b.achievements).map((id) => ({ id, bold: take.get(id)!.text.split(/\s+/).slice(0, 3).join(" ") }));
  return { focus_id: focus, summary, achievements, roles, skills: ctx.skills.allowed.slice(0, Math.max(b.skills.min, 2)), questions: [], notes: "" };
}
export const SUMMARY = "Builds and runs practical programmes that teams adopt, using verified results from recent roles. Brings clear reporting and steady delivery to busy teams.";

// The fullest valid selection the budget allows (every role at its maximum, the achievements taken from the latest role's extras).
export function buildMaxSelection(ctx: SelectionContext, focus: number | null, summary: string): CvSelection {
  const b = selectionBudget(ctx, focus);
  const ids = (r: string) => ctx.bullets.filter((x) => x.employer === r && (!ctx.focusRestrictions[x.id] || (focus !== null && ctx.focusRestrictions[x.id].includes(focus)))).map((x) => x.id);
  const first = b.roles[0]?.id;
  const achievements = ids(first).slice(b.roles[0].max, b.roles[0].max + b.achievements).concat(ids(first).slice(0, 0));
  const fromOthers = b.achievements - achievements.length;
  const extra = fromOthers > 0 ? b.roles.slice(1).flatMap((r) => ids(r.id).slice(r.max)).slice(0, fromOthers) : [];
  return { focus_id: focus, summary, achievements: [...achievements, ...extra].map((id) => ({ id, bold: ctx.bullets.find((x) => x.id === id)!.text.split(/\s+/).slice(0, 3).join(" ") })),
    roles: b.roles.map((r) => ({ role: r.id, bullets: ids(r.id).slice(0, r.max) })), skills: ctx.skills.allowed.slice(0, 12), questions: [], notes: "" };
}

// A full three-role profile (21 verified bullets), for page-fit tests. `filler` lengthens every bullet (about 13 words per repeat).
type P = import("../src/profile.ts").Profile;
export function fullProfile(base: P, filler = ""): P {
  const mk = (id: string, title: string, company: string, end: P["roles"][0]["end"], n: number, start: { y: number; m: number }) => ({ id, title, company, location: "Leeds, UK", start, end, status: "verified" as const, bullets: Array.from({ length: n }, (_, i) => ({ id: `${id}${i}`, tags: ["x"], status: "verified" as const, text: `Delivered result number ${i + 1} for the ${company} team by redesigning a manual process, cutting turnaround by ${10 + i * 3}%.${filler}` })) });
  return { ...JSON.parse(JSON.stringify(base)), roles: [mk("a", "Senior Coordinator", "Alpha Ltd", "present", 9, { y: 2022, m: 1 }), mk("b", "Coordinator", "Beta Ltd", { y: 2021, m: 12 }, 7, { y: 2019, m: 1 }), mk("c", "Assistant", "Gamma Ltd", { y: 2018, m: 12 }, 5, { y: 2016, m: 1 })],
    skills: Array.from({ length: 12 }, (_, i) => ({ name: `Skill number ${i + 1}`, status: "verified" as const, group: i < 6 ? "Tools" : "Methods" })), education: [{ id: "e1", text: "BA Business Management, University of Leeds, 2013 - 2016", status: "verified" as const }, { id: "e2", text: "Project management certificate, 2020", status: "verified" as const }] };
}
export const FILLER = " Also kept stakeholders informed with clear weekly updates and documented handovers across teams.";
