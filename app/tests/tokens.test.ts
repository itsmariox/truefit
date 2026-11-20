// Phase 4c: the design tokens. The generated CSS must match design/tokens.json, and every colour pair the design uses must keep its contrast (WCAG 2.x).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCss } from "../scripts/tokens-to-css.ts";
const here = path.dirname(fileURLToPath(import.meta.url));
const tokens = JSON.parse(readFileSync(path.join(here, "..", "..", "design", "tokens.json"), "utf8"));
let failures = 0;
const check = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
check("the committed tokens.css is exactly what the generator makes from design/tokens.json (one source of truth; run `npm run tokens` after a change)", readFileSync(path.join(here, "..", "src", "renderer", "tokens.css"), "utf8") === buildCss(tokens));
check("dark and light define exactly the same colour names, and every colour is a six-digit hex", JSON.stringify(Object.keys(tokens.color.dark).sort()) === JSON.stringify(Object.keys(tokens.color.light).sort()) && Object.values({ ...tokens.color.dark, ...tokens.color.light }).every((v) => /^#[0-9A-Fa-f]{6}$/.test(v as string)));
const lum = (h: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const PAIRS: [string, string, number][] = [["text", "main", 4.5], ["text", "sidebar", 4.5], ["text", "card", 4.5], ["text", "composer", 4.5], ["text", "chrome", 4.5], ["muted", "main", 4.5], ["muted", "sidebar", 4.5], ["muted", "card", 4.5], ["muted", "composer", 4.5], ["muted", "chrome", 4.5], ["muted2", "chrome", 3], ["link", "chrome", 4.5], ["link", "main", 4.5], ["onSend", "send", 4.5], ["onGood", "good", 4.5], ["good", "goodBg", 4.5], ["warn", "warnBg", 4.5], ["good", "main", 4.5], ["warn", "main", 4.5], ["text", "rowSelected", 4.5], ["text", "segOn", 4.5], ["text", "railActive", 3], ["fieldEdge", "main", 3], ["fieldEdge", "card", 3], ["fieldEdge", "composer", 3], ["fieldEdge", "sidebar", 3], ["text", "surface", 4.5], ["muted", "surface", 4.5], ["text", "surface2", 4.5], ["muted", "surface2", 4.5], ["fieldEdge", "surface", 3], ["good", "surface", 4.5], ["text", "main", 7]];
for (const mode of ["dark", "light"] as const) {
  const c = tokens.color[mode], low = PAIRS.filter(([a, b, need]) => ratio(c[a], c[b]) < need).map(([a, b, n]) => `${a}/${b} ${ratio(c[a], c[b]).toFixed(2)} < ${n}`);
  check(`${mode}: all ${PAIRS.length} colour pairs meet their contrast (text 4.5, icons and field edges 3)${low.length ? " FAILING: " + low.join("; ") : ""}`, low.length === 0);
}
check("the verdict colours map to semantic tokens that exist, and the rule 'never colour alone' is written down", (Object.values(tokens.semantic.verdict) as string[]).every((k) => k in tokens.color.dark) && /icon/i.test(tokens.semantic.neverColourAlone) && /word/i.test(tokens.semantic.neverColourAlone));
console.log(failures === 0 ? "\nall tokens tests passed" : `\n${failures} tokens test(s) FAILED`); process.exit(failures === 0 ? 0 : 1);
