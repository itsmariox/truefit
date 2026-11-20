// Starts the RELEASE bundle (fuses flipped) for a few seconds with a throwaway HOME, so it never touches the real data, and checks it stays up and prints no crash. Run after `npm run package`.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), exe = path.join(appDir, "dist", "release", `Truefit-darwin-${process.arch}`, "Truefit.app", "Contents", "MacOS", "Truefit");
if (!existsSync(exe)) { console.error("build the release first: npm run package"); process.exit(2); }
const home = mkdtempSync(path.join(os.tmpdir(), "cvapp-rel-")); let out = "";
const env = { ...process.env, HOME: home, TMPDIR: home + "/" } as Record<string, string>; // a throwaway HOME and TMPDIR: the one-copy rule must not see a copy the developer already has open delete env.ELECTRON_RUN_AS_NODE;
const p = spawn(exe, [`--user-data-dir=${path.join(home, "userdata")}`], { env, stdio: ["ignore", "pipe", "pipe"] }); p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
let exited: number | null = null; p.on("exit", (c) => { exited = c ?? -1; });
await new Promise((r) => setTimeout(r, 10000));
const alive = exited === null; if (alive) p.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 1500)); if (exited === null) p.kill("SIGKILL");
rmSync(home, { recursive: true, force: true });
console.log(`   alive after 10 s: ${alive}; exit code: ${exited}`);
const crashed = /App threw an error|Uncaught|FATAL/.test(out) || out.split("\n").some((l) => /Cannot find module/.test(l) && !/@napi-rs\/canvas/.test(l)); // the canvas warning is pdf.js trying an optional module (known, harmless)
console.log((alive && !crashed ? "PASS " : "FAIL ") + "the release bundle (fuses flipped) starts and keeps running for 10 s without a crash" + (alive && !crashed ? "" : `\n${out.slice(0, 800)}`));
process.exit(alive && !crashed ? 0 : 1);
