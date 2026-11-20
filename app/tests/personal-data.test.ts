// The app and design folders are PUBLIC like the engine: no personal name, employer, place or figure may appear in them. The term list is the engine's.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONAL } from "../../engine/tests/personal-terms.ts";
const here = path.dirname(fileURLToPath(import.meta.url));
const roots = [path.join(here, ".."), path.join(here, "..", "..", "design")];
const files: string[] = [];
const walk = (d: string) => { for (const n of readdirSync(d)) { if (["node_modules", "out", "dist", "voice"].includes(n) || n.startsWith(".")) continue; const p = path.join(d, n), s = statSync(p); if (s.isDirectory()) walk(p); else files.push(p); } };
roots.forEach(walk);
const text = files.filter((f) => /\.(ts|tsx|md|json|css|html|js|cjs)$/.test(f) && !/package-lock\.json$/.test(f));
const repo = path.join(here, "..", ".."), hits = text.filter((f) => PERSONAL.test(readFileSync(f, "utf8")) || PERSONAL.test(path.relative(repo, f))).map((f) => path.relative(repo, f)); // the path is checked RELATIVE to the repository (the absolute path holds the user name of whoever built it)
console.log((hits.length === 0 && text.length > 15 ? "PASS " : "FAIL ") + `no personal term in any of ${text.length} text files of app/ and design/${hits.length ? ": " + hits.join(", ") : ""}`);
process.exit(hits.length === 0 && text.length > 15 ? 0 : 1);
