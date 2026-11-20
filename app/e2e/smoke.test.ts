// Phase 4c: the REAL app in a REAL Electron, driven from outside (Playwright's Electron support). Needs the build (`npm run e2e` builds first) and a screen (a window opens briefly).
// It checks the promises that only a real window can show: the bridge works, the page has no Node, nothing leaves the page, a close hides the window, a second copy exits.
import { _electron as electron } from "playwright-core";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), exe = path.join(appDir, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
// The guide has no skip: a test that is not about the guide marks it done through the real settings channel and reloads the page.
async function finishGuideForTest(page: any) { await page.evaluate(() => (window as any).cvapp.invoke("settings:set", { patch: { onboardingDone: true } })); await page.reload(); }
let failures = 0;
const check = (n: string, c: boolean, extra = "") => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  " + extra)); };
const data = mkdtempSync(path.join(os.tmpdir(), "cvapp-e2e-")), claudeDir = mkdtempSync(path.join(os.tmpdir(), "cvapp-e2e-claude-")); // an EMPTY Claude login folder: the test never touches the real login
const SERVICE = "CVAppE2E Safe Storage"; // a test-only app name: the test never touches the real "Truefit Safe Storage" Keychain item
const keychainHas = () => { try { execFileSync("/usr/bin/security", ["find-generic-password", "-s", SERVICE], { stdio: "ignore" }); return true; } catch { return false; } };
if (keychainHas()) { console.log("a leftover test Keychain item exists; remove it first:  security delete-generic-password -s \"" + SERVICE + "\""); process.exit(2); }
const env = { ...process.env, CVAPP_USER_DATA: data, CVAPP_APP_NAME: "CVAppE2E", CVAPP_CLAUDE_CONFIG_DIR: claudeDir, ELECTRON_RUN_AS_NODE: "" } as Record<string, string>; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: exe, args: [appDir], env, timeout: 60000 });
const mainOut: string[] = []; app.process().stdout?.on("data", (d) => mainOut.push(String(d))); app.process().stderr?.on("data", (d) => mainOut.push(String(d)));
try {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="onboarding"]', { timeout: 30000 });
  check("a first launch shows the first-run guide (the promise, a sample verdict ring) and not the app", /Know if a job is worth it before you apply/.test(await page.textContent('[data-testid="onboarding"]') ?? "") && (await page.locator('[data-testid="fit-ring"]').count()) === 1 && (await page.locator('nav[aria-label="Pages"]').count()) === 0);
  await finishGuideForTest(page); await page.waitForSelector('[data-testid="connect"]', { timeout: 30000 });
  check("the app starts and the window shows the Connect screen with the approved first message (nothing chosen yet), from the REAL main process", (await page.title()) === "Truefit" && /Choose how to connect to Claude/.test(await page.textContent('[data-testid="banner"]') ?? "") && /Claude is not connected/.test(await page.textContent('[data-testid="status-line"]') ?? ""));
  await page.click('text="Use my Claude subscription"'); await page.waitForSelector('[data-testid="notice"]');
  const disabledBefore = await page.isDisabled('text="Continue"'); await page.check('input[type="checkbox"]'); await page.click('text="Continue"');
  await page.waitForSelector('[data-message="state.not_connected.subscription"]', { timeout: 30000 });
  check("the real flow works end to end: choosing the subscription shows the notice (Continue disabled until ticked); after the tick the REAL Claude program reports no login in the empty test folder and the page shows 'You're not signed in to Claude'", disabledBefore === true && /You're not signed in to Claude/.test(await page.textContent('[data-testid="banner"]') ?? ""));
  const probe = await page.evaluate(async () => {
    const b = (window as any).cvapp;
    return {
      noRequire: typeof (window as any).require === "undefined" && typeof (globalThis as any).require === "undefined", noProcess: typeof (window as any).process === "undefined", noModule: typeof (window as any).module === "undefined", noElectron: typeof (window as any).electron === "undefined" && typeof (window as any).ipcRenderer === "undefined",
      bridgeKeys: Object.keys(b ?? {}).sort().join(), frozen: Object.isFrozen(b),
      unknownChannel: await b.invoke("app:nope"), badRequest: await b.invoke("app:openLink", { url: "x" }), extraField: await b.invoke("app:openLink", { url: "https://evil.example/", admin: true }), evilLink: await b.invoke("app:openLink", { url: "https://evil.example/phish" }),
      info: await b.invoke("app:info"),
    };
  });
  check("the page has NO Node: no require, process, module, electron or ipcRenderer; the only thing it has is a frozen `cvapp` with `invoke` and `on`", probe.noRequire && probe.noProcess && probe.noModule && probe.noElectron && probe.bridgeKeys === "invoke,on" && probe.frozen);
  check("through the bridge: an unknown channel is forbidden, a malformed request is refused, an unknown extra field is refused, a link to another site is NOT opened, and a real call answers", !probe.unknownChannel.ok && probe.unknownChannel.error.code === "forbidden" && probe.badRequest.error.code === "invalid_request" && probe.extraField.error.code === "invalid_request" && probe.evilLink.ok && probe.evilLink.data.opened === false && probe.info.ok && probe.info.data.name === "Truefit");
  // ---- the app core, started by the real main process (4d) ----
  const started0 = await app.evaluate(async () => { for (let i = 0; i < 100 && !(globalThis as any).__cvappCore; i++) await new Promise((r) => setTimeout(r, 100)); const c = (globalThis as any).__cvappCore; return c ? { ok: true, state: (await c.access.state()).kind, queue: c.queue.snapshot().entries.length } : { ok: false }; });
  check("the main process starts the app core: the data folder and database are created in the app's own data folder and the access state follows what the page just did (subscription chosen, no login: 'not_connected')", started0.ok === true && existsSync(path.join(data, "data", "app.db")) && started0.state === "not_connected" && started0.queue === 0, JSON.stringify({ mainOut: mainOut.join("").slice(0, 600), started0, files: existsSync(path.join(data, "data")) ? readdirSync(path.join(data, "data")) : [] }));
  // ---- jobs (4f): a fictional profile, a real job through the real bridge; the real Claude program has NO login here, so the job must PAUSE (no model work, no quota) ----
  const profileJson = readFileSync(path.join(appDir, "..", "engine", "tests", "fixtures", "profile-priya.json"), "utf8");
  await app.evaluate(({}, json) => { (globalThis as any).__cvappCore.profile.save(JSON.parse(json)); }, profileJson);
  const flow = await page.evaluate(async () => {
    const b = (window as any).cvapp; const c = await b.invoke("jobs:create", { text: "A marketing role at a fictional shop, weekly emails and reporting. ".repeat(8) });
    const id = c.data.job.id; const a = await b.invoke("jobs:analyse", { id }); let d: any = null;
    for (let i = 0; i < 100; i++) { d = (await b.invoke("jobs:get", { id })).data; if (d.status === "paused" || d.status === "analysed" || d.status === "failed") break; await new Promise((r) => setTimeout(r, 200)); }
    return { outcome: c.data.outcome, queued: a.data.queued, status: d.status, pause: d.pause?.title ?? null, resume: (d.pause?.actions ?? []).map((x: any) => x.label), json: JSON.stringify(d) };
  });
  check("a job made through the real bridge is analysed by the REAL runner: with no Claude login it PAUSES with the approved sign-in message and a Resume button (nothing sent, nothing spent), and no folder path reaches the page", flow.outcome === "created" && flow.queued === true && flow.status === "paused" && flow.pause === "Claude needs you to sign in again" && flow.resume.includes("Resume") && !flow.json.includes(data), JSON.stringify(flow).slice(0, 400));
  // ---- notifications (4g): the paused job above must show up in the Dock badge, the in-app banner and the menu-bar state ----
  const badge = await app.evaluate(async ({ app: a }) => { for (let i = 0; i < 50 && a.dock?.getBadge() !== "1"; i++) await new Promise((r) => setTimeout(r, 100)); return a.dock?.getBadge() ?? null; });
  await page.waitForSelector('[data-testid="toast"]', { timeout: 10000 });
  const toast = await page.textContent('[data-testid="toast"]');
  check("the paused job shows in the real Dock badge ('1'), as an in-app banner with an Open button, nothing crashes without macOS notifications", badge === "1" && /A job is paused/.test(toast ?? "") && (await page.isVisible('text="Open"')), JSON.stringify({ badge, toast }));
  const round = await app.evaluate(async ({ safeStorage }) => { const okAsync = await safeStorage.isAsyncEncryptionAvailable(); const blob = await safeStorage.encryptStringAsync("sk-ant-FAKE-e2e-roundtrip"); const back = await safeStorage.decryptStringAsync(blob); return { okAsync, plainOnDisk: blob.toString("latin1").includes("FAKE-e2e"), back: back.result }; });
  check("the REAL safeStorage (async) encrypts and decrypts a fake key, and what it produces holds no plain text", round.okAsync && !round.plainOnDisk && round.back === "sk-ant-FAKE-e2e-roundtrip");
  check("the key's Keychain item exists under the test-only name", keychainHas());
  await app.evaluate(({ BrowserWindow }) => { const wc = BrowserWindow.getAllWindows()[0].webContents; (globalThis as any).__navs = []; wc.on("will-navigate", (e, url) => { (globalThis as any).__navs.push({ url, cancelled: e.defaultPrevented }); }); }); // runs AFTER the app's own guard: records whether the guard cancelled the navigation
  const escape = await page.evaluate(async () => {
    const start = location.href;
    const fetched = await fetch("https://example.com/").then(() => "reached").catch(() => "blocked");
    const s = document.createElement("script"); s.textContent = "window.__inline = 1"; document.body.appendChild(s);
    const popup = window.open("https://example.com/");
    const st = document.createElement("style"); st.textContent = "body{outline:1px solid red}"; document.head.appendChild(st);
    location.href = "https://example.com/"; await new Promise((r) => setTimeout(r, 1200));
    return { fetched, inlineRan: (window as any).__inline === 1, popupOpened: popup !== null, stayed: location.href === start };
  }).catch(() => ({ fetched: "?", inlineRan: false, popupOpened: false, stayed: false })); // an error here means the page really navigated away (its script context was destroyed): reported as a failure below
  const started = await app.evaluate(() => (globalThis as any).__navs as { url: string; cancelled: boolean }[]);
  console.log("info: navigations seen by the main process:", JSON.stringify(started));
  check("the page cannot reach out: a network request is blocked by the content policy, an inline script does not run, a pop-up is not opened, a navigation to another site is CANCELLED by the app's guard (the main process saw it requested and cancelled) and the page stays where it is", escape.fetched === "blocked" && !escape.inlineRan && !escape.popupOpened && escape.stayed && started.length === 1 && started[0].cancelled === true, JSON.stringify({ escape, started }));
  check("no extra window was created by any of that", app.windows().length === 1);
  const hidden = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.close(); return { visible: w.isVisible(), destroyed: w.isDestroyed(), count: BrowserWindow.getAllWindows().length }; });
  check("closing the window HIDES it: the window still exists and the app keeps running (a menu-bar app)", hidden.visible === false && hidden.destroyed === false && hidden.count === 1 && app.process().exitCode === null);
  const second = spawn(exe, [appDir], { env, stdio: "ignore" });
  const code = await new Promise<number | null>((res) => { const t = setTimeout(() => { second.kill("SIGKILL"); res(-1); }, 15000); second.on("exit", (c) => { clearTimeout(t); res(c); }); });
  second.kill("SIGKILL"); // never leave a stray copy behind, whatever happened
  const shown = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
  check("a SECOND copy of the app exits by itself (exit code 0) and the running copy brings its window back", code === 0 && shown === true && app.process().exitCode === null, `code ${code} visible ${shown}`);
  const wiped = await app.evaluate(async () => { const c = (globalThis as any).__cvappCore; const r = await c.deleteEverything(true); return { ok: r.ok, warnings: r.warnings }; });
  check("'delete everything' on the real app removes the data folder contents and the test Keychain item (the real remover, the real `security` tool), with no warnings", wiped.ok === true && wiped.warnings.length === 0 && !keychainHas() && !existsSync(path.join(data, "data", "app.db")), JSON.stringify({ wiped, left: existsSync(path.join(data, "data")) ? readdirSync(path.join(data, "data")) : [] }));
} finally {
  const exited = new Promise<number | null>((res) => { const p = app.process(); if (p.exitCode !== null) res(p.exitCode); else p.on("exit", (c) => res(c)); });
  void app.evaluate(({ app: a }) => a.quit()).catch(() => undefined);
  const code = await Promise.race([exited, new Promise<string>((r) => setTimeout(() => r("timeout"), 15000))]);
  check("quitting (the app's Quit) ends the app cleanly", code === 0 || code === null, String(code));
  await app.close().catch(() => undefined);
  if (keychainHas()) { try { execFileSync("/usr/bin/security", ["delete-generic-password", "-s", SERVICE], { stdio: "ignore" }); } catch { /* nothing to remove */ } } // never leave the test item behind
  rmSync(data, { recursive: true, force: true }); rmSync(claudeDir, { recursive: true, force: true });
}
console.log(failures === 0 ? "\nall smoke tests passed" : `\n${failures} smoke test(s) FAILED`); process.exit(failures === 0 ? 0 : 1);
