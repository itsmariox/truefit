// Phase 4c: single instance, hide on close, clean quit. Electron objects are fakes.
import { createLifecycle, type AppLike, type WindowLike } from "../src/main/lifecycle.ts";
let failures = 0;
const check = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
function rig(lock = true) {
  const handlers = new Map<string, (...a: any[]) => void>(), events: string[] = [];
  const app: AppLike & { quits: number } = { quits: 0, requestSingleInstanceLock: () => lock, quit() { this.quits++; events.push("quit"); }, on: (e, l) => { handlers.set(e, l); } };
  let visible = true, minimized = false, closeHandler: ((e: { preventDefault(): void }) => void) | null = null;
  const win: WindowLike = { show: () => { visible = true; events.push("show"); }, hide: () => { visible = false; events.push("hide"); }, focus: () => events.push("focus"), isVisible: () => visible, isMinimized: () => minimized, restore: () => { minimized = false; events.push("restore"); }, on: (_e, l) => { closeHandler = l; } };
  const vis: boolean[] = [], logs: string[] = [];
  const life = createLifecycle({ app, getWindow: () => win, log: (l) => logs.push(l), cleanupTimeoutMs: 80, onVisibility: (v) => vis.push(v) });
  return { app, handlers, events, win, life, vis, logs, close: () => { let prevented = false; closeHandler!({ preventDefault: () => { prevented = true; } }); return prevented; }, setMin: (m: boolean) => { minimized = m; }, isVisible: () => visible };
}
{
  const r = rig(false);
  check("a second copy of the app quits at once and says so; with the lock it runs and registers for the 'second instance' event", r.life.ensureSingleInstance() === false && r.app.quits === 1 && (() => { const q = rig(true); return q.life.ensureSingleInstance() === true && q.app.quits === 0 && q.handlers.has("second-instance"); })());
  const q = rig(true); q.life.ensureSingleInstance(); q.setMin(true); q.win.hide(); q.events.length = 0; q.handlers.get("second-instance")!();
  check("when a second copy is started, the running window comes to the front (restored if minimised, shown, focused)", q.events.join() === "restore,show,focus" && q.isVisible());
}
{
  const r = rig(); r.life.attachWindow(r.win); const prevented = r.close();
  check("closing the window HIDES it and keeps the app running (the close is cancelled, no quit)", prevented && !r.isVisible() && r.app.quits === 0 && r.vis.join() === "false");
  r.life.wire(); r.handlers.get("window-all-closed")!(); r.handlers.get("activate")!();
  check("'all windows closed' never quits a menu-bar app, and a click on the Dock icon brings the window back", r.app.quits === 0 && r.isVisible() && r.vis.join() === "false,true");
  const menu = r.life.trayMenu();
  check("the menu-bar item offers Open and Quit; Open shows the window", menu.map((m) => m.label).join() === "Open,Quit" && (r.win.hide(), menu[0].click(), r.isVisible()));
}
{
  const r = rig(); r.life.attachWindow(r.win); r.life.wire(); const order: string[] = [];
  r.life.addCleanup({ name: "cancel sign-in", run: () => { order.push("signin"); } });
  r.life.addCleanup({ name: "stop watchers", run: async () => { await new Promise((x) => setTimeout(x, 10)); order.push("watchers"); } });
  r.life.addCleanup({ name: "broken", run: () => { throw new Error("boom with /Users/secret"); } });
  r.life.addCleanup({ name: "hangs", run: () => new Promise<void>(() => undefined) });
  r.life.addCleanup({ name: "last backup", run: () => { order.push("backup"); } });
  let prevented = false; r.handlers.get("before-quit")!({ preventDefault: () => { prevented = true; } });
  await new Promise((x) => setTimeout(x, 400));
  check("Cmd+Q (before-quit) is held until every cleanup task has run once, in order; a task that throws or hangs (time limit) never stops the others or the quit", prevented && order.join() === "signin,watchers,backup" && r.app.quits === 1 && r.logs.some((l) => /"broken" failed/.test(l)) && r.logs.some((l) => /"hangs" timed out/.test(l)) && !r.logs.join().includes("secret"));
  const second = { n: 0 }; r.handlers.get("before-quit")!({ preventDefault: () => { second.n++; } });
  check("the second before-quit (after cleanup) is let through: no loop, cleanup runs only once", second.n === 0 && order.length === 3);
  check("while quitting, closing the window really closes it (it is no longer hidden instead)", (() => { const c = rig(); c.life.attachWindow(c.win); void c.life.quit(); return c.close() === false; })());
}
{
  const r = rig(); r.life.attachWindow(r.win); r.life.wire(); const done: string[] = []; r.life.addCleanup({ name: "a", run: () => { done.push("a"); } });
  await r.life.trayMenu()[1].click(); await new Promise((x) => setTimeout(x, 50));
  check("Quit from the menu-bar item runs the cleanup and then quits", done.join() === "a" && r.app.quits === 1 && r.life.isQuitting());
}
console.log(failures === 0 ? "\nall lifecycle tests passed" : `\n${failures} lifecycle test(s) FAILED`); process.exit(failures === 0 ? 0 : 1);
