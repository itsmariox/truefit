// Guard for the public repo: no personal name, employer, place or figure in code, skills, tests, assets or config. The private tests live outside this folder (../private).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONAL } from "./personal-terms.ts";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const files: string[] = [];
const walk = (d: string) => { for (const e of readdirSync(d)) { if (e === "node_modules" || e.startsWith(".")) continue; const p = path.join(d, e), s = statSync(p); if (s.isDirectory()) walk(p); else files.push(p); } };
walk(root);
const textual = files.filter((f) => /\.(ts|md|json|txt|sh|html|css|js)$/.test(f) && !/package-lock\.json$/.test(f));
const hits = textual.filter((f) => PERSONAL.test(readFileSync(f, "utf8")) || PERSONAL.test(path.relative(root, f))).map((f) => path.relative(root, f));
ok(`no personal term in any of ${textual.length} text files of the public engine${hits.length ? ": " + hits.join(", ") : ""}`, hits.length === 0 && textual.length > 50);
ok("the engine folder holds no vault, state, log or job folder", !files.some((f) => /\/(state|jobs|persona|vault)\//.test(f) || /\.log$/.test(f)));
ok("no pdf in the engine folder except the test fixtures", files.filter((f) => f.endsWith(".pdf")).every((f) => f.includes("/tests/fixtures/")));
console.log(failures === 0 ? "\nall personal-data tests passed" : `\n${failures} personal-data test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
