// Which AI service started a job. A CV built from steps by two different services (the analysis by Claude, the writing by OpenAI) would be hard to trust or to debug, so a job is carried on
// only by the service that started it. The marker is one small file in the job's own folder (never in the profile, a backup of settings or an export of keys). A job from before this existed,
// with an analysis but no marker, was started with Claude (the only service there was).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Provider } from "./state.ts";

const FILE = "ai-service.txt";
export function readJobService(dir: string): Provider | null {
  try { const t = readFileSync(path.join(dir, FILE), "utf8").trim(); if (t === "claude" || t === "openai") return t; } catch { /* no marker */ }
  return existsSync(path.join(dir, "analysis.json")) ? "claude" : null;
}
export function markJobService(dir: string, p: Provider): void { try { if (!existsSync(path.join(dir, FILE))) writeFileSync(path.join(dir, FILE), p + "\n", { mode: 0o600 }); } catch { /* a folder that cannot be written fails its own step */ } }
// null = fine to carry on with `current`; otherwise the service that started the job.
export const otherService = (dir: string, current: Provider): Provider | null => { const s = readJobService(dir); return s && s !== current ? s : null; };
const NAME: Record<Provider, string> = { claude: "Claude", openai: "OpenAI" };
export const describeOtherService = (started: Provider, current: Provider): string =>
  `This job was started with ${NAME[started]}, so only ${NAME[started]} can carry it on, and ${NAME[current]} is chosen now. Switch back to ${NAME[started]} in Settings, or add the ad again as a new job to use ${NAME[current]}.`;
