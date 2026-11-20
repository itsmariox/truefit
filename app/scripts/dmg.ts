// Makes an UNSIGNED disk image of the release app (phase 10 preparation): node scripts/dmg.ts  ->  app/dist/Truefit-<version>-unsigned.dmg. Signing and notarising are separate steps (docs/RELEASE-CHECKLIST.md).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, cpSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), bundle = path.join(appDir, "dist", "release", `Truefit-darwin-${process.arch}`, "Truefit.app");
if (!existsSync(bundle)) { console.error("build the release first: npm run package"); process.exit(2); }
const version = JSON.parse(readFileSync(path.join(appDir, "package.json"), "utf8")).version as string, out = path.join(appDir, "dist", `Truefit-${version}-unsigned.dmg`);
const stage = mkdtempSync(path.join(os.tmpdir(), "cvapp-dmg-"));
try {
  cpSync(bundle, path.join(stage, "Truefit.app"), { recursive: true, verbatimSymlinks: true }); symlinkSync("/Applications", path.join(stage, "Applications"));
  rmSync(out, { force: true });
  execFileSync("/usr/bin/hdiutil", ["create", "-volname", "Truefit", "-srcfolder", stage, "-ov", "-format", "UDZO", out], { stdio: "inherit" });
  console.log(`made ${out}`);
} finally { rmSync(stage, { recursive: true, force: true }); }
