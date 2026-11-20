// Telegram handlers (phase 8). The token goes in and is never sent back; pairing returns only a short code.
import type { Handlers } from "./ipc.ts";
import type { Host } from "./core/host.ts";
import type { UiTelegram } from "../shared/contract.ts";

export function createTelegramHandlers(d: { host: Host }): Pick<Handlers, "telegram:status" | "telegram:saveToken" | "telegram:pair" | "telegram:cancelPair" | "telegram:disconnect"> {
  const core = () => { const c = d.host.core(); if (!c) throw new Error("not ready"); return c; };
  const status = async (): Promise<UiTelegram> => core().telegram.status();
  return {
    "telegram:status": () => status(),
    "telegram:saveToken": async ({ token }) => { const r = await core().telegram.saveToken(token); return r.ok ? { ok: true, botName: r.botName, reason: null, status: await status() } : { ok: false, botName: null, reason: r.reason, status: await status() }; },
    "telegram:pair": async () => {
      const t = core().telegram; void t.pair().then((r) => { if (r.paired) void t.start().catch(() => undefined); }).catch(() => undefined);
      for (let i = 0; i < 40; i++) { const s = await t.status(); if (s.state === "pairing" && s.code) return s; await new Promise((r) => setTimeout(r, 25)); }
      return status();
    },
    "telegram:cancelPair": async () => { core().telegram.cancelPairing(); await new Promise((r) => setTimeout(r, 30)); return status(); },
    "telegram:disconnect": async () => { await core().telegram.disconnect(); return status(); },
  };
}
