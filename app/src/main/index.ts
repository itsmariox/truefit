// The app's main process: wiring only. The logic lives in small modules that are tested without Electron (security, ipc, lifecycle, core/*).
// NOTE (found in the 4a spike): never write `await app.whenReady()` at the top level of this file: in an ES-module main it never returns. Use the callback form below.
import "./quiet.ts";
import { app, BrowserWindow, dialog, Menu, Tray, ipcMain, nativeImage, nativeTheme, clipboard, powerMonitor, safeStorage, session, shell, systemPreferences } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME, type AppInfo, type EventName, type EventMap } from "../shared/contract.ts";
import { registerIpc, type Handlers } from "./ipc.ts";
import { createLifecycle } from "./lifecycle.ts";
import { startApp, type AppCore } from "./core/app-core.ts";
import { createHost } from "./core/host.ts";
import { createCoreHandlers } from "./handlers.ts";
import { createTelegramHandlers } from "./telegram-handlers.ts";
import { createDataHandlers } from "./data-handlers.ts";
import { createProfileHandlers } from "./profile-handlers.ts";
import { createJobsHandlers, toRow } from "./jobs-handlers.ts";
import { ElectronPdfRenderer } from "./core/electron-pdf.ts";
import { createNotifier } from "./core/notifier.ts";
import { fetchJobAd } from "../../../engine/src/fetchlink.ts";
import { realDeps } from "./core/boot.ts";
import { createVoice, whisperTranscriber } from "./voice.ts";
import { createVoiceHandlers } from "./voice-handlers.ts";
import { csp, navigationAllowed, openLinkDecision, permissionAllowed, printRequestAllowed, printWindowOptions, trustedSender, windowOptions } from "./security.ts";

// `__TEST_BUILD__` is true only in the packaged TEST build (scripts/package.ts); in a release build the bundler removes everything behind it.
declare const __TEST_BUILD__: boolean;
const TEST_BUILD: boolean = __TEST_BUILD__;
const OVERRIDES = !app.isPackaged || TEST_BUILD; // tests only: a separate data folder, app name and Claude login folder
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined; // the development server, never set in a packaged app
const APP_URL = DEV_URL ?? new URL(`file://${path.join(HERE, "../renderer/index.html")}`).href;
let win: BrowserWindow | null = null, tray: Tray | null = null;

// Tests only (ignored in a packaged app): a different app name gives a different Keychain item ("<name> Safe Storage"), so a test never touches the real one.
app.setName(OVERRIDES && process.env.CVAPP_APP_NAME ? process.env.CVAPP_APP_NAME : APP_NAME);
nativeTheme.themeSource = "light"; // light until the stored choice is known (the "appearance" setting, owner's decision 2026-11-20: light by default, dark or follow the Mac on request); applied again when the core is ready and whenever it changes
const setAppearance = (v: string) => { if (v === "light" || v === "dark" || v === "system") nativeTheme.themeSource = v; };
if (OVERRIDES && process.env.CVAPP_USER_DATA) app.setPath("userData", process.env.CVAPP_USER_DATA); // tests only: ignored in a packaged app
const log = (line: string) => { if (!app.isPackaged) console.log(`[main] ${line}`); }; // never logs ad text, keys or paths; nothing is written to disk

const life = createLifecycle({ app: app as never, getWindow: () => win as never, log, onVisibility: (visible) => push("app:visibility", { visible }) });
function push<E extends EventName>(event: E, payload: EventMap[E]) { if (win && !win.isDestroyed()) win.webContents.send(event, payload); }

function createWindow() {
  win = new BrowserWindow(windowOptions(path.join(HERE, "../preload/index.cjs"), { devTools: !app.isPackaged }));
  life.attachWindow(win as never);
  void (DEV_URL ? win.loadURL(DEV_URL) : win.loadFile(path.join(HERE, "../renderer/index.html")));
  win.once("ready-to-show", () => { /* shown when the page says it is ready (app:ready) */ });
}

let trayState = { text: "Idle", title: "" };
const refreshTrayMenu = () => { if (tray) { tray.setContextMenu(Menu.buildFromTemplate([{ label: trayState.text, enabled: false }, { type: "separator" }, ...life.trayMenu()])); tray.setTitle(trayState.title); tray.setToolTip(`${APP_NAME}: ${trayState.text}`); } };
let pdfRenderer: ElectronPdfRenderer | null = null; // the same hidden print window also writes "Save as PDF" for extras
const noticesFile = () => path.join(app.getPath("userData"), "data", "notices.json");
const KINDS = new Set(["analysed", "built", "needs_input", "paused", "failed"]);
const noticeStorage = {
  read: () => { try { const a = JSON.parse(readFileSync(noticesFile(), "utf8")); return Array.isArray(a) ? a.filter((b) => b && typeof b.id === "string" && typeof b.jobId === "string" && KINDS.has(b.kind) && typeof b.title === "string" && typeof b.body === "string" && typeof b.at === "string").slice(0, 8) : []; } catch { return []; } },
  write: (list: unknown[]) => { try { mkdirSync(path.dirname(noticesFile()), { recursive: true, mode: 0o700 }); writeFileSync(noticesFile(), JSON.stringify(list), { mode: 0o600 }); } catch { /* ignore */ } },
};
const notifier = createNotifier({
  storage: noticeStorage as never,
  settings: () => host.core()!.settings.get().settings,
  windowVisible: () => !!win && !win.isDestroyed() && win.isVisible() && win.isFocused(),
  push: (n) => push("app:notice", n),
  tray: (state, needs, working) => { trayState = state === "needs_you" ? { text: needs === 1 ? "1 job needs you" : `${needs} jobs need you`, title: ` ${needs}` } : state === "working" ? { text: working === 1 ? "Working on 1 job" : `Working on ${working} jobs`, title: " …" } : { text: "Idle", title: "" }; refreshTrayMenu(); },
  dock: { bounce: () => { try { app.dock?.bounce("informational"); } catch { /* no Dock in some sessions */ } }, badge: (t) => { try { app.dock?.setBadge(t); } catch { /* ignore */ } } },
});

function createTray() {
  // A small template image (black with transparency) that macOS tints for light and dark menu bars.
  const img = nativeImage.createFromPath(path.join(HERE, "../../assets/trayTemplate.png")); img.setTemplateImage(true);
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img); tray.setToolTip(APP_NAME); if (img.isEmpty()) tray.setTitle("CV");
  refreshTrayMenu();
}

// The host starts the app core and answers "did it start?" for the page; the handlers (handlers.ts) build the approved wording. Development only: the core is shown to tests.
const host = createHost({
  log,
  start: async () => {
    // Packaged: the Claude program lives UNPACKED next to the archive (a program cannot be run from inside it).
    const claudeBinaryPath = app.isPackaged ? path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "@anthropic-ai", `claude-agent-sdk-${process.platform}-${process.arch}`, "claude") : undefined;
    let query: unknown, provider: unknown; if (TEST_BUILD && process.env.CVAPP_FAKE_CLAUDE && process.env.CVAPP_TEST_PROFILE) query = (await import("./core/fake-claude.ts")).fakeQuery(process.env.CVAPP_TEST_PROFILE);
    // Test build only: the agents answer through a pretend AI SERVICE (the provider seam) instead of a pretend Claude program. The connect screens still use the fake Claude above.
    if (TEST_BUILD && process.env.CVAPP_FAKE_PROVIDER && process.env.CVAPP_TEST_PROFILE) provider = (await import("./core/fake-provider.ts")).fakeProvider(process.env.CVAPP_TEST_PROFILE);
    // "Connect ChatGPT" opens the sign-in page in the user's own browser. The core hands this ONLY an address on OpenAI's sign-in host (it refuses anything else); the shell just opens it.
    let openUrl: (url: string) => Promise<void> = async (u) => { const d = openLinkDecision(u); if (d.action === "browser") await shell.openExternal(d.url); }; // the shell's own allow-list checks it too
    // Test build only: a pretend OpenAI on localhost (CVAPP_OPENAI_BASE) and a stand-in for the browser that follows the sign-in redirect itself (CVAPP_FAKE_BROWSER). Both are removed from a release build.
    let openai: { baseUrl: string; authBase: string } | undefined;
    if (TEST_BUILD && process.env.CVAPP_OPENAI_BASE) { const b = process.env.CVAPP_OPENAI_BASE; openai = { baseUrl: `${b}/v1`, authBase: b }; if (process.env.CVAPP_FAKE_BROWSER) openUrl = async (u) => { const a = await fetch(u, { redirect: "manual" }); const loc = a.headers.get("location"); if (loc) await fetch(loc); }; }
    // The CV renderer: a hidden window that only ever shows one local file the app just wrote (sandboxed, no Node, no scripts, no network), destroyed after every render.
    const renderer = (pdfRenderer = new ElectronPdfRenderer({ tmpDir: app.getPath("temp"), create: () => {
      const w = new BrowserWindow(printWindowOptions(`print-${Date.now()}-${Math.random().toString(36).slice(2)}`));
      w.webContents.session.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !printRequestAllowed(d.url) }));
      return { loadFile: (f) => w.loadFile(f), printToPDF: (o) => w.webContents.printToPDF(o as never), destroy: () => { if (!w.isDestroyed()) w.destroy(); } };
    } }));
    return startApp(await realDeps({ renderer, query, provider: provider as never, openUrl, openai, claudeBinaryPath, configDir: OVERRIDES ? process.env.CVAPP_CLAUDE_CONFIG_DIR : undefined /* tests only: a separate, empty Claude login folder, so a test never touches the real login */, engineDir: app.isPackaged ? path.join(process.resourcesPath, "engine") : path.join(app.getAppPath(), "..", "engine"), userDataDir: app.getPath("userData"), appName: app.getName(), safeStorage: safeStorage as never, tmpDir: app.getPath("temp"), log }));
  },
  onReady: (core) => {
    core.backup.start();
    setAppearance(core.settings.get().settings.appearance);
    if (TEST_BUILD && process.env.CVAPP_TEST_PROFILE && !core.profile.get()) { try { core.profile.save(JSON.parse(readFileSync(process.env.CVAPP_TEST_PROFILE, "utf8"))); } catch { /* the test build only */ } }
    void core.jobs.states().then((js) => notifier.seed(js));
    core.onEvent((e) => { if (e.type === "job") notifier.onJob(e.job); else if (e.type === "step") push("jobs:step", { jobId: e.jobId, scope: e.scope, name: e.name, phase: e.phase }); else if (e.type === "queue") notifier.onQueue(e.snapshot.running); });
    powerMonitor.on("resume", () => host.core()?.backup.onWake());
    life.addCleanup({ name: "app core", run: () => core.shutdown() });
    if (!app.isPackaged) (globalThis as { __cvappCore?: AppCore }).__cvappCore = core;
  },
});
const startCore = () => host.start();

const handlers: Handlers = {
  "app:info": (): AppInfo => ({ name: APP_NAME, version: app.getVersion(), platform: process.platform, packaged: app.isPackaged }),
  "app:openLink": async ({ url }) => { const d = openLinkDecision(url); if (d.action === "browser") { await shell.openExternal(d.url); return { opened: true }; } return { opened: false }; },
  "app:ready": () => { if (win && !win.isDestroyed() && !win.isVisible()) { life.showWindow(); return { shown: true }; } return { shown: false }; },
  ...createCoreHandlers({ host, push: { signin: (p) => push("access:signin", p), changed: (v) => push("access:changed", v) }, copy: (text) => clipboard.writeText(text) }),
  ...createVoiceHandlers({ micAccess: async () => { if (process.platform !== "darwin") return "granted"; let s = systemPreferences.getMediaAccessStatus("microphone"); if (s === "not-determined") { await systemPreferences.askForMediaAccess("microphone").catch(() => false); s = systemPreferences.getMediaAccessStatus("microphone"); } return s === "granted" ? "granted" : s === "denied" ? "denied" : s === "restricted" ? "restricted" : "unknown"; }, voice: createVoice({ onError: (e) => log(`speech to text failed: ${String((e as Error)?.message ?? e).slice(0, 300)}`), transcriber: whisperTranscriber(app.isPackaged ? path.join(process.resourcesPath, "voice", "models") : path.join(HERE, "../../voice/models")) }) }),
  ...createProfileHandlers({ host, chooseCvFile: async () => { if (OVERRIDES && process.env.CVAPP_CV_FILE) return process.env.CVAPP_CV_FILE; /* tests only: no dialog, a fixed file (ignored by a release app) */ const r = await dialog.showOpenDialog(win ?? undefined as never, { title: "Choose your CV", properties: ["openFile"], filters: [{ name: "CV (PDF, Word or text)", extensions: ["pdf", "docx", "txt", "md"] }] }); return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]; } }),
  ...createTelegramHandlers({ host }),
  ...createDataHandlers({ host, version: app.getVersion(), setAppearance, jobsChanged: () => { void host.core()?.jobs.states().then((js) => { notifier.seed(js); push("jobs:changed", { rows: js.map(toRow) }); }); },
    chooseImportFile: async () => { const r = await dialog.showOpenDialog(win ?? undefined as never, { title: "Choose an export to restore", properties: ["openFile"], filters: [{ name: "Zip file", extensions: ["zip"] }] }); return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]; }, setLoginItem: (on) => { try { app.setLoginItemSettings({ openAtLogin: on }); } catch { /* not allowed in some sessions */ } }, afterDelete: () => void life.quit(),
    renderPdf: (html) => { if (!pdfRenderer) throw new Error("not ready"); return pdfRenderer.renderPdf(html); },
    chooseTextFile: async (suggested, format) => {
      if (OVERRIDES && process.env.CVAPP_SAVE_DIR) return path.join(process.env.CVAPP_SAVE_DIR, suggested); // tests only (ignored in a packaged app): no dialog, a fixed folder
      const r = await dialog.showSaveDialog(win ?? undefined as never, { title: `Save as a ${format === "txt" ? "text" : format === "docx" ? "Word" : "PDF"} file`, defaultPath: suggested, filters: [{ name: format === "txt" ? "Text file" : format === "docx" ? "Word document" : "PDF", extensions: [format] }] }); return r.canceled || !r.filePath ? null : r.filePath;
    },
    chooseExportFile: async () => { const r = await dialog.showSaveDialog(win ?? undefined as never, { title: "Save a copy of everything", defaultPath: `${APP_NAME}-export.zip`, filters: [{ name: "Zip file", extensions: ["zip"] }] }); return r.canceled || !r.filePath ? null : r.filePath; } }),
  "notices:list": () => notifier.list(),
  "notices:dismiss": ({ id }) => ({ dismissed: notifier.dismiss(id) }),
  ...createJobsHandlers({ host, fetchAd: (url) => fetchJobAd(url), openPath: (f) => shell.openPath(f), reveal: (f) => shell.showItemInFolder(f), push: (rows) => push("jobs:changed", { rows }) }),
};

// Applied to EVERY web contents the app ever creates, so even a window created later is locked down the same way.
app.on("web-contents-created", (_e, wc) => {
  wc.setWindowOpenHandler(({ url }) => { const d = openLinkDecision(url); if (d.action === "browser") void shell.openExternal(d.url); return { action: "deny" }; });
  wc.on("will-navigate", (e, url) => { if (!navigationAllowed(url, APP_URL)) e.preventDefault(); });
  wc.on("will-redirect", (e, url) => { if (!navigationAllowed(url, APP_URL)) e.preventDefault(); });
  wc.on("will-attach-webview", (e) => e.preventDefault());
});

if (life.ensureSingleInstance()) {
  life.wire();
  app.whenReady().then(() => {
    if (!app.isPackaged) { try { app.dock?.setIcon(nativeImage.createFromPath(path.join(HERE, "../../assets/icon.png"))); } catch { /* no Dock */ } } // development only: the packaged app has its own icon
    const s = session.defaultSession;
    s.setPermissionRequestHandler((_wc, permission, cb, details) => cb(permissionAllowed(permission, details as { mediaTypes?: string[] })));
    s.setPermissionCheckHandler((_wc, permission, _origin, details) => permissionAllowed(permission, details as { mediaType?: string }));
    s.webRequest.onHeadersReceived((details, cb) => cb({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp({ dev: !!DEV_URL, devOrigin: DEV_URL ? new URL(DEV_URL).origin : undefined })] } }));
    registerIpc({ ipcMain, handlers, log, isTrusted: (e) => !!win && trustedSender({ isMainFrame: e.senderFrame === e.sender.mainFrame, url: e.senderFrame?.url ?? "", sameWindow: e.sender === win.webContents }, APP_URL) });
    createWindow(); createTray();
    void startCore();
  });
}
