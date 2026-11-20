// Phase 4h: the PACKAGED test bundle (node scripts/package.ts --test), launched from the .app itself: the unpacked Claude program runs, the engine's files are found in Resources,
// a fake Claude (test build only) analyses an ad through the real window, and the app quits cleanly. Needs a screen. Run: npm run e2e:packaged
import { _electron as electron } from "playwright-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const wavPcm = (w: Buffer) => { let o = 12; while (o + 8 <= w.length) { const id = w.toString("ascii", o, o + 4), n = w.readUInt32LE(o + 4); if (id === "data") return w.subarray(o + 8, o + 8 + n); o += 8 + n + (n % 2); } throw new Error("no data chunk"); };
import { fileURLToPath } from "node:url";
const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), bundle = path.join(appDir, "dist", "test", `Truefit-darwin-${process.arch}`, "Truefit.app");
const exe = path.join(bundle, "Contents", "MacOS", "Truefit"), info = JSON.parse(readFileSync(path.join(appDir, "dist", "test", "build-info.json"), "utf8"));
// The guide has no skip: a test that is not about the guide marks it done through the real settings channel and reloads the page.
async function finishGuideForTest(page: any) { await page.evaluate(() => (window as any).cvapp.invoke("settings:set", { patch: { onboardingDone: true } })); await page.reload(); }
let failures = 0; const check = (n: string, c: boolean, extra = "") => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : "  " + extra)); };
const SERVICE = "CVAppPkg Safe Storage", has = () => { try { execFileSync("/usr/bin/security", ["find-generic-password", "-s", SERVICE], { stdio: "ignore" }); return true; } catch { return false; } };
if (!existsSync(exe)) { console.error("build the test bundle first: node scripts/package.ts --test"); process.exit(2); }
if (has()) { console.error("a leftover test Keychain item exists:  security delete-generic-password -s \"" + SERVICE + "\""); process.exit(2); }
const data = mkdtempSync(path.join(os.tmpdir(), "cvapp-pkg-")), claudeDir = mkdtempSync(path.join(os.tmpdir(), "cvapp-pkg-claude-"));
const env = { ...process.env, CVAPP_USER_DATA: data, CVAPP_APP_NAME: "CVAppPkg", CVAPP_CLAUDE_CONFIG_DIR: claudeDir, CVAPP_FAKE_CLAUDE: "1", CVAPP_TEST_PROFILE: path.join(appDir, "..", "engine", "tests", "fixtures", "profile-priya.json") } as Record<string, string>; delete env.ELECTRON_RUN_AS_NODE;
check("the test bundle holds the fake Claude and an UNPACKED Claude program; the release bundle (checked at build time) holds no test hooks", info.hasFake === true && info.claudeUnpacked === true);
const saveDir = mkdtempSync(path.join(os.tmpdir(), "cvapp-pkg-save-")); env.CVAPP_SAVE_DIR = saveDir; const cvDir = mkdtempSync(path.join(os.tmpdir(), "cvapp-pkg-cv-")), cvFile = path.join(cvDir, "cv.txt"); writeFileSync(cvFile, "Marketing Executive, Acme Retail, 2020 to now. Ran weekly email campaigns and reported in Google Analytics. Skills: email marketing, analytics, paid search. BA Marketing, 2019. ".repeat(3)); env.CVAPP_CV_FILE = cvFile; // tests only: "Save as ..." writes here instead of opening a dialog (ignored by a release app)
const app = await electron.launch({ executablePath: exe, args: [], env, timeout: 90000 });
try {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-testid="onboarding"]', { timeout: 60000 });
  await page.click('[data-testid="ob-next"]'); await page.click('[data-testid="ob-next"]'); await page.waitForSelector('[data-testid="connect"]', { timeout: 30000 }); // through the guide to its Connect step
  check("the packaged app starts from the bundle, shows the first-run guide, and its third step is the Connect screen", (await page.title()) === "Truefit" && /Choose how to connect/.test(await page.textContent('[data-testid="banner"]') ?? ""));
  await page.click('text="Use my Claude subscription"'); await page.check('input[type="checkbox"]'); await page.click('text="Continue"');
  await page.waitForSelector('[data-message="state.not_connected.subscription"]', { timeout: 60000 });
  check("the REAL Claude program, run from inside the bundle (unpacked), answers the login check: 'not signed in' in the empty test login folder", true);
  await page.click('text="Use an API key instead"'); await page.fill('#api-key', "sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE-FAKE"); await page.click('text="Save and test"');
  await page.waitForSelector('[data-testid="ob-connected"]', { timeout: 30000 });
  check("a (fake) API key is accepted by the test build's fake Claude and saved through the real safeStorage; the guide says Claude is connected", has());
  await page.click('[data-testid="ob-next"]'); await page.click('[data-testid="ob-cv"]'); await page.click('[data-testid="cv-choose"]'); await page.waitForSelector('[data-testid="main"]', { timeout: 60000 }); // last step: import the CV, which finishes the guide and lands on Home
  check("importing the CV finishes the guide and lands on Home and the status line says connected", /Claude is connected/.test(await page.textContent('[data-testid="status-line"]') ?? ""));
  await page.click('button[aria-label="New job"]');
  await page.fill("#ad-input", "A marketing role at a fictional shop, weekly emails and reporting in Google Analytics. ".repeat(6)); await page.click('button[aria-label="Analyse this job"]');
  await page.waitForSelector('[data-testid="verdict"]', { timeout: 60000 });
  const card = await page.textContent('[data-testid="verdict"]');
  check("an ad pasted in the packaged window is analysed (by the fake) through the real engine, queue and pipeline: the verdict card shows Apply and fit 71%", /Apply/.test(card ?? "") && /Fit 71%/.test(card ?? ""), card ?? "");
  await page.click('[data-testid="build"]'); await page.waitForSelector('[data-testid="built"]', { timeout: 120000 });
  const jobsDir = path.join(data, "data", "jobs"), folder = readdirSync(jobsDir)[0], pdfFile = path.join(jobsDir, folder, "cv.pdf"), pdf = existsSync(pdfFile) ? readFileSync(pdfFile) : Buffer.alloc(0);
  check("Build CV in the packaged window: the REAL Electron renderer (hidden window, printToPDF) makes a valid PDF that passes the engine's fit and ATS checks, and the page says 'Your CV is ready'", pdf.subarray(0, 5).toString() === "%PDF-" && pdf.length > 5000 && /Your CV is ready/.test(await page.textContent('[data-testid="built"]') ?? ""), String(pdf.length));
  await page.click('text="Cover note"'); await page.waitForSelector('[data-testid="extra"]', { timeout: 60000 });
  check("a cover note is written on request and shown", /Cover note/.test(await page.textContent('[data-testid="extra"]') ?? ""));
  // ---- layout and export checks on the real window (added 2026-11-18) ----
  const overflows = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll(".main *")].some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(e).position !== "fixed"; }));
  for (const [w, h] of [[1180, 760], [820, 560]] as const) {
    await app.evaluate(({ BrowserWindow }, a) => { BrowserWindow.getAllWindows()[0].setSize(a.w, a.h); }, { w, h }); await page.waitForTimeout(400);
    check(`the job page (built CV, verdict, extras) at ${w} wide: nothing runs past the right edge and there is no sideways scroll`, !(await overflows()));
  }
  await page.click('[data-testid="extra"] >> text="Edit"'); await page.fill('[data-testid="extra"] textarea', "Dear team, <b>my own words</b> & more.\n\nSecond paragraph.");
  check("with an extra in edit mode the page still fits at 820 wide", !(await overflows()));
  await page.click('[data-testid="extra-save"]'); await page.waitForTimeout(500); await page.click('[data-testid="extra-save-docx"]'); await page.waitForTimeout(500); await page.click('[data-testid="extra-save-pdf"]'); await page.waitForSelector('text="Saved."', { timeout: 30000 }); await page.waitForTimeout(800);
  const saved = readdirSync(saveDir), pick = (ext: string) => saved.find((f) => f.endsWith(ext)) ?? "";
  check("Save as text, Word and PDF each wrote a file named after the extra and the job, with the right extension, into the test folder", saved.length === 3 && !!pick(".txt") && !!pick(".docx") && !!pick(".pdf") && saved.every((f) => /^Cover note/.test(f) && !/[/:]/.test(f)), saved.join(" | "));
  const docxPath = path.join(saveDir, pick(".docx")), pdfPath = path.join(saveDir, pick(".pdf"));
  const back = (() => { try { return execFileSync("/usr/bin/textutil", ["-convert", "txt", "-stdout", docxPath], { encoding: "utf8" }); } catch { return ""; } })();
  check("the Word file is a real .docx (macOS reads it) holding the EDITED text with its < and & intact", back.includes("<b>my own words</b> & more") && back.includes("Second paragraph."));
  const pdfBytes = existsSync(pdfPath) ? readFileSync(pdfPath) : Buffer.alloc(0), pageObjs = (pdfBytes.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
  check("the PDF was printed by the REAL hidden window: a valid PDF with at least one page, no script in it", pdfBytes.subarray(0, 5).toString() === "%PDF-" && pdfBytes.length > 1500 && !/<script/i.test(pdfBytes.toString("latin1")) && pageObjs >= 1, `pages ${pageObjs}, ${pdfBytes.length} bytes`);
  await page.waitForSelector('[data-testid="toast"]', { state: "detached", timeout: 25000 }); // the banners leave by themselves after 10 seconds: nothing covers the Settings switches
  check("the banners (job analysed, CV ready) disappear on their own, so they do not sit over the page controls", (await page.locator('[data-testid="toast"]').count()) === 0);
  { // voice: the REAL bundled speech model, run by the packaged app's own runtime, hears speech made by macOS `say` (no microphone is needed: the audio goes through the same channel the page uses)
    check("the bundle carries the speech model and the speech runtime (build-info says so)", info.voiceReady === true);
    const vdir = mkdtempSync(path.join(os.tmpdir(), "cvapp-pkgvoice-"));
    try {
      execFileSync("say", ["-v", "Samantha", "-o", path.join(vdir, "a.aiff"), "I was a marketing executive at Acme Retail. I cut the weekly report time from four hours to two."]); execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", path.join(vdir, "a.aiff"), path.join(vdir, "a.wav")]);
      const b64 = wavPcm(readFileSync(path.join(vdir, "a.wav"))).toString("base64");
      const t0 = Date.now(), r = await page.evaluate((audio: string) => (window as any).cvapp.invoke("voice:transcribe", { audio }), b64);
      check("the packaged app turns speech into text on this Mac, offline: marketing, executive, report and hours come out", r.ok && r.data.status === "ok" && /marketing/i.test(r.data.text) && /executive/i.test(r.data.text) && /report/i.test(r.data.text) && /hours/i.test(r.data.text), JSON.stringify(r)); console.log("  heard:", r.ok ? r.data.text : r, `(${Date.now() - t0} ms)`);
      const q = await page.evaluate(() => (window as any).cvapp.invoke("voice:transcribe", { audio: btoa(String.fromCharCode(...new Uint8Array(32000))) }));
      check("a silent recording is refused as quiet by the packaged app", q.ok && q.data.status === "refused" && q.data.reason === "quiet", JSON.stringify(q));
    } finally { rmSync(vdir, { recursive: true, force: true }); }
  }
  await page.click('button[aria-label="Settings"]'); await page.click('.set-nav-item:has-text("Notifications")'); await page.waitForSelector("#n1");
  const y0 = (await page.locator("#n1").boundingBox())!.y, h0 = await page.evaluate(() => document.querySelector(".main")!.scrollHeight);
  await page.click("label[for=n1]"); await page.waitForSelector('[data-testid="settings-msg"]'); await page.waitForTimeout(250);
  const y1 = (await page.locator("#n1").boundingBox())!.y, h1 = await page.evaluate(() => document.querySelector(".main")!.scrollHeight);
  check('changing a setting shows "Saved." WITHOUT moving anything: the switch and the page height stay put (within 1 px)', Math.abs(y1 - y0) <= 1 && Math.abs(h1 - h0) <= 1, `switch ${y0} -> ${y1}, page ${h0} -> ${h1}`);
  const hook = await app.evaluate(() => typeof (globalThis as any).__cvappCore);
  check("the development hook that exposes the core to tests does not exist in a packaged app", hook === "undefined");
  const exited = new Promise<number | null>((res) => { const p = app.process(); if (p.exitCode !== null) res(p.exitCode); else p.on("exit", (c) => res(c)); });
  void app.evaluate(({ app: a }) => a.quit()).catch(() => undefined);
  const code = await Promise.race([exited, new Promise<string>((r) => setTimeout(() => r("timeout"), 20000))]);
  check("quitting the packaged app ends it cleanly", code === 0 || code === null, String(code));
} finally {
  await app.close().catch(() => undefined);
  if (has()) { try { execFileSync("/usr/bin/security", ["delete-generic-password", "-s", SERVICE], { stdio: "ignore" }); } catch { /* nothing */ } }
  rmSync(data, { recursive: true, force: true }); rmSync(claudeDir, { recursive: true, force: true }); rmSync(saveDir, { recursive: true, force: true });
}

// ---- second launch: NO fake. The real SDK must start the real Claude program from inside the bundle; with an empty login folder it fails before any model work, so the job must PAUSE (free) ----
{
  const data2 = mkdtempSync(path.join(os.tmpdir(), "cvapp-pkg2-")), claude2 = mkdtempSync(path.join(os.tmpdir(), "cvapp-pkg2-claude-")); const env2 = { ...env, CVAPP_USER_DATA: data2, CVAPP_CLAUDE_CONFIG_DIR: claude2 } as Record<string, string>; delete env2.CVAPP_FAKE_CLAUDE;
  const app2 = await electron.launch({ executablePath: exe, args: [], env: env2, timeout: 90000 });
  try {
    const page = await app2.firstWindow(); await page.waitForSelector('[data-testid="onboarding"]', { timeout: 60000 }); await finishGuideForTest(page); await page.waitForSelector('[data-testid="connect"]', { timeout: 60000 });
    const r = await page.evaluate(async () => {
      const b = (window as any).cvapp; await b.invoke("access:chooseMode", { mode: "subscription" }); await b.invoke("access:acceptNotice");
      const c = await b.invoke("jobs:create", { text: "A marketing role at a fictional shop, weekly emails and reporting. ".repeat(8) }); const id = c.data.job.id; await b.invoke("jobs:analyse", { id });
      let d: any = null; for (let i = 0; i < 150; i++) { d = (await b.invoke("jobs:get", { id })).data; if (d.status === "paused" || d.status === "analysed" || d.status === "failed") break; await new Promise((x) => setTimeout(x, 200)); }
      return { status: d.status, pause: d.pause?.title ?? null };
    });
    check("with NO fake, the real SDK starts the real Claude program from inside the bundle (no login, so it fails before any model work, free): the job PAUSES with the sign-in message", r.status === "paused" && r.pause === "Claude needs you to sign in again", JSON.stringify(r));
  } finally { await app2.close().catch(() => undefined); rmSync(data2, { recursive: true, force: true }); rmSync(claude2, { recursive: true, force: true }); }
}
console.log(failures === 0 ? "\nall packaged tests passed" : `\n${failures} packaged test(s) FAILED`); process.exit(failures === 0 ? 0 : 1);
