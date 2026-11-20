// The access service (phase 3c): reads the chosen mode and the notice from the settings, asks the free status check or the secret store, remembers the last error,
// and answers `state()`. Everything it touches is passed in, so tests use fakes and the app shell passes the real settings, Keychain and bundled program.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "../store/db.ts";
import { getSettings, setSettings } from "../store/settings-store.ts";
import { SECRET_NAMES, type SecretStore } from "../store/secrets.ts";
import { minimalEnv } from "../agents/options.ts";
import { checkLoginStatus, type StatusRunner } from "./status.ts";
import { planStatus, type PlanStore } from "./openai-plan.ts";
import { computeAccessState, isAccessError, stateFromError, type AccessState, type LastError, type Mode, type Provider } from "./state.ts";

export type AccessDeps = { db: Db; secrets: SecretStore; run: StatusRunner; plan?: PlanStore; now?: () => Date; env?: Record<string, string | undefined>; configDir?: string };

export function createAccess(d: AccessDeps) {
  const now = () => d.now?.() ?? new Date();
  let lastError: LastError | null = null;
  const settings = () => getSettings(d.db).settings;
  const provider = (): Provider => (settings()["ai.provider"] === "openai" ? "openai" : "claude");
  const keyName = () => (provider() === "openai" ? SECRET_NAMES.openaiApiKey : SECRET_NAMES.claudeApiKey);
  const noticeKey = () => (provider() === "openai" ? "openai.noticeAcceptedAt" : "claude.noticeAcceptedAt") as "openai.noticeAcceptedAt" | "claude.noticeAcceptedAt";
  return {
    provider,
    async state(): Promise<AccessState> {
      const s = settings(), mode = (s["claude.mode"] as Mode | null) ?? null, noticeAccepted = !!s[noticeKey()];
      let hasKey: boolean | "unreadable" = false; // a Keychain that cannot be read is NOT "no key"
      if (mode === "apiKey") { try { hasKey = !!(await d.secrets.get(keyName())); } catch { hasKey = "unreadable"; } }
      const status = mode === "subscription" && noticeAccepted
        ? (provider() === "openai" ? (d.plan ? await planStatus(d.plan) : null) : await checkLoginStatus(d.run, minimalEnv(d.env ?? process.env, { configDir: d.configDir })))
        : null;
      return computeAccessState({ mode, noticeAccepted, now: now(), status, hasKey, lastError });
    },
    // A failed call reports what it learned. Only errors about ACCESS are remembered (login, key, account, usage limit); an outage, an overloaded service or a wrong model
    // name pauses that job but does not change the access state. A remembered error is cleared by a success, a mode change, a new key and a finished sign-in, and a limit
    // lapses at its reset time (see computeAccessState).
    recordError(e: LastError): AccessState | null {
      if (!isAccessError(e)) return null;
      lastError = { ...e, recordedAt: e.recordedAt ?? now().toISOString() };
      const mode = (settings()["claude.mode"] as Mode | null) ?? null; return mode ? stateFromError(lastError, mode) : null;
    },
    recordSuccess() { lastError = null; },
    signedIn() { lastError = null; },                                                   // the sign-in flow (3d) calls this when it finishes
    chooseMode(mode: Mode | null) { lastError = null; return setSettings(d.db, { "claude.mode": mode }, now()); }, // the setting keeps its old name; it means "the chosen way to connect" for either service
    // Switching service forgets the chosen way to connect (a Claude "subscription" is not a ChatGPT plan) and any remembered error; the notice and the saved keys of each service stay as they are.
    chooseProvider(p: Provider) { lastError = null; return setSettings(d.db, { "ai.provider": p, "claude.mode": null }, now()); },
    async saveApiKey(key: string) { await d.secrets.set(keyName(), key); lastError = null; },   // a new key has not been tried: the old key's error says nothing about it
    async removeApiKey() { lastError = null; return d.secrets.delete(keyName()); },
    acceptNotice() { return setSettings(d.db, { [noticeKey()]: now().toISOString() }, now()); },
    lastError: () => lastError,
  };
}

// Where the bundled Claude program is. The packaged app (phase 4/10) passes its own unpacked path; here it is found next to the SDK in node_modules.
export function findBundledClaude(override?: string): string | null {
  if (override) return existsSync(override) ? override : null;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++, dir = path.dirname(dir)) { const f = path.join(dir, "node_modules", "@anthropic-ai", `claude-agent-sdk-${process.platform}-${process.arch}`, "claude"); if (existsSync(f)) return f; }
  return null;
}
