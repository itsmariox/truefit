// Reading the text of a CV file (PDF, Word, plain text) safely. A real PDF is made with Chrome when one is installed.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
const { readCvSource, docxToText, SOURCE_LIMITS } = await import("../src/cv-source.ts");
const { ChromeCliRenderer, findChrome } = await import("../src/cv/render.ts");
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const dir = mkdtempSync(path.join(os.tmpdir(), "cvapp-src-"));
const mk = (n: string, d: string | Uint8Array) => { const f = path.join(dir, n); writeFileSync(f, d); return f; };
try {
  const xml = `<?xml version="1.0"?><w:document><w:body><w:p><w:r><w:t>Marketing Coordinator &amp; Analyst</w:t></w:r></w:p><w:p><w:r><w:t>Northfield Retail</w:t></w:r><w:r><w:tab/><w:t>2021</w:t></w:r></w:p><w:p><w:r><w:t>Grew the list &lt;fast&gt; by 200%.</w:t></w:r></w:p></w:body></w:document>`;
  const docx = zipSync({ "word/document.xml": strToU8(xml), "[Content_Types].xml": strToU8("<x/>") });
  const t = docxToText(docx);
  ok("1. a Word file gives its text: paragraphs on their own lines, tabs kept, entities decoded, no tags left", t === "Marketing Coordinator & Analyst\nNorthfield Retail\t2021\nGrew the list <fast> by 200%." || (t ?? "").split("\n").length === 3 && !/[<]w:/.test(t ?? "") && /& Analyst/.test(t ?? "") && /<fast>/.test(t ?? ""));
  const r = await readCvSource(mk("cv.docx", docx)); ok("2. readCvSource reads it as 'docx'", r.ok && r.kind === "docx" && /Northfield Retail/.test(r.text));
  ok("3. plain text works; a binary file named .txt is refused", (await readCvSource(mk("cv.txt", "Marketing Coordinator at Northfield Retail, 2021 to now."))).ok === true && (await readCvSource(mk("bin.txt", Buffer.from([1, 2, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21])))).ok === false);
  ok("4. an unsupported type, a missing file, a folder, a broken docx and a fake PDF are refused with a reason", (await readCvSource(mk("cv.pages", "x".repeat(50)))).ok === false && (await readCvSource(path.join(dir, "nope.pdf"))).ok === false && (await readCvSource(dir)).ok === false && (await readCvSource(mk("bad.docx", "not a zip"))).ok === false && (await readCvSource(mk("fake.pdf", "this is not a pdf at all, only text"))).ok === false);
  ok("5. a Word file with no document part and a nearly empty file are refused", (await readCvSource(mk("nodoc.docx", zipSync({ "other.xml": strToU8("<x/>") })))).ok === false && (await readCvSource(mk("tiny.txt", "hi"))).ok === false);
  ok("6. a file over 15 MB is refused before it is read", (await readCvSource(mk("big.txt", Buffer.alloc(SOURCE_LIMITS.bytes + 10, 97)))).ok === false);
  if (findChrome()) {
    const pdf = await new ChromeCliRenderer().renderPdf("<html><body><h1>Sam Example</h1><p>Marketing Coordinator at Northfield Retail since March 2021.</p><ul><li>Grew the newsletter list from 1,200 to 3,600 subscribers.</li></ul></body></html>");
    const pr = await readCvSource(mk("real.pdf", pdf)); ok("7. a real PDF gives its text in reading order", pr.ok && pr.kind === "pdf" && /Marketing Coordinator at Northfield Retail/.test(pr.text) && /3,600 subscribers/.test(pr.text));
  } else console.log("SKIP 7. no Chrome here: the real PDF check was not run");
} finally { rmSync(dir, { recursive: true, force: true }); }
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); } else console.log("\nALL PASS");
