// The engine's settings with their defaults (config.json), validated. Nothing personal lives here: the user's own rules (salary floor, location, right to
// work) are in their profile, and years of experience are computed from their roles. Settings the user can change in the app override these defaults.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ACCENTS } from "./cv/html.ts";
import type { Accent } from "./cv/html.ts";
import { TONES } from "./agents/prompts.ts";
import type { Tone } from "./agents/prompts.ts";
import type { AgentConfig } from "./agents/runner.ts";
import type { PipelineConfig } from "./pipeline.ts";
import { ENGINE_DIR } from "./pipeline.ts";

export type EngineConfig = AgentConfig & PipelineConfig & {
  writerMode: "choose-and-order" | "reword"; // reword is built (step 7c) but ships only if the step 8 evals pass (PRD 13); it is not a user setting (PRD 14)
  tone: Tone; radarDay: string; radarTime: string;
};
export function parseConfig(raw: any): EngineConfig {
  const bad = (m: string): never => { throw new Error(`config: ${m}`); };
  const num = (k: string) => (typeof raw?.[k] === "number" && raw[k] > 0 ? (raw[k] as number) : bad(`${k} must be a positive number`));
  const models = raw?.models ?? {};
  for (const r of ["analyst", "writer", "checker", "coach"]) if (typeof models[r] !== "string" || !models[r]) bad(`models.${r} is missing`);
  if (!["choose-and-order", "reword"].includes(raw.writerMode)) bad("writerMode must be choose-and-order or reword");
  if (!(TONES as readonly string[]).includes(raw.tone)) bad(`tone must be one of ${TONES.join(", ")}`);
  if (!Object.hasOwn(ACCENTS, raw.accent)) bad(`accent must be one of ${Object.keys(ACCENTS).join(", ")}`);
  if (typeof raw.showRightToWork !== "boolean") bad("showRightToWork must be true or false");
  if (!["snapshot", "current"].includes(raw.resumeProfile)) bad("resumeProfile must be snapshot or current");
  let openaiModels: EngineConfig["openaiModels"];
  if (raw?.openaiModels !== undefined) { for (const r of ["analyst", "writer", "checker", "coach"]) if (typeof raw.openaiModels?.[r] !== "string" || !raw.openaiModels[r]) bad(`openaiModels.${r} is missing`); openaiModels = raw.openaiModels; }
  return { models, ...(openaiModels ? { openaiModels } : {}), agentTimeoutSeconds: num("agentTimeoutSeconds"), researchTimeoutSeconds: num("researchTimeoutSeconds"), maxAdChars: num("maxAdChars"), writerMode: raw.writerMode, tone: raw.tone as Tone, accent: raw.accent as Accent, showRightToWork: raw.showRightToWork, resumeProfile: raw.resumeProfile, radarDay: String(raw.radarDay ?? "Mon"), radarTime: String(raw.radarTime ?? "09:00") };
}
export const loadConfig = async (file = path.join(ENGINE_DIR, "config.json")) => parseConfig(JSON.parse(await readFile(file, "utf8")));
