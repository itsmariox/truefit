// Reads the TEXT of a CV file on the user's Mac (phase 5b): PDF, Word (.docx), or plain text. Nothing is sent anywhere here; the text is shown to the user's profile import, which masks
// contact details before anything goes to Claude. Strict limits: a file over 15 MB, a PDF over 20 pages, a zip with a huge inflated size (a "zip bomb") or a missing document are refused.
import { readFile, stat } from "node:fs/promises";
import { unzipSync } from "fflate";
import { readPdf } from "./cv/ats.ts";

export const SOURCE_LIMITS = { bytes: 15_000_000, pages: 20, inflated: 30_000_000 };
export type SourceResult = { ok: true; text: string; kind: "pdf" | "docx" | "text" } | { ok: false; reason: "too_big" | "unsupported" | "unreadable" | "empty" };
const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)));

export function docxToText(data: Uint8Array): string | null {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(data, { filter: (f) => f.name === "word/document.xml" && f.originalSize <= SOURCE_LIMITS.inflated }); } catch { return null; }
  const doc = files["word/document.xml"]; if (!doc) return null;
  const xml = new TextDecoder("utf-8").decode(doc);
  return decode(xml.replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "")).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function readCvSource(file: string): Promise<SourceResult> {
  const st = await stat(file).catch(() => null); if (!st || !st.isFile()) return { ok: false, reason: "unreadable" }; if (st.size > SOURCE_LIMITS.bytes) return { ok: false, reason: "too_big" };
  const ext = file.toLowerCase().split(".").pop() ?? ""; const data = await readFile(file).catch(() => null); if (!data) return { ok: false, reason: "unreadable" };
  let text: string | null = null, kind: "pdf" | "docx" | "text";
  if (ext === "pdf") { kind = "pdf"; if (data.subarray(0, 5).toString() !== "%PDF-") return { ok: false, reason: "unreadable" }; try { const p = await readPdf(data); if (p.pages > SOURCE_LIMITS.pages) return { ok: false, reason: "too_big" }; text = p.text; } catch { return { ok: false, reason: "unreadable" }; } }
  else if (ext === "docx") { kind = "docx"; text = docxToText(new Uint8Array(data)); if (text === null) return { ok: false, reason: "unreadable" }; }
  else if (ext === "txt" || ext === "md" || ext === "text") { kind = "text"; if (data.includes(0)) return { ok: false, reason: "unreadable" }; text = data.toString("utf8"); }
  else return { ok: false, reason: "unsupported" };
  text = text.normalize("NFKC").trim(); // ligature glyphs such as "ﬁ" become "fi" (a PDF keeps them as one character)
  return text.length < 20 ? { ok: false, reason: "empty" } : { ok: true, text, kind };
}
