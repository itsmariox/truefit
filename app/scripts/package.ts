// Builds a local, UNSIGNED app bundle (phase 4h):  node scripts/package.ts [--test]
//   release (default): the real app; nothing from the test hooks is in it (checked below)
//   --test:            the same plus the test hooks (a fake Claude, an overridable data folder), for the packaged smoke test only; never given to anyone
// Output: app/dist/release/Truefit-darwin-<arch>/Truefit.app or app/dist/test/... . Signing, the DMG and the "Open Anyway" guide belong to phase 10.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";
import { FuseV1Options, FuseVersion, flipFuses } from "@electron/fuses";
import * as asar from "@electron/asar";

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), engineDir = path.join(appDir, "..", "engine");
const test = process.argv.includes("--test"), variant = test ? "test" : "release", out = path.join(appDir, "dist", variant), stage = path.join(appDir, "dist", `stage-${variant}`);
const MARKER = "made by the test build"; // a string that exists only in the fake Claude

console.log(`building the ${variant} bundle…`);
execFileSync("npx", ["electron-vite", "build"], { cwd: appDir, stdio: "inherit", env: { ...process.env, CVAPP_TEST_BUILD: test ? "1" : "0" } });
rmSync(stage, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(stage, "engine", "assets"), { recursive: true });
cpSync(path.join(engineDir, "config.json"), path.join(stage, "engine", "config.json"));
cpSync(path.join(engineDir, "skills"), path.join(stage, "engine", "skills"), { recursive: true });
cpSync(path.join(engineDir, "assets", "fonts"), path.join(stage, "engine", "assets", "fonts"), { recursive: true });
cpSync(path.join(appDir, "voice"), path.join(stage, "voice"), { recursive: true }); // the speech model: outside the archive, because the speech runtime reads it as a real file

const [appPath] = await packager({
  dir: appDir, out, name: "Truefit", icon: path.join(appDir, "assets", "icon.icns"), platform: "darwin", arch: process.arch as "arm64" | "x64", overwrite: true, prune: true,
  appBundleId: "local.truefit.unsigned", appCategoryType: "public.app-category.productivity",
  asar: { unpack: "{**/node_modules/@anthropic-ai/claude-agent-sdk-*/**,**/node_modules/onnxruntime-node/**,**/node_modules/sharp/**,**/node_modules/@img/**}" }, // the Claude program and the speech runtime must be runnable files, so they stay outside the archive
  extraResource: [path.join(stage, "engine"), path.join(stage, "voice")],
  ignore: (p: string) => !(p === "" || /^\/(package\.json|out|assets|node_modules)(\/|$)/.test(p)) || /^\/node_modules\/onnxruntime-node\/bin\/napi-v6\/(?!darwin(\/arm64(\/|$)|$))/.test(p) || /^\/node_modules\/onnxruntime-web(\/|$)/.test(p), // speech runtime: only this Mac's binaries (the other systems' are ~200 MB), and the browser build is not used
  quiet: true,
});
const bundle = path.join(appPath, "Truefit.app");
// Hardening (release only): the app can no longer be run as a plain Node program, no Node debugging flags or NODE_OPTIONS, cookies are encrypted, and only the archive is loaded.
// The TEST bundle keeps the debugging switches because the Playwright tests need them; it is never given to anyone. Changing the binary breaks its signature, so it is re-signed ad hoc.
// Only English is shipped (the app is English only): the other 50+ language folders of Electron are removed to save space.
for (const dir of [path.join(bundle, "Contents", "Resources"), path.join(bundle, "Contents", "Frameworks", "Electron Framework.framework", "Resources")]) {
  if (existsSync(dir)) for (const n of readdirSync(dir)) if (n.endsWith(".lproj") && !["en.lproj", "en_GB.lproj", "Base.lproj"].includes(n)) rmSync(path.join(dir, n), { recursive: true, force: true });
}
if (test) execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", bundle], { stdio: "ignore" });
if (!test) {
  await flipFuses(path.join(bundle, "Contents", "MacOS", "Truefit"), { version: FuseVersion.V1, [FuseV1Options.RunAsNode]: false, [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, [FuseV1Options.EnableNodeCliInspectArguments]: false, [FuseV1Options.EnableCookieEncryption]: true, [FuseV1Options.OnlyLoadAppFromAsar]: true });
  execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", bundle], { stdio: "ignore" });
}
const resources = path.join(bundle, "Contents", "Resources");
const archive = path.join(resources, "app.asar");
const mainFiles = asar.listPackage(archive, { isPack: false }).filter((f) => /[\\/]out[\\/]main[\\/].*\.js$/.test(f)).map((f) => f.replace(/^[\\/]/, ""));
const hasFake = mainFiles.some((f) => asar.extractFile(archive, f).toString("utf8").includes(MARKER)); // the fake may be in a separate chunk
// Every module the main process loads at run time must be inside the archive. Modules named in OPTIONAL are loaded inside a try/catch by a library (checked by hand, see ISSUES.md).
const OPTIONAL = new Set(["@napi-rs/canvas"]);
const inArchive = new Set(asar.listPackage(archive, { isPack: false }).filter((f) => /node_modules[\\/].*package\.json$/.test(f)).map((f) => f.replace(/^.*node_modules[\\/]/, "").replace(/[\\/]package\.json$/, "").replace(/\\/g, "/")));
const wanted = new Set<string>();
for (const f of mainFiles) { const t = asar.extractFile(archive, f).toString("utf8"); for (const m of t.matchAll(/(?:^import[^"\n]*from\s*|^import\s*|require\()\s*\(?\s*"([^"]+)"/gm)) { const n = m[1]; if (!n.startsWith("node:") && !builtinModules.includes(n) && n !== "electron" && !n.startsWith(".")) wanted.add(n.startsWith("@") ? n.split("/").slice(0, 2).join("/") : n.split("/")[0]); } }
const missing = [...wanted].filter((n) => !inArchive.has(n) && !OPTIONAL.has(n));
if (missing.length) { console.error("MISSING FROM THE ARCHIVE (the packaged app would fail when it loads them): " + missing.join(", ")); process.exit(1); }
console.log(`run-time modules checked: ${[...wanted].join(", ")}${[...wanted].some((n) => OPTIONAL.has(n)) ? " (optional ones are allowed to be absent)" : ""}`);
const size = execFileSync("du", ["-sh", bundle]).toString().split("\t")[0];
const claude = path.join(resources, "app.asar.unpacked", "node_modules", "@anthropic-ai", `claude-agent-sdk-${process.platform}-${process.arch}`, "claude");
const voiceModel = path.join(resources, "voice", "models", "Xenova", "whisper-tiny.en", "onnx", "encoder_model_quantized.onnx"), ortBinding = path.join(resources, "app.asar.unpacked", "node_modules", "onnxruntime-node", "bin", "napi-v6", "darwin", "arm64", "onnxruntime_binding.node");
const voiceReady = existsSync(voiceModel) && existsSync(ortBinding) && inArchive.has("@huggingface/transformers"); if (!voiceReady) { console.error("THE SPEECH MODEL OR ITS RUNTIME IS MISSING FROM THE BUNDLE"); process.exit(1); }
writeFileSync(path.join(out, "build-info.json"), JSON.stringify({ variant, size, hasFake, claudeUnpacked: existsSync(claude), voiceReady }, null, 2));
console.log(`bundle: ${bundle}\nsize: ${size}\nfake Claude inside: ${hasFake}\nClaude program unpacked: ${existsSync(claude)}`);
if (!test && hasFake) { console.error("THE RELEASE BUILD CONTAINS THE TEST HOOKS"); process.exit(1); }
if (test && !hasFake) { console.error("the test build is missing the fake Claude"); process.exit(1); }
void readFileSync;
