// Phase 8: Telegram pairing and the bot loop with a FAKE Telegram (no network). The token is a secret; only the chat that sends the exact code is paired.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTelegramService } from "../src/main/core/telegram-service.ts";
import { MemorySecretStore, SECRET_NAMES } from "../../engine/src/store/secrets.ts";
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const TOKEN = "123456789:AAFakeFakeFakeFakeFakeFakeFakeFake_abc";
function fakeTelegram(valid = true) {
  const updates: any[] = [], sent: { chat: number; text: string }[] = [], calls: string[] = []; let seq = 100;
  const fetchImpl = (async (url: string, init: any) => {
    const method = String(url).split("/").pop()!, body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : {}; calls.push(method);
    const reply = (result: unknown) => ({ json: async () => ({ ok: true, result }) });
    if (!String(url).includes(TOKEN) || !valid) return { json: async () => ({ ok: false, description: "Unauthorized" }) };
    if (method === "getMe") return reply({ username: "my_test_bot" });
    if (method === "getUpdates") { const off = body.offset ?? 0; if (off === -1) return reply(updates.slice(-1)); return reply(updates.filter((u) => u.update_id >= off)); }
    if (method === "sendMessage") { sent.push({ chat: body.chat_id, text: String(body.text) }); return reply({ message_id: ++seq }); }
    return reply(true);
  }) as unknown as typeof fetch;
  const msg = (chat: number, text: string, type = "private") => { updates.push({ update_id: ++seq, message: { message_id: seq, chat: { id: chat, type }, from: { id: chat }, text } }); };
  return { fetchImpl, updates, sent, calls, msg };
}
const settingsOf = () => { const s = { "telegram.chatId": null as number | null, "telegram.enabled": false }; return { s, api: { get: () => ({ ...s }), set: (p: any) => { Object.assign(s, p); return { ok: true }; } } }; };
const dir = mkdtempSync(path.join(os.tmpdir(), "cvapp-tg-"));
try {
  const tg = fakeTelegram(), secrets = new MemorySecretStore(), st = settingsOf();
  const svc = createTelegramService({ secrets, settings: st.api as never, pipeline: () => null, stateDir: dir, fetchImpl: tg.fetchImpl, pollSeconds: 0, pairingMs: 400 });
  ok("1. a new install has Telegram off", (await svc.status()).state === "off");
  ok("2. something that is not a token is refused before any network call", (await svc.saveToken("hello")).ok === false && tg.calls.length === 0);
  const bad = createTelegramService({ secrets: new MemorySecretStore(), settings: settingsOf().api as never, pipeline: () => null, stateDir: dir, fetchImpl: fakeTelegram(false).fetchImpl, pollSeconds: 0 });
  const refused = await bad.saveToken(TOKEN); ok("3. a token Telegram refuses is not saved and says 'refused'", !refused.ok && refused.reason === "refused" && (await bad.status()).state === "off");
  const good = await svc.saveToken("  " + TOKEN + " ");
  ok("4. a good token is checked with Telegram (getMe), saved as a secret, and the bot's name is shown; the token is never returned", good.ok && good.botName === "my_test_bot" && (await secrets.get(SECRET_NAMES.telegramBotToken)) === TOKEN && !JSON.stringify(good).includes(TOKEN) && (await svc.status()).state === "token_saved");
  // pairing: a stranger sends the wrong text first, then a group chat sends the code, then the owner's private chat sends it
  const pairing = svc.pair(); await new Promise((r) => setTimeout(r, 30)); const code = (await svc.status()).code!;
  ok("5. pairing shows a six-digit code", /^\d{6}$/.test(code) && (await svc.status()).state === "pairing");
  tg.msg(555, "hello"); tg.msg(777, code, "group"); await new Promise((r) => setTimeout(r, 30));
  ok("6. a wrong message and the right code sent from a GROUP do not pair", st.s["telegram.chatId"] === null);
  tg.msg(4242, code); const r = await pairing;
  ok("7. the private chat that sends the exact code is paired: its chat id is saved, Telegram is switched on, the code is gone, and the bot says so", r.paired && st.s["telegram.chatId"] === 4242 && st.s["telegram.enabled"] === true && (await svc.status()).code === null && tg.sent.some((m) => m.chat === 4242 && /Paired/.test(m.text)));
  ok("8. nothing was said to the strangers", !tg.sent.some((m) => m.chat === 555 || m.chat === 777));
  const tg2 = fakeTelegram(), sv2 = createTelegramService({ secrets, settings: settingsOf().api as never, pipeline: () => null, stateDir: dir, fetchImpl: tg2.fetchImpl, pollSeconds: 0, pairingMs: 120 }); const timed = await sv2.pair();
  ok("9. with nobody answering, pairing ends after its time limit unpaired", !timed.paired);
  const sv3 = createTelegramService({ secrets, settings: settingsOf().api as never, pipeline: () => null, stateDir: dir, fetchImpl: tg2.fetchImpl, pollSeconds: 0, pairingMs: 5000 }); const p3 = sv3.pair(); await new Promise((r) => setTimeout(r, 30)); sv3.cancelPairing(); const c3 = await p3;
  ok("10. cancelling stops pairing at once", !c3.paired && (await sv3.status()).state === "token_saved");
  ok("11. the bot does not start before there is a pairing", (await createTelegramService({ secrets, settings: settingsOf().api as never, pipeline: () => null, stateDir: dir, fetchImpl: tg.fetchImpl, pollSeconds: 0 }).start()) === false);
  const started = await svc.start(); tg.sent.length = 0; tg.msg(4242, "hi there"); await new Promise((r) => setTimeout(r, 200));
  ok("12. once paired the bot runs and answers the paired chat (the engine's own bot handles the message)", started && (await svc.status()).state === "running" && tg.sent.some((m) => m.chat === 4242));
  tg.sent.length = 0; tg.msg(9999, "let me in"); await new Promise((r) => setTimeout(r, 200));
  ok("13. a message from any OTHER chat never gets the bot's menu (at most a refusal)", !tg.sent.some((m) => m.chat === 9999 && /New job|My jobs/.test(m.text)));
  await svc.stop(); const calls = tg.calls.length; tg.msg(4242, "after stop"); await new Promise((r) => setTimeout(r, 100));
  ok("14. after stop nothing is polled any more", tg.calls.length === calls && (await svc.status()).state === "paired");
  await svc.disconnect();
  ok("15. disconnect removes the token and the pairing and switches Telegram off", (await secrets.get(SECRET_NAMES.telegramBotToken)) === null && (await svc.status()).state === "off");
} finally { rmSync(dir, { recursive: true, force: true }); }
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); } else console.log("\nALL PASS");
