// Phase 6: the Electron PDF renderer's logic with a fake print window (the real window is exercised in the real-Electron test).
import { readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ElectronPdfRenderer, type PrintWindowLike } from "../src/main/core/electron-pdf.ts";
let failures = 0; const check = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const tmp = mkdtempSync(path.join(os.tmpdir(), "cvapp-pdf-")); const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2000, 1)]);
const mk = (o: { printed?: Buffer; loadFails?: boolean; hang?: boolean } = {}) => { const log: string[] = []; const win: PrintWindowLike = { async loadFile(f) { log.push("load:" + readFileSync(f, "utf8")); if (o.loadFails) throw new Error("/Users/x/secret failed"); if (o.hang) await new Promise(() => undefined); }, async printToPDF(opts) { log.push("print:" + JSON.stringify(opts)); return o.printed ?? pdf; }, destroy() { log.push("destroy"); } }; return { win, log }; };
try {
  const a = mk(); const out = await new ElectronPdfRenderer({ create: () => a.win, tmpDir: tmp }).renderPdf("<html>CV</html>");
  check("renders: the HTML is written to a private temp file, loaded, printed with the CSS page size and backgrounds, and the PDF comes back", out.equals(pdf) && a.log[0] === "load:<html>CV</html>" && /preferCSSPageSize":true/.test(a.log[1]) && /printBackground":true/.test(a.log[1]) && /displayHeaderFooter":false/.test(a.log[1]));
  check("the window is destroyed and the temp folder removed after a good render", a.log.at(-1) === "destroy" && readdirSync(tmp).length === 0);
  const b = mk({ loadFails: true }); let m = ""; try { await new ElectronPdfRenderer({ create: () => b.win, tmpDir: tmp }).renderPdf("x"); } catch (e) { m = (e as Error).message; }
  check("a load failure rejects, the window is still destroyed and nothing is left on disk", m.length > 0 && b.log.at(-1) === "destroy" && readdirSync(tmp).length === 0);
  const c = mk({ printed: Buffer.from("not a pdf at all".repeat(100)) }); let m2 = ""; try { await new ElectronPdfRenderer({ create: () => c.win, tmpDir: tmp }).renderPdf("x"); } catch (e) { m2 = (e as Error).message; }
  check("output that is not a PDF is refused (never saved as a CV)", /no valid PDF/.test(m2));
  const d = mk({ hang: true }); let m3 = ""; try { await new ElectronPdfRenderer({ create: () => d.win, tmpDir: tmp, timeoutMs: 80 }).renderPdf("x"); } catch (e) { m3 = (e as Error).message; }
  check("a render that hangs is stopped after the time limit, and the window is destroyed", /too long/.test(m3) && d.log.at(-1) === "destroy" && readdirSync(tmp).length === 0);
  const tiny = mk({ printed: Buffer.from("%PDF-1.7") }); let m4 = ""; try { await new ElectronPdfRenderer({ create: () => tiny.win, tmpDir: tmp }).renderPdf("x"); } catch (e) { m4 = (e as Error).message; }
  check("a tiny or empty PDF is refused", /no valid PDF/.test(m4));
} finally { rmSync(tmp, { recursive: true, force: true }); }
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); } else console.log("\nALL PASS");
