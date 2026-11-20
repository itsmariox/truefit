// Telegram inside the app (phase 8). Optional. The bot token is a SECRET (the secret store); the chat it talks to is found by PAIRING: the app shows a short code, the user sends that code
// to their own bot, and only the chat that sent the exact code is paired. Nothing else is ever answered before that. The bot itself is the engine's (`createBot`), unchanged.
// It works only while the Mac is awake and the app is running (PRD 07). No Electron import: tested with a fake Telegram.
import { randomInt } from "node:crypto";
import { createBot } from "../../../../engine/src/gateway.ts";
import { createTelegram } from "../../../../engine/src/telegram.ts";
import { SECRET_NAMES, type SecretStore } from "../../../../engine/src/store/secrets.ts";
import type { Pipeline } from "../../../../engine/src/pipeline.ts";

export type TelegramState = "off" | "token_saved" | "pairing" | "paired" | "running" | "error";
export type TelegramDeps = {
  secrets: SecretStore; settings: { get(): { "telegram.chatId": number | null; "telegram.enabled": boolean }; set(p: { "telegram.chatId"?: number | null; "telegram.enabled"?: boolean }): { ok: boolean } };
  pipeline: () => Pipeline | null; stateDir: string; fetchImpl?: typeof fetch; log?: (l: string) => void; pollSeconds?: number; pairingMs?: number; now?: () => number;
};
const TOKEN_SHAPE = /^\d{5,15}:[A-Za-z0-9_-]{20,80}$/;

export function createTelegramService(d: TelegramDeps) {
  let state: TelegramState = "off", code: string | null = null, abort = { stop: false }, botName: string | null = null, loop: Promise<void> | null = null;
  const fetchImpl = d.fetchImpl ?? fetch, poll = d.pollSeconds ?? 50, log = (l: string) => d.log?.(l);
  // A long poll that comes back at once with nothing (a fast or broken server) must never become a busy loop.
  const pause = (t0: number) => new Promise<void>((r) => setTimeout(r, Date.now() - t0 < 400 ? (poll === 0 ? 5 : 400) : 0));
  const token = async () => { try { return (await d.secrets.get(SECRET_NAMES.telegramBotToken)) ?? null; } catch { return null; } };
  const proxy = () => new Proxy({} as Pick<Pipeline, "createJob" | "analyse" | "build" | "extra" | "skip" | "listJobs">, { get: (_t, k) => (...a: unknown[]) => { const p = d.pipeline(); if (!p) throw new Error("no profile yet"); return (p as never as Record<string, (...x: unknown[]) => unknown>)[k as string](...a); } });
  async function refresh() { const t = await token(), s = d.settings.get(); if (state === "pairing" || state === "running") return; state = !t ? "off" : s["telegram.chatId"] !== null && s["telegram.enabled"] ? "paired" : "token_saved"; }
  const stopLoop = async () => { abort.stop = true; await loop?.catch(() => undefined); loop = null; abort = { stop: false }; };

  return {
    async status(): Promise<{ state: TelegramState; botName: string | null; code: string | null }> { await refresh(); return { state, botName, code: state === "pairing" ? code : null }; },
    // Checks the token with Telegram (getMe) and saves it only if it works. The token is never returned or logged.
    async saveToken(raw: string): Promise<{ ok: true; botName: string } | { ok: false; reason: "malformed" | "refused" | "unreachable" }> {
      const t = raw.trim(); if (!TOKEN_SHAPE.test(t)) return { ok: false, reason: "malformed" };
      try { const me = await createTelegram(t, fetchImpl).call("getMe", {}, 15000); await d.secrets.set(SECRET_NAMES.telegramBotToken, t); botName = String(me?.username ?? "your bot").slice(0, 64); state = "token_saved"; return { ok: true, botName }; }
      catch (e) { return { ok: false, reason: /Telegram getMe/.test((e as Error).message) ? "refused" : "unreachable" }; }
    },
    // Shows a code; the chat that sends exactly that code to the bot is paired. Returns when paired, cancelled or out of time.
    async pair(): Promise<{ paired: boolean; code: string }> {
      const t = await token(); if (!t) throw new Error("no token"); await stopLoop();
      code = String(randomInt(100000, 1000000)); state = "pairing"; const mine = code, tg = createTelegram(t, fetchImpl), until = (d.now?.() ?? Date.now()) + (d.pairingMs ?? 5 * 60_000);
      let offset = 0; const old = await tg.getUpdates(-1, 0).catch(() => [] as { update_id: number }[]); if (old.length) offset = old[old.length - 1].update_id + 1;
      try {
        while (!abort.stop && (d.now?.() ?? Date.now()) < until) {
          const t0 = Date.now(); const ups: any[] = await tg.getUpdates(offset, poll).catch(() => []);
          for (const u of ups) {
            offset = Math.max(offset, u.update_id + 1); const m = u.message;
            if (m?.chat?.type === "private" && typeof m.chat.id === "number" && String(m.text ?? "").trim() === mine) {
              d.settings.set({ "telegram.chatId": m.chat.id, "telegram.enabled": true }); await tg.send(m.chat.id, "Paired. You can use this bot to analyse jobs while the app is open on your Mac.").catch(() => undefined);
              code = null; state = "paired"; return { paired: true, code: mine };
            }
          }
          if (ups.length === 0) await pause(t0);
        }
        return { paired: false, code: mine };
      } finally { if (state === "pairing") state = "token_saved"; code = null; }
    },
    cancelPairing() { abort.stop = true; },
    // Starts the bot for the paired chat (nothing is started without a token AND a pairing).
    async start(): Promise<boolean> {
      const t = await token(), s = d.settings.get(); if (!t || s["telegram.chatId"] === null || !s["telegram.enabled"] || state === "running") return false;
      await stopLoop(); const tg = createTelegram(t, fetchImpl), chatId = s["telegram.chatId"]; const bot = createBot({ tg, chatId, userId: chatId, pipeline: proxy(), stateDir: d.stateDir });
      state = "running"; let offset = 0; const old = await tg.getUpdates(-1, 0).catch(() => [] as { update_id: number }[]); if (old.length) offset = old[old.length - 1].update_id + 1;
      const my = abort; loop = (async () => { let fails = 0;
        while (!my.stop) {
          try { const t0 = Date.now(); const ups: any[] = await tg.getUpdates(offset, poll); fails = 0; for (const u of ups) { offset = Math.max(offset, u.update_id + 1); await bot.handle(u).catch((e: Error) => log(`telegram update failed (${e.name})`)); } if (ups.length === 0) await pause(t0); }
          catch (e) { fails++; if (fails === 5) log("telegram: five failed polls in a row"); await new Promise((r) => setTimeout(r, my.stop ? 0 : poll === 0 ? 5 : 3000)); }
        } })();
      return true;
    },
    async stop() { await stopLoop(); if (state === "running") state = "paired"; },
    // Removes the token and the pairing (the bot itself stays in the user's Telegram; they can delete it there).
    async disconnect() { await stopLoop(); await d.secrets.delete(SECRET_NAMES.telegramBotToken).catch(() => undefined); d.settings.set({ "telegram.chatId": null, "telegram.enabled": false }); state = "off"; botName = null; code = null; },
  };
}
export type TelegramService = ReturnType<typeof createTelegramService>;
