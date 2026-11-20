// A minimal Telegram Bot API client: plain HTTPS calls, no framework. Holds the bot token in memory only.
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { redact } from "./checks.ts";

export type Button = { text: string; data: string };
export const NOTIFY_ENV = path.join(os.homedir(), ".config", "careers-agent", "notify.env");

export async function readBotToken(file = NOTIFY_ENV): Promise<string> {
  const text = await readFile(file, "utf8");
  const m = text.match(/^TELEGRAM_BOT_TOKEN=["']?(\d{5,}:[A-Za-z0-9_-]{30,})["']?\s*$/m);
  if (!m) throw new Error(`no TELEGRAM_BOT_TOKEN line in ${file}`);
  return m[1];
}

// The Coach writes light markdown (**bold**, "- " bullets). Telegram's HTML mode is the safest way to show it:
// everything is escaped first, then only <b> is added back.
export function toTelegramHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>").replace(/^\s*[-*] /gm, "• ").replace(/^#{1,3} (.+)$/gm, "<b>$1</b>");
}

// Telegram allows 4096 characters per message; split on paragraph or line breaks.
export function chunks(text: string, max = 3800): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

const keyboard = (rows: Button[][]) => ({ inline_keyboard: rows.map((r) => r.map((b) => ({ text: b.text, callback_data: b.data }))) });

export function createTelegram(token: string, fetchImpl: typeof fetch = fetch) {
  const base = `https://api.telegram.org/bot${token}`;
  async function call(method: string, body: Record<string, unknown>, timeoutMs = 30_000): Promise<any> {
    const res = await fetchImpl(`${base}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const j: any = await res.json().catch(() => ({}));
    if (!j.ok) throw new Error(`Telegram ${method}: ${redact(j.description ?? res.status, 200)}`);
    return j.result;
  }
  return {
    call,
    getUpdates: (offset: number, timeout = 50) => call("getUpdates", { offset, timeout, allowed_updates: ["message", "callback_query"] }, (timeout + 15) * 1000) as Promise<any[]>,
    async send(chatId: number, text: string, buttons?: Button[][]): Promise<number | undefined> {
      const parts = chunks(text);
      let last: number | undefined;
      for (let i = 0; i < parts.length; i++) {
        const markup = i === parts.length - 1 && buttons?.length ? { reply_markup: keyboard(buttons) } : {};
        try { last = (await call("sendMessage", { chat_id: chatId, text: toTelegramHtml(parts[i]), parse_mode: "HTML", disable_web_page_preview: true, ...markup })).message_id; }
        catch { last = (await call("sendMessage", { chat_id: chatId, text: parts[i], disable_web_page_preview: true, ...markup })).message_id; } // plain text if HTML is rejected
      }
      return last;
    },
    async sendDocument(chatId: number, file: string, filename: string, caption?: string, buttons?: Button[][]) {
      const form = new FormData();
      form.set("chat_id", String(chatId));
      form.set("document", new Blob([await readFile(file)], { type: "application/pdf" }), filename);
      if (caption) form.set("caption", caption.slice(0, 1000));
      if (buttons?.length) form.set("reply_markup", JSON.stringify(keyboard(buttons)));
      const res = await fetchImpl(`${base}/sendDocument`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
      const j: any = await res.json().catch(() => ({}));
      if (!j.ok) throw new Error(`Telegram sendDocument: ${redact(j.description ?? res.status, 200)}`);
    },
    // The menu pinned at the bottom of the chat (Telegram's "reply keyboard"). It stays until replaced.
    sendMenu: (chatId: number, text: string, rows: string[][]) => call("sendMessage", {
      chat_id: chatId, text: toTelegramHtml(text), parse_mode: "HTML",
      reply_markup: { keyboard: rows.map((r) => r.map((t) => ({ text: t }))), resize_keyboard: true, is_persistent: true, input_field_placeholder: "Tap a button below" },
    }),
    answer: (id: string, text?: string) => call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text: text.slice(0, 190) } : {}) }).catch(() => {}),
    clearButtons: (chatId: number, messageId: number) => call("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {}),
    typing: (chatId: number) => call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {}),
  };
}
export type Telegram = ReturnType<typeof createTelegram>;
