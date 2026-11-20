// The <limits> block for the Writer (phase 1 step 6 review; pulled forward from step 7 because the skill text and the code must agree).
// Generated from the same budget the validator uses, so the Writer is told exactly what will be accepted, including WHICH bullet ids are usable
// for each role under the chosen focus type (a bullet restricted to another focus type is simply not listed).
import type { Profile } from "../profile.ts";
import { profileToPersona } from "../profile.ts";
import { selectionBudget } from "./selection.ts";

export function renderLimits(profile: Profile, focus: number | null, now = new Date()): string {
  const ctx = profileToPersona(profile, now), b = selectionBudget(ctx, focus);
  const info = new Map(profile.roles.map((r) => [r.id, r]));
  const usable = (role: string) => ctx.bullets.filter((x) => x.employer === role && (!ctx.focusRestrictions[x.id] || (focus !== null && ctx.focusRestrictions[x.id].includes(focus)))).map((x) => x.id);
  const range = (min: number, max: number) => min === max ? `exactly ${min}` : `${min} to ${max}`;
  const lines = [
    `achievements: exactly ${b.achievements}${b.achievements === 0 ? " (return an empty list)" : ""}`,
    "roles (list every one, most recent first; a bullet id may be used only once in the whole CV, achievements included):",
    ...b.roles.map((r) => `- ${r.id} (${info.get(r.id)?.title}, ${info.get(r.id)?.company}): ${range(r.min, r.max)} bullets; usable ids: ${usable(r.id).join(", ")}`),
    `skills: ${range(b.skills.min, Math.min(b.skills.max, ctx.skills.allowed.length))} items, chosen from the profile's skills only`,
    "summary: 2 to 3 sentences, 20 to 70 words",
  ];
  return `<limits>\n${lines.join("\n")}\n</limits>`;
}
