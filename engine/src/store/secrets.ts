// Where secrets live (phase 2g, PRD 11 / 15). The API keys, the ChatGPT sign-in and the Telegram bot token are NEVER in the database, a backup, an export or a log: only in the macOS Keychain.
// The real Keychain implementation arrives with the app shell (phase 4: it needs Electron or a native call). Everything here works against this interface.
export const SECRET_NAMES = { claudeApiKey: "claude-api-key", telegramBotToken: "telegram-bot-token", openaiApiKey: "openai-api-key", openaiPlan: "openai-plan-signin", openaiHostId: "openai-host-id", openaiRegistration: "openai-registration" } as const;
// A secret is short, except the ChatGPT-plan sign-in record (three tokens and their details as one JSON text).
export const MAX_SECRET_LENGTH: Record<string, number> = { [SECRET_NAMES.openaiPlan]: 24_000 };
export const DEFAULT_MAX_SECRET_LENGTH = 2000;
export interface SecretStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<boolean>;  // true when something was removed, false when there was nothing; throws when the removal failed
}
// For tests only.
export class MemorySecretStore implements SecretStore {
  data = new Map<string, string>(); failDelete = new Set<string>();
  async get(n: string) { return this.data.get(n) ?? null; }
  async set(n: string, v: string) { this.data.set(n, v); }
  async delete(n: string) { if (this.failDelete.has(n)) throw new Error("keychain refused"); return this.data.delete(n); }
}
