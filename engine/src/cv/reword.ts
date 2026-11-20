// The mechanical layer of the light-rewording Writer mode (phase 1 step 7c). The Writer may reword a bullet to match the job's wording; code checks the
// rewording BEFORE any Checker call, and rejects anything that could change what the bullet CLAIMS: a different number (symbol and unit included), a
// new or missing named term, a swapped role or company, a scope or leadership word that was not there, a length blow-up, a do-not-use item, a
// residence claim, a pronoun, a buzzword. This layer cannot judge meaning ("across all clients" can look harmless); the Checker sees every original and
// reworded pair side by side for that. Pure functions.
import { forbiddenTermProblems, residenceProblems } from "./selection.ts";
import type { ScanContext } from "./selection.ts";

const NUM_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "twenty", "thirty", "forty", "fifty", "hundred", "thousand", "million", "half", "dozen", "double", "triple", "twice"];
const UNIT = "(?:hours?|hrs?|h|minutes?|mins?|days?|weeks?|wks?|months?|years?|yrs?|users?|clients?|customers?|people|staff|stores?|events?)";
const NUMBER = new RegExp(`([£$€¥]?)(\\d[\\d,]*(?:\\.\\d+)?)\\s?(%|\\+|x|×|k|m|bn)?(?:[\\s-]?(${UNIT})\\b)?`, "gi"); // "3-hour" and "3 hours" are the same unit
const unitKey = (u: string) => u.toLowerCase().replace(/^(hours?|hrs?|h)$/, "hour").replace(/^(minutes?|mins?)$/, "minute").replace(/^(weeks?|wks?)$/, "week").replace(/^(years?|yrs?)$/, "year").replace(/s$/, "");
// Every number with its symbol and unit, as one token: "£15,000", "22%", "50+", "4x", "3 days" are all different from their bare digits. Spelled-out numbers count too.
export function numericTokens(text: string): string[] {
  const t: string[] = [];
  for (const m of text.matchAll(NUMBER)) t.push(`${m[1]}${m[2].replace(/,/g, "")}${(m[3] ?? "").toLowerCase().replace("×", "x")}${m[4] ? " " + unitKey(m[4]) : ""}`);
  for (const w of text.toLowerCase().matchAll(/\b[a-z]+\b/g)) if (NUM_WORDS.includes(w[0])) t.push(`w:${w[0]}`);
  return t.sort();
}
// Named terms: words that name a tool, product, company, acronym or title: capitalised mid-sentence, acronyms, camel-case and words with digits or symbols
// (n8n, HubSpot, Node.js, SQL), plus any verified skill written out in the text.
export function namedTerms(text: string, skills: string[]): string[] {
  const out = new Set<string>();
  const sentences = text.split(/(?<=[.!?])\s+|\n/);
  for (const s of sentences) {
    const words = [...s.matchAll(/[A-Za-z][A-Za-z0-9+#.&/'-]*[A-Za-z0-9+#]|[A-Za-z]/g)].map((m) => m[0]);
    words.forEach((w, i) => {
      const acronym = /^[A-Z]{2,}[a-z]?$/.test(w) || /[a-z][A-Z]/.test(w) || /\d/.test(w) || /[+#]/.test(w) || /^[A-Za-z]+\.[A-Za-z]+/.test(w);
      if (acronym || (i > 0 && /^[A-Z]/.test(w))) out.add(w.toLowerCase());
    });
  }
  const low = text.toLowerCase();
  for (const sk of skills) { const k = sk.toLowerCase(); if (k.length > 1 && new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(low)) out.add(k); }
  return [...out].sort();
}
// Scope and leadership tripwires: words that make a claim bigger. ("built" is NOT one: it is everywhere.)
export const SCOPE_WORDS = ["led", "lead", "leading", "leader", "managed", "managing", "manager", "owned", "owner", "ownership", "oversaw", "overseeing", "headed", "spearheaded", "sole", "solely", "end-to-end", "all", "every", "entire", "company-wide", "organisation-wide", "organization-wide", "across the company", "across the business", "across the organisation"];
const scopeCount = (text: string, w: string) => (text.toLowerCase().match(new RegExp(`(^|[^a-z-])${w.replace(/-/g, "[- ]")}($|[^a-z-])`, "g")) ?? []).length;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const BUZZ = /\b(passionate|results-driven|synergy|dynamic|rockstar|ninja|guru)\b/i;
const SOFT = /\b(learns? (new )?(tools|things|technologies)? ?(quickly|fast)|fast learner|quick learner|quick to learn|detail[- ]oriented|team player|hard[- ]working|self[- ]starter|go-getter|proven track record|excellent communicator)\b/i;
const PRONOUN = /\b(he|she|his|her|him|hers|i|my|me)\b/i;
const hasTerm = (text: string, term: string) => new RegExp(`(^|[^A-Za-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Za-z0-9])`, "i").test(text);
const diff = (a: string[], b: string[]) => { const c = [...b]; const out: string[] = []; for (const x of a) { const i = c.indexOf(x); if (i >= 0) c.splice(i, 1); else out.push(x); } return out; };

export type RewordContext = ScanContext & { skills: { allowed: string[] }; roleTerms: string[] };
// Returns the reasons a rewording is not allowed (empty = it passes the mechanical layer; the Checker still reads it).
export function validateRewrite(original: string, reworded: string, ctx: RewordContext, label = "reworded bullet"): string[] {
  const e: string[] = [];
  if (!reworded.trim()) return [`${label} is empty`];
  const nO = numericTokens(original), nN = numericTokens(reworded);
  const addedN = diff(nN, nO), lostN = diff(nO, nN);
  if (addedN.length) e.push(`${label} adds or changes a number: ${addedN.join(", ")} (the original has ${nO.join(", ") || "none"})`);
  if (lostN.length) e.push(`${label} drops or changes a number: ${lostN.join(", ")}`);
  const tO = namedTerms(original, ctx.skills.allowed), tN = namedTerms(reworded, ctx.skills.allowed);
  const addedT = diff(tN, tO), lostT = diff(tO, tN);
  if (addedT.length) e.push(`${label} adds a named term the original does not have: ${addedT.join(", ")} (a tool, product, company or title can only be named where the original names it)`);
  if (lostT.length) e.push(`${label} drops a named term the original has: ${lostT.join(", ")}`);
  for (const r of ctx.roleTerms) { const a = hasTerm(original, r), b = hasTerm(reworded, r); if (a !== b) e.push(`${label} ${b ? "adds" : "drops"} the role or employer "${r}"`); }
  const addedScope = SCOPE_WORDS.filter((w) => scopeCount(reworded, w) > scopeCount(original, w));
  if (addedScope.length) e.push(`${label} makes the claim bigger with a scope or leadership word the original does not have: ${addedScope.join(", ")}`);
  const wo = words(original).length, wn = words(reworded).length;
  if (wn > Math.ceil(wo * 1.25) + 3) e.push(`${label} is ${wn} words, much longer than the original's ${wo} (at most ${Math.ceil(wo * 1.25) + 3})`);
  if (wn < Math.ceil(wo * 0.5)) e.push(`${label} is ${wn} words, much shorter than the original's ${wo}: it may have dropped content`);
  for (const p of forbiddenTermProblems(reworded, ctx, label, true)) if (!forbiddenTermProblems(original, ctx, label, true).includes(p)) e.push(p);
  e.push(...residenceProblems(reworded, ctx, label).filter((p) => !residenceProblems(original, ctx, label).includes(p)));
  if (/[\\{}<>^~|]/.test(reworded) && !/[\\{}<>^~|]/.test(original)) e.push(`${label} contains a character that is not allowed: \\ { } < > ^ ~ |`);
  if (PRONOUN.test(reworded) && !PRONOUN.test(original)) e.push(`${label} uses a pronoun; bullets use an implied first person`);
  if (BUZZ.test(reworded) && !BUZZ.test(original)) e.push(`${label} uses a banned buzzword`);
  if (SOFT.test(reworded) && !SOFT.test(original)) e.push(`${label} uses self-praise that no fact backs`);
  return e;
}
