// Offline tests for the engine settings (config.json): valid defaults, strict validation, and nothing personal in it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { loadConfig, parseConfig } = await import("../src/config.ts");
let failures = 0;
const ok = (name: string, cond: boolean) => { if (!cond) failures++; console.log((cond ? "PASS " : "FAIL ") + name); };
const raw = JSON.parse(readFileSync(path.join(dir, "..", "config.json"), "utf8"));
const c = await loadConfig();
ok("config: the shipped config.json loads with the documented defaults (choose-and-order Writer, friendly tone, Oxford blue, snapshot resume, one model for all four agents)", c.writerMode === "choose-and-order" && c.tone === "friendly" && c.accent === "oxford" && c.resumeProfile === "snapshot" && new Set(Object.values(c.models)).size === 1 && c.agentTimeoutSeconds === 300 && c.showRightToWork === true);
const throws = (patch: object) => { try { parseConfig({ ...raw, ...patch }); return false; } catch (e) { return /^config: /.test((e as Error).message); } };
ok("config: wrong values are refused with a clear message (a bad mode, tone, accent, resume setting, timeout, missing model)", throws({ writerMode: "free" }) && parseConfig({ ...raw, writerMode: "reword" }).writerMode === "reword" && throws({ tone: "grumpy" }) && throws({ accent: "pink" }) && throws({ accent: "constructor" }) && throws({ resumeProfile: "never" }) && throws({ agentTimeoutSeconds: 0 }) && throws({ models: { analyst: "x" } }) && throws({ showRightToWork: "yes" }));
ok("config: nothing personal is stored in it any more: no salary floor and no claimed-years figure (they come from the profile)", !("salaryFloorGBP" in raw) && !("maxClaimedYears" in raw) && !/£/.test(JSON.stringify(raw)));
console.log(failures === 0 ? "\nall config tests passed" : `\n${failures} config test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
