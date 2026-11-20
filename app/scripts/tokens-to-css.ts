// Generates src/renderer/tokens.css from ../design/tokens.json (the single source of the look). Run: npm run tokens. A test fails if the committed file is out of date.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
export function buildCss(tokens: any): string {
  const vars = (c: Record<string, string>) => Object.entries(c).map(([k, v]) => `  --c-${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}: ${v};`).join("\n");
  const t = tokens.type, r = tokens.radius, s = tokens.size, sp: number[] = tokens.space ?? [];
  const fixed = [`  --font-ui: ${tokens.font.ui};`, `  --font-mono: ${tokens.font.mono};`, ...Object.entries(r).map(([k, v]) => `  --r-${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}: ${v}px;`), ...sp.map((v) => `  --sp-${v}: ${v}px;`), ...Object.entries(s).map(([k, v]) => `  --s-${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}: ${v}px;`), ...Object.entries(t).map(([k, v]: [string, any]) => `  --t-${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}-size: ${v.size}px;\n  --t-${k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}-weight: ${v.weight};`)].join("\n");
  return `/* GENERATED from design/tokens.json by scripts/tokens-to-css.ts: do not edit by hand. */\n:root {\n${fixed}\n${vars(tokens.color.light)}\n  color-scheme: light;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n${vars(tokens.color.dark)}\n    color-scheme: dark;\n  }\n}\n:root[data-theme="light"] {\n${vars(tokens.color.light)}\n  color-scheme: light;\n}\n:root[data-theme="dark"] {\n${vars(tokens.color.dark)}\n  color-scheme: dark;\n}\n`;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tokens = JSON.parse(readFileSync(path.join(here, "..", "..", "design", "tokens.json"), "utf8"));
  writeFileSync(path.join(here, "..", "src", "renderer", "tokens.css"), buildCss(tokens)); console.log("tokens.css written");
}
