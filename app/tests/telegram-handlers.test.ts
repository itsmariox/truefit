// Phase 8: the Telegram handlers on the REAL core (real secret store interface and settings) with a fake Telegram.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startApp } from "../src/main/core/app-core.ts";
import { createHost } from "../src/main/core/host.ts";
import { createTelegramHandlers } from "../src/main/telegram-handlers.ts";
import { rig } from "./core-rig.ts";
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const TOKEN = "123456789:AAFakeFakeFakeFakeFakeFakeFakeFake_abc";
const updates: any[] = []; let seq = 10;
const fetchImpl = (async (url: string, init: any) => { const m = String(url).split("/").pop()!, b = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : {}; const r = (x: unknown) => ({ json: async () => ({ ok: true, result: x }) });
  if (!String(url).includes(TOKEN)) return { json: async () => ({ ok: false, description: "Unauthorized" }) };
  if (m === "getMe") return r({ username: "t_bot" }); if (m === "getUpdates") return b.offset === -1 ? r(updates.slice(-1)) : r(updates.filter((u) => u.update_id >= (b.offset ?? 0))); if (m === "sendMessage") return r({ message_id: ++seq }); return r(true); }) as unknown as typeof fetch;
const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-tgh-")); mkdirSync(path.join(root, "tmp"));
try {
  const R = rig(root); const host = createHost({ start: () => startApp({ ...R.deps(), fetchImpl }), onReady: () => undefined }); await host.start(); const core = host.core()!;
  const h = createTelegramHandlers({ host });
  ok("1. Telegram starts off", (await h["telegram:status"](undefined)).state === "off");
  const bad = await h["telegram:saveToken"]({ token: "x" }); ok("2. a malformed token is refused with a plain reason", !bad.ok && bad.reason === "malformed");
  const good = await h["telegram:saveToken"]({ token: TOKEN });
  ok("3. a good token is saved as a SECRET (not a setting), and the answer never contains it", good.ok && (await R.secrets.get("telegram-bot-token")) === TOKEN && !JSON.stringify(good).includes(TOKEN) && JSON.stringify(core.settings.get()).includes(TOKEN) === false);
  const p = await h["telegram:pair"](undefined); ok("4. pairing returns a six-digit code", p.state === "pairing" && /^\d{6}$/.test(p.code ?? ""));
  updates.push({ update_id: ++seq, message: { message_id: seq, chat: { id: 31337, type: "private" }, from: { id: 31337 }, text: p.code } }); await new Promise((r) => setTimeout(r, 800));
  const after = await h["telegram:status"](undefined);
  ok("5. the chat that sends the code is paired, the pairing is saved in the settings and the bot runs", (after.state === "paired" || after.state === "running") && core.settings.get().settings["telegram.chatId"] === 31337 && core.settings.get().settings["telegram.enabled"] === true);
  await h["telegram:disconnect"](undefined);
  ok("6. disconnect removes the token and the pairing", (await R.secrets.get("telegram-bot-token")) === null && core.settings.get().settings["telegram.chatId"] === null && (await h["telegram:status"](undefined)).state === "off");
  await core.shutdown({ finalBackup: false });
} finally { rmSync(root, { recursive: true, force: true }); }
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); } else console.log("\nALL PASS");
