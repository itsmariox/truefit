// Turns the CV HTML into a PDF. One interface, two implementations over time: headless Chrome here (development and tests),
// Electron's built-in printToPDF inside the app (phase 4 of the product build). Fixed program, fixed arguments, no shell,
// a throwaway profile folder so the user's own browser is never touched.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { fontCoverage } from "./fontcoverage.ts";
import type { FontUrls } from "./html.ts";

const run = promisify(execFile);
export interface PdfRenderer { renderPdf(html: string): Promise<Buffer>; }

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FONTS_DIR = path.resolve(HERE, "..", "..", "assets", "fonts");

// The bundled font (Crimson Text, TrueType outlines on purpose: Chrome stores a CFF/OpenType web font in the PDF as Type 3, but a TrueType one as a
// normal embedded CID TrueType font) as data URLs, so the HTML is self-contained (no file or network access needed to render it).
export async function loadFonts(dir = FONTS_DIR): Promise<FontUrls> {
  const url = async (f: string) => `data:font/ttf;base64,${(await readFile(path.join(dir, f))).toString("base64")}`;
  return { regular: await url("CrimsonText-Regular.ttf"), bold: await url("CrimsonText-Bold.ttf"), italic: await url("CrimsonText-Italic.ttf"), covers: fontCoverage(await readFile(path.join(dir, "CrimsonText-Regular.ttf"))) };
}

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
// An explicit CVAPP_CHROME is honoured exactly: if it points nowhere there is no browser (never a silent fallback to a different one).
export const findChrome = (): string | null => process.env.CVAPP_CHROME ? (existsSync(process.env.CVAPP_CHROME) ? process.env.CVAPP_CHROME : null) : CHROME_CANDIDATES.find((p) => existsSync(p)) ?? null;

export class ChromeCliRenderer implements PdfRenderer {
  private chrome: string | null;
  constructor(chrome: string | null = findChrome()) { this.chrome = chrome; }
  async renderPdf(html: string): Promise<Buffer> {
    if (!this.chrome) throw new Error("no Chromium-based browser found for rendering (set CVAPP_CHROME)");
    const work = await mkdtemp(path.join(os.tmpdir(), "cvapp-render-"));
    try {
      const page = path.join(work, "cv.html"), out = path.join(work, "cv.pdf");
      await writeFile(page, html, "utf8");
      await run(this.chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--no-pdf-header-footer", `--user-data-dir=${path.join(work, "profile")}`, `--print-to-pdf=${out}`, pathToFileURL(page).href],
        { env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME ?? work }, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
      const pdf = await readFile(out);
      if (pdf.length < 1000 || pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("the renderer produced no valid PDF");
      return pdf;
    } finally { await rm(work, { recursive: true, force: true }); }
  }
}
