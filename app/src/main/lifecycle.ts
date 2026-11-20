// The app's life (phase 4c): one copy only, a window that hides when closed (the app is a menu-bar app and keeps running), a menu-bar item to open or quit, and a clean quit
// that runs registered cleanup tasks first (cancel an active sign-in, stop watchers, a last backup in 4d). Electron objects are passed in, so all of it is tested with fakes.
export type WindowLike = { show(): void; hide(): void; focus(): void; isVisible(): boolean; isMinimized(): boolean; restore(): void; on(event: "close", l: (e: { preventDefault(): void }) => void): void };
export type AppLike = { requestSingleInstanceLock(): boolean; quit(): void; on(event: string, l: (...a: any[]) => void): void };
export type TrayLike = { setContextMenu(items: { label: string; click: () => void }[]): void };
export type CleanupTask = { name: string; run: () => Promise<void> | void };
export type LifecycleDeps = { app: AppLike; getWindow: () => WindowLike | null; log?: (line: string) => void; cleanupTimeoutMs?: number; onVisibility?: (visible: boolean) => void };

export function createLifecycle(d: LifecycleDeps) {
  let quitting = false, cleanupDone = false;
  const tasks: CleanupTask[] = [], log = (s: string) => d.log?.(s);

  const showWindow = () => { const w = d.getWindow(); if (!w) return; if (w.isMinimized()) w.restore(); w.show(); w.focus(); d.onVisibility?.(true); };
  const hideWindow = () => { d.getWindow()?.hide(); d.onVisibility?.(false); };

  // Runs every task once, each with a time limit, and never lets one failure stop the others or the quit.
  async function runCleanup(): Promise<void> {
    if (cleanupDone) return; cleanupDone = true;
    for (const t of tasks) {
      try { await Promise.race([Promise.resolve(t.run()), new Promise<void>((_, rej) => { const h = setTimeout(() => rej(new Error("timeout")), d.cleanupTimeoutMs ?? 5000); (h as { unref?: () => void }).unref?.(); })]); }
      catch (e) { log(`cleanup "${t.name}" ${(e as Error).message === "timeout" ? "timed out" : "failed"}`); }
    }
  }
  async function quit(): Promise<void> { quitting = true; await runCleanup(); d.app.quit(); }

  return {
    // false means another copy is already running: this one must exit (the running one comes to the front).
    ensureSingleInstance(): boolean {
      if (!d.app.requestSingleInstanceLock()) { d.app.quit(); return false; }
      d.app.on("second-instance", () => showWindow());
      return true;
    },
    attachWindow(w: WindowLike): void {
      w.on("close", (e) => { if (!quitting) { e.preventDefault(); hideWindow(); } }); // closing the window hides it; only Quit ends the app
    },
    wire(): void {
      d.app.on("activate", () => showWindow());          // a click on the Dock icon brings the window back
      d.app.on("window-all-closed", () => undefined);    // a menu-bar app never quits because its window closed
      d.app.on("before-quit", (e: { preventDefault(): void }) => { // Cmd+Q, Quit from the Dock, a log-out or a restart
        if (cleanupDone) return;
        e.preventDefault(); quitting = true; void quit();
      });
    },
    trayMenu(): { label: string; click: () => void }[] { return [{ label: "Open", click: showWindow }, { label: "Quit", click: () => void quit() }]; },
    addCleanup(t: CleanupTask): void { tasks.push(t); },
    showWindow, hideWindow, quit,
    isQuitting: () => quitting,
  };
}
