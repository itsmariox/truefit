// Window security (phase 4c), as PURE functions so tests can read the real settings without starting Electron. The window shows text that came from the internet
// (job ads), so it gets no Node, no remote content, no navigation, no pop-ups, no permissions, and a strict content policy. Nothing here imports Electron.
import { allowedLink } from "../../../engine/src/access/signin.ts";
import { allowedOpenAILink } from "../../../engine/src/access/openai-signin.ts";

// The settings of the one window. Every flag is set explicitly even where it is the default now, so a changed default can never loosen it.
export function windowOptions(preloadPath: string, o: { devTools?: boolean } = {}) {
  return {
    width: 1180, height: 760, minWidth: 820, minHeight: 560, show: false, titleBarStyle: "hidden" as const, trafficLightPosition: { x: 16, y: 19 }, vibrancy: "sidebar" as const, visualEffectState: "followWindow" as const, backgroundColor: "#00000000", // the sidebar shows the Mac's own translucent material
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      webSecurity: true, allowRunningInsecureContent: false, experimentalFeatures: false, webviewTag: false, navigateOnDragDrop: false,
      safeDialogs: true, spellcheck: false, enableWebSQL: false, devTools: o.devTools ?? false, // DevTools only when the caller says so (development), never by default
    },
  };
}

// The hidden window that prints a CV to PDF (phase 6): it only ever shows one local file, so it gets no Node, no scripts, no DevTools, a throwaway session, and every request except
// local files and data is cancelled by `printRequestAllowed`.
export function printWindowOptions(partition: string) {
  return { show: false, width: 900, height: 1200, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, javascript: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: false, partition } };
}
export const printRequestAllowed = (url: string) => /^(file|data):/i.test(url);

// The content policy of the page. Strict in a packaged app; the development server needs a little more (hot reload), and only when it is NOT packaged.
export function csp(o: { dev: boolean; devOrigin?: string }): string {
  const dev = o.dev && o.devOrigin;
  return [
    "default-src 'none'",
    `script-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
    `style-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${dev ? `'self' ${o.devOrigin} ${o.devOrigin!.replace(/^http/, "ws")}` : "'none'"}`, // the page never talks to the network: everything goes through the bridge
    "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "frame-src 'none'", "worker-src 'none'", "media-src 'none'",
  ].join("; ");
}

// May the window navigate to this address? Only to the page it was loaded with (same origin and path root), never anywhere else.
export function navigationAllowed(target: string, appUrl: string): boolean {
  try {
    const t = new URL(target), a = new URL(appUrl);
    if (t.protocol !== a.protocol) return false;
    if (t.protocol === "file:") return t.pathname === a.pathname; // the one local page, nothing else on disk
    return t.origin === a.origin; // the development server
  } catch { return false; }
}

// A new window or link requested by the page is NEVER opened inside the app. A link on Claude's or OpenAI's own sites (the sign-in host and ChatGPT's pages) goes to the user's browser; anything else is dropped.
export function openLinkDecision(url: string): { action: "deny" } | { action: "browser"; url: string } {
  const u = allowedLink(url) ?? allowedOpenAILink(url);
  return u ? { action: "browser", url: u } : { action: "deny" };
}

// Every permission a page can ask for (camera, location, notifications, clipboard, fullscreen ...) is refused. The ONE exception is the microphone (audio only, never the camera), because the
// dictation listens to the person: the recording stays on this Mac and goes only to the bundled speech model (see voice.ts).
export const permissionAllowed = (permission: string, details?: { mediaTypes?: string[]; mediaType?: string }): boolean => {
  if (permission !== "media") return false;
  const types = details?.mediaTypes ?? (details?.mediaType ? [details.mediaType] : []);
  return types.length > 0 && types.every((t) => t === "audio");
};

// Sender check for the bridge: only the main frame of OUR window, loaded from OUR page, may call it.
export function trustedSender(s: { isMainFrame: boolean; url: string; sameWindow: boolean }, appUrl: string): boolean {
  return s.isMainFrame && s.sameWindow && navigationAllowed(s.url, appUrl);
}
