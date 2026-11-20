// Electron's own print-to-PDF as the CV renderer (phase 6; proven against our ATS checks in the 4a spike). No Chrome needed on the user's Mac. The window is hidden, sandboxed, has no
// Node, no scripts and no network: it only ever shows one local file the app wrote a moment ago, and it is destroyed after every render. Electron's window is passed in (a factory),
// so the logic is tested with a fake and the real thing in the real-Electron test.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PdfRenderer } from "../../../../engine/src/cv/render.ts";

export interface PrintWindowLike {
  loadFile(file: string): Promise<void>;
  printToPDF(options: Record<string, unknown>): Promise<Buffer>;
  destroy(): void;
}
export class ElectronPdfRenderer implements PdfRenderer {
  private create: () => PrintWindowLike; private tmp: string; private timeoutMs: number;
  constructor(o: { create: () => PrintWindowLike; tmpDir: string; timeoutMs?: number }) { this.create = o.create; this.tmp = o.tmpDir; this.timeoutMs = o.timeoutMs ?? 60_000; }
  async renderPdf(html: string): Promise<Buffer> {
    const work = await mkdtemp(path.join(this.tmp, "cvapp-print-")); let win: PrintWindowLike | null = null;
    try {
      const file = path.join(work, "cv.html"); await writeFile(file, html, { encoding: "utf8", mode: 0o600 });
      win = this.create();
      const w = win; let timer: ReturnType<typeof setTimeout> | undefined;
      const limit = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("the renderer took too long")), this.timeoutMs); });
      try {
        const pdf = await Promise.race([(async () => { await w.loadFile(file); return w.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { marginType: "none" }, displayHeaderFooter: false }); })(), limit]);
        if (!pdf || pdf.length < 1000 || pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("the renderer produced no valid PDF");
        return pdf;
      } finally { if (timer) clearTimeout(timer); }
    } finally { try { win?.destroy(); } catch { /* already gone */ } await rm(work, { recursive: true, force: true }); }
  }
}
