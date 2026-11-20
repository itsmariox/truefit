// Real dependencies for the app core (phase 4d): the Claude program, the login-status runner, the config, fonts and the secret store. The Electron pieces
// (app paths, safeStorage, execFile) are passed in by index.ts, so this file has no Electron import and can be exercised in plain Node.
import path from "node:path";
import { execFile } from "node:child_process";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { findBundledClaude } from "../../../../engine/src/access/access.ts";
import { spawnRunner } from "../../../../engine/src/access/status.ts";
import { loadConfig } from "../../../../engine/src/config.ts";
import { loadFonts } from "../../../../engine/src/cv/render.ts";
import type { PdfRenderer } from "../../../../engine/src/cv/render.ts";
import type { FontUrls } from "../../../../engine/src/cv/html.ts";
import { SafeStorageSecretStore, keychainKeyRemover, type SafeStorageLike } from "./secret-store.ts";
import type { ModelProvider } from "../../../../engine/src/agents/provider.ts";
import type { CoreDeps } from "./app-core.ts";

// The SDK is told where the Claude program is (inside a packaged app the program is unpacked next to the archive; left to itself the SDK looks inside the archive and cannot run it).
type QueryLike = (a: { prompt: unknown; options: Record<string, unknown> }) => unknown;
export const withBinary = (q: QueryLike, binary: string | null): QueryLike => (binary ? (a) => q({ ...a, options: { ...a.options, pathToClaudeCodeExecutable: binary } }) : q);

// Building the PDF arrives with the Build CV screens (phase 6, printToPDF in Electron). Until then a call fails with a plain sentence instead of pretending.
const notYetRenderer: PdfRenderer = { async render() { throw new Error("Building the CV is not part of this version yet."); } } as never;

// `engineDir` holds config.json, skills/ and assets/fonts/. It is passed in because the bundled main process cannot work it out from its own file location.
export async function realDeps(o: { renderer?: PdfRenderer; query?: unknown; provider?: ModelProvider; openUrl?: (url: string) => Promise<void>; openai?: { fetch?: typeof fetch; baseUrl?: string; authBase?: string }; claudeBinaryPath?: string; configDir?: string; engineDir: string; userDataDir: string; appName: string; safeStorage: SafeStorageLike; tmpDir: string; log?: (l: string) => void }): Promise<CoreDeps> {
  const claudeBinary = findBundledClaude(o.claudeBinaryPath), config = await loadConfig(path.join(o.engineDir, "config.json"));
  let fonts: FontUrls; try { fonts = await loadFonts(path.join(o.engineDir, "assets", "fonts")); } catch { fonts = {} as never; } // fonts are only needed to build a CV (phase 6)
  const dataDir = path.join(o.userDataDir, "data");
  return {
    dataDir, log: o.log, tmpDir: o.tmpDir, ...(o.openUrl ? { openUrl: o.openUrl } : {}), ...(o.openai ? { openai: o.openai } : {}),
    secrets: new SafeStorageSecretStore(path.join(dataDir, "secrets"), o.safeStorage),
    query: (o.query ?? withBinary(query as never, claudeBinary)) as never, claudeBinary, statusRunner: spawnRunner(claudeBinary ?? "/nonexistent-claude"),
    renderer: o.renderer ?? notYetRenderer, fonts,
    base: { ...(o.provider ? { provider: o.provider } : {}), tone: "friendly", config, skillsDir: path.join(o.engineDir, "skills"), tmpRoot: o.tmpDir, env: process.env, now: () => new Date(), configDir: o.configDir },
    pipelineConfig: { accent: "oxford", showRightToWork: true, resumeProfile: "snapshot" },
    keychainKey: keychainKeyRemover({ appName: o.appName, execFile: (file, args) => new Promise((resolve) => execFile(file, args, (err) => resolve({ code: err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code || 1) : 1) : 0 }))) }),
  };
}
