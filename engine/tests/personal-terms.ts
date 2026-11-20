// The list of personal terms that must never appear in the public code. The real list lives in private/personal-terms.local.ts, which is never committed (private/ is in .gitignore),
// so that this file does not publish what it forbids. Without that file (a fresh clone) the list is empty and the checks that use it pass without checking anything:
// node app/scripts/publication-check.ts says so out loud, and fails, instead of passing quietly.
let parts: string[] = [];
const spec = "../../private/personal-terms.local.ts"; // a variable, so the type checker does not look for a file that is not in the repository
try { parts = ((await import(spec)) as { parts: string[] }).parts; } catch { /* no private list here */ }
export const HAS_PERSONAL_LIST = parts.length > 0;
const source = parts.length ? parts.join("|") : "(?!)"; // "(?!)" never matches
export const PERSONAL = new RegExp(source, "i");
export const PERSONAL_G = new RegExp(source, "gi");
