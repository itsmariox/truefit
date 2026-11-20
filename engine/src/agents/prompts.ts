// Pure prompt builders (phase 1 step 7a): everything a model is told, built from explicit parameters, no files, no environment, no globals,
// so every prompt can be inspected and tested offline. Each prompt contains only the blocks the skills README promises for that role.
// The profile text is `profileToPersona().text` verbatim (verified items only; no name, contact details, drafts or Do-not-use items).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { maskContacts } from "../persona.ts";
import { sanitise } from "../checks.ts";
import { renderLimits } from "../cv/limits.ts";
import type { Profile, ProfilePersona } from "../profile.ts";
import type { SchemaName } from "./schemas.ts";

export const TONES = ["friendly", "neutral", "concise"] as const;
export type Tone = (typeof TONES)[number];
export const COACH_MODES = ["verdict", "delivered", "question", "failed", "cover-note", "interview-prep", "recruiter-message", "company-brief"] as const;
export type CoachMode = (typeof COACH_MODES)[number];
const STATUS_MODES: CoachMode[] = ["verdict", "delivered", "question", "failed"];

export type PromptSpec = { system: string; prompt: string; schema: SchemaName; web: boolean; research: boolean };

const block = (tag: string, body: string) => `<${tag}>\n${body}\n</${tag}>`;
// The candidate's name is hidden from the Checker too (it appears in the CV text, and it needs no name to check a claim).
const hide = (text: string, names: string[] = []) => names.filter((n) => n.trim().length > 1).reduce((t, n) => t.replace(new RegExp(n.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "gi"), "[name]"), text);
const clean = (s: string, max = 60_000) => sanitise(s, max).text; // outside text can never close one of our blocks early
export async function loadSkill(skillsDir: string, name: string): Promise<string> {
  return (await readFile(path.join(skillsDir, name, "SKILL.md"), "utf8")).replace(/^---[\s\S]*?---\n/, "");
}

// CV import (phase 5b): the text of the person's own CV with every contact detail already removed by code; nothing else is sent.
export async function importerPrompt(i: { skillsDir: string; cvText: string }): Promise<PromptSpec> {
  return { system: await loadSkill(i.skillsDir, "cv-import"), schema: "importer", web: false, research: false, prompt: block("cv", clean(i.cvText)) };
}

export async function analystPrompt(i: { skillsDir: string; ctx: ProfilePersona; adText: string }): Promise<PromptSpec> {
  return { system: await loadSkill(i.skillsDir, "fit-analysis"), schema: "analyst", web: false, research: false,
    prompt: `${block("job_ad", clean(i.adText))}\n\n${i.ctx.text}\n\nAnalyse this ad for the candidate, following your instructions.` };
}

// The Writer's limits are computed for the focus type it will be judged against. The pipeline passes the focus it validates with.
export async function writerPrompt(i: { skillsDir: string; ctx: ProfilePersona; profile: Profile; adText: string; analysisJson: string; focus: number | null; problemsJson?: string | null; now?: Date; mode?: "choose-and-order" | "reword" }): Promise<PromptSpec> {
  const parts = [block("job_ad", clean(i.adText)), block("analysis", clean(i.analysisJson)), i.ctx.text, renderLimits(i.profile, i.focus, i.now),
    ...(i.problemsJson ? [block("checker_problems", clean(i.problemsJson))] : []),
    i.problemsJson ? "Your previous selection was rejected for the reasons in <checker_problems>. Return a corrected selection that fixes exactly those." : "Choose the CV content for this job, following your instructions."];
  const reword = i.mode === "reword"; // each mode has its OWN complete skill, so one prompt never holds two contradicting rules about rewording
  return { system: await loadSkill(i.skillsDir, reword ? "cv-writing-reword" : "cv-writing"), schema: reword ? "writerReword" : "writer", web: false, research: false, prompt: parts.join("\n\n") };
}

// The Checker NEVER receives the ad. Contact details are masked in everything it reads.
// `rewrites`: in light-rewording mode, every reworded bullet with its original, side by side (the Checker's Job 3).
export type RewritePair = { id: string; original: string; reworded: string };
export async function checkerPrompt(i: { skillsDir: string; ctx: ProfilePersona; summary: string; cvText: string; hideNames?: string[]; rewrites?: RewritePair[] }): Promise<PromptSpec> {
  const pairs = i.rewrites ?? [];
  const rw = pairs.length ? `${block("rewrites", clean(pairs.map((p) => `[${p.id}]\nORIGINAL: ${hide(maskContacts(p.original), i.hideNames)}\nREWORDED: ${hide(maskContacts(p.reworded), i.hideNames)}`).join("\n\n")))}\n\n` : "";
  return { system: await loadSkill(i.skillsDir, "fact-check"), schema: pairs.length ? "checkerReword" : "checker", web: false, research: false,
    prompt: `${block("summary_to_check", clean(i.summary))}\n\n${block("cv_text", clean(hide(maskContacts(i.cvText), i.hideNames)))}\n\n${rw}${i.ctx.text}\n\nCheck the summary claim by claim and the whole CV for rule breaks${pairs.length ? ", and judge every reworded bullet against its original (Job 3)" : ""}, following your instructions.` };
}
export async function checkerTextPrompt(i: { skillsDir: string; ctx: ProfilePersona; text: string; hideNames?: string[] }): Promise<PromptSpec> {
  return { system: await loadSkill(i.skillsDir, "fact-check"), schema: "checker", web: false, research: false,
    prompt: `${block("text_to_check", clean(hide(maskContacts(i.text), i.hideNames)))}\n\n${i.ctx.text}\n\nCheck every claim this text makes about the candidate, following your instructions (text mode).` };
}

export async function coachPrompt(i: { skillsDir: string; mode: CoachMode; ctx: ProfilePersona; tone: Tone; teamJson: string; adText?: string; problemsJson?: string | null }): Promise<PromptSpec> {
  if (!COACH_MODES.includes(i.mode)) throw new Error(`unknown coach mode "${i.mode}"`);
  const humanizer = `<skill name="humanizer">\n${await loadSkill(i.skillsDir, "humanizer")}\n</skill>`;
  if (i.mode === "company-brief") {
    // The researcher gets the ad and NOTHING about the candidate (no profile, no analysis): its web searches must not carry personal data.
    return { system: `${await loadSkill(i.skillsDir, "company-brief")}\n\n${humanizer}`, schema: "coach", web: true, research: true,
      prompt: `${block("job_ad", clean(i.adText ?? ""))}\n\nWrite the "company-brief" output, following your instructions. Return it in "message".` };
  }
  if (STATUS_MODES.includes(i.mode)) {
    // Messages about the job: the tone applies. The profile text carries the user's own Rules, which the verdict quotes.
    return { system: `${await loadSkill(i.skillsDir, "coach-reply")}\n\n${humanizer}`, schema: "coach", web: false, research: false,
      prompt: [block("tone", i.tone), `mode: ${i.mode}`, block("team_results", clean(i.teamJson)), i.ctx.text, `Write the "${i.mode}" message, following your instructions. Return it in "message".`].join("\n\n") };
  }
  // Documents the user will send or study (cover note, recruiter message, interview prep): their own skill, no tone, fact-checked afterwards.
  const parts = [block("team_results", clean(i.teamJson)), block("job_ad", clean(i.adText ?? "")), i.ctx.text,
    ...(i.mode === "interview-prep" ? [block("stories", clean(maskContacts(i.ctx.stories)))] : []),
    ...(i.problemsJson ? [block("checker_problems", clean(i.problemsJson))] : []),
    `Write the "${i.mode}" output, following your instructions. Return it in "message".`];
  return { system: `${await loadSkill(i.skillsDir, i.mode)}\n\n${humanizer}`, schema: "coach", web: false, research: false, prompt: parts.join("\n\n") };
}
