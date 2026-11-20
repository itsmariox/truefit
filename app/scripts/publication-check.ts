// Lists every file that would be published and still holds a personal term (the owner's name, employers, places, figures): node scripts/publication-check.ts
// "Would be published" means what git would put in the repository: tracked files plus new files that are not ignored (so the local-only planning docs listed in .gitignore are skipped,
// and so are private/, node_modules and build output). Exit code 1 when something is found, so it can gate a release.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HAS_PERSONAL_LIST, PERSONAL } from "../../engine/tests/personal-terms.ts";
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
if (!HAS_PERSONAL_LIST) { console.error("private/personal-terms.local.ts is missing, so this check has nothing to look for and proves nothing. Not passing."); process.exit(2); }
const SKIP = /(^|\/)(node_modules|out|dist|\.git|private|state|jobs|voice)\//;
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: repo, maxBuffer: 64 * 1024 * 1024 }).toString().split("\0").filter(Boolean);
const re = new RegExp(PERSONAL.source, PERSONAL.flags.replace("g", "")), hits: string[] = [];
for (const f of files) {
  if (SKIP.test(f) || f.split("/").some((s) => s.startsWith(".")) || !/\.(ts|tsx|md|json|css|html|js|cjs|mjs|txt)$/.test(f) || /package-lock\.json$/.test(f) || !existsSync(path.join(repo, f))) continue;
  if (re.test(readFileSync(path.join(repo, f), "utf8")) || re.test(f)) hits.push(f);
}
console.log(hits.length ? `${hits.length} file(s) still hold personal terms:\n${hits.map((h) => "  " + h).join("\n")}` : "no personal terms found in the files that would be published");
process.exit(hits.length ? 1 : 0);
