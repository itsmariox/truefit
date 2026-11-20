// Saving a piece of text (an extra, possibly edited) as a file: plain text, a Word document (.docx, built by hand: a zip of three small XML files) or a PDF (the app's own print window).
// Pure functions, no Electron and no files, so they are tested directly.
import { strToU8, zipSync } from "fflate";

export type TextFormat = "txt" | "docx" | "pdf";
export const EXTENSION: Record<TextFormat, string> = { txt: ".txt", docx: ".docx", pdf: ".pdf" };
// A file name from free text: slashes, colons and control characters become spaces, at most 80 characters, never empty.
export const safeName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Truefit extra";
// Characters XML 1.0 cannot hold are dropped; the five special ones are escaped.
const xml = (s: string) => [...s].filter((c) => { const n = c.codePointAt(0)!; return n === 9 || n === 10 || n === 13 || (n >= 0x20 && n <= 0xd7ff) || (n >= 0xe000 && n <= 0xfffd) || n >= 0x10000; }).join("").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
export function buildDocx(text: string): Uint8Array {
  const paras = text.replace(/\r\n?/g, "\n").split("\n").map((l) => (l.trim() ? `<w:p><w:r><w:t xml:space="preserve">${xml(l)}</w:t></w:r></w:p>` : "<w:p/>")).join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`),
  };
  return zipSync(files);
}
const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// A plain A4 page for the print window: no scripts, no external files, every line escaped.
export function textToHtml(text: string): string {
  const body = text.replace(/\r\n?/g, "\n").split("\n").map((l) => (l.trim() ? `<p>${html(l)}</p>` : "<p>&nbsp;</p>")).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Truefit</title><style>@page{size:A4;margin:22mm}body{font:11pt/1.5 -apple-system,Helvetica,Arial,sans-serif;color:#111}p{margin:0 0 .6em;white-space:pre-wrap}</style></head><body>${body}</body></html>`;
}
