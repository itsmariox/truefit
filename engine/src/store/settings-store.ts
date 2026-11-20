// App settings in the database (phase 2c, PRD 14). Typed, with defaults. NEVER holds a secret: the API key and the Telegram bot token live in the macOS Keychain.
import type { Db } from "./db.ts";
import { TONES } from "../agents/prompts.ts";
import { ACCENTS } from "../cv/html.ts";

type Rule = { default: unknown; ok: (v: unknown) => boolean };
const bool: Rule = { default: true, ok: (v) => typeof v === "boolean" };
const oneOf = (xs: readonly string[], d: string): Rule => ({ default: d, ok: (v) => typeof v === "string" && xs.includes(v) });
export const SETTINGS = {
  tone: oneOf(TONES, "friendly"),
  accent: oneOf(Object.keys(ACCENTS), "oxford"),
  appearance: oneOf(["light", "dark", "system"], "light"),                                          // how the app window looks: light (the default), dark, or follow the Mac
  showRightToWork: bool,
  "notify.analysed": bool, "notify.cvReady": bool, "notify.needsInput": bool, "notify.failed": bool,
  "onboarding.done": { default: false, ok: (v) => typeof v === "boolean" } as Rule,                       // the first-run guide was finished or skipped
  updateCheck: bool,                                                                                  // the daily GitHub check (PRD 11); a manual check is always available
  startAtLogin: { default: false, ok: (v) => typeof v === "boolean" } as Rule,
  "telegram.enabled": { default: false, ok: (v) => typeof v === "boolean" } as Rule,
  "claude.mode": { default: null, ok: (v) => v === null || v === "subscription" || v === "apiKey" } as Rule,                              // how this Mac connects to Claude (PRD 09)
  "ai.provider": { default: "claude", ok: (v) => v === "claude" || v === "openai" } as Rule,                                                          // which AI service answers: Claude or OpenAI (this Mac only: never exported)
  "openai.noticeAcceptedAt": { default: null, ok: (v) => v === null || (typeof v === "string" && Number.isFinite(Date.parse(v))) } as Rule, // when the ChatGPT-plan notice was ticked
  "claude.noticeAcceptedAt": { default: null, ok: (v) => v === null || (typeof v === "string" && Number.isFinite(Date.parse(v))) } as Rule, // when the subscription risk notice was ticked
  "spend.monthlyCapUsd": { default: null, ok: (v) => v === null || (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100000) } as Rule, // optional monthly spend cap for the API-key mode (PRD 09); a preference, so it IS exported
  "telegram.chatId": { default: null, ok: (v) => v === null || (typeof v === "number" && Number.isSafeInteger(v)) } as Rule, // the pairing only; the bot token is a secret
} as const satisfies Record<string, Rule>;
export type SettingKey = keyof typeof SETTINGS;
export type Settings = { "onboarding.done": boolean; tone: string; accent: string; appearance: string; showRightToWork: boolean; "notify.analysed": boolean; "notify.cvReady": boolean; "notify.needsInput": boolean; "notify.failed": boolean; updateCheck: boolean; startAtLogin: boolean; "telegram.enabled": boolean; "telegram.chatId": number | null; "claude.mode": "subscription" | "apiKey" | null; "claude.noticeAcceptedAt": string | null; "ai.provider": "claude" | "openai"; "openai.noticeAcceptedAt": string | null; "spend.monthlyCapUsd": number | null };
const SECRETISH = /token|secret|password|api[-_.]?key|credential/i;

export const defaultSettings = (): Settings => Object.fromEntries(Object.entries(SETTINGS).map(([k, r]) => [k, r.default])) as Settings;

// Reads every setting; a missing one gets its default, a stored value that is no longer valid is replaced by the default and listed in `repaired` (never an error at start-up).
export function getSettings(db: Db): { settings: Settings; repaired: string[] } {
  const out = defaultSettings() as Record<string, unknown>, repaired: string[] = [];
  for (const row of db.all<{ key: string; value: string }>("SELECT key, value FROM settings")) {
    const rule = (SETTINGS as Record<string, Rule>)[row.key];
    if (!rule) continue; // a key from a newer version or an old one: ignored, not deleted
    try { const v = JSON.parse(row.value); if (rule.ok(v)) out[row.key] = v; else repaired.push(row.key); } catch { repaired.push(row.key); }
  }
  return { settings: out as Settings, repaired };
}

// Changes settings: the WHOLE patch is checked first; one unknown key, secret-looking key or bad value refuses everything and nothing is written.
export function setSettings(db: Db, patch: Partial<Settings>, now: Date): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (SECRETISH.test(k)) { errors.push(`${k}: secrets are never stored in settings`); continue; }
    const rule = (SETTINGS as Record<string, Rule>)[k];
    if (!rule) errors.push(`${k}: not a setting`); else if (!rule.ok(v)) errors.push(`${k}: not an allowed value`);
  }
  if (errors.length) return { ok: false, errors };
  db.transaction(() => { for (const [k, v] of Object.entries(patch)) db.run("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", k, JSON.stringify(v), now.toISOString()); });
  return { ok: true };
}
