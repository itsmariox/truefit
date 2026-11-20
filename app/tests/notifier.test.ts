// Phase 4g: when the app announces something (menu bar, banner, Dock), with fakes for every Electron object.
import { createNotifier, type TrayState } from "../src/main/core/notifier.ts";
import { defaultSettings } from "../../engine/src/store/settings-store.ts";
import type { JobState } from "../../engine/src/pipeline.ts";
import type { UiBanner } from "../src/shared/contract.ts";
let failures = 0;
const check = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const job = (id: string, status: string, extra: Partial<JobState> = {}) => ({ id, dir: "/x/" + id, status, created: "", updated: "", source: "text", company: "Acme", role: "Exec", ...extra }) as JobState;
function rig(o: { visible?: boolean; settings?: Partial<ReturnType<typeof defaultSettings>> } = {}) {
  const banners: UiBanner[] = [], trays: [TrayState, number, number][] = [], dock = { bounces: 0, badge: "" }; let visible = o.visible ?? false; const settings = { ...defaultSettings(), ...(o.settings ?? {}) };
  const n = createNotifier({ settings: () => settings, windowVisible: () => visible, push: (b) => banners.push(b), tray: (s, a, b) => trays.push([s, a, b]), dock: { bounce: () => { dock.bounces++; }, badge: (t) => { dock.badge = t; } } });
  return { n, banners, trays, dock, show: (v: boolean) => { visible = v; }, settings };
}
{
  const r = rig(); r.n.seed([job("a", "analysed"), job("b", "paused"), job("c", "interrupted")]);
  check("start-up announces NOTHING for jobs already in any state, but the menu bar and Dock badge show 2 jobs need you", r.banners.length === 0 && r.dock.bounces === 0 && r.trays.at(-1)!.join() === "needs_you,2,0" && r.dock.badge === "2");
}
{
  const r = rig(); r.n.seed([job("a", "analysing")]); r.n.onQueue(1);
  check("while a job runs the menu bar says 'working'", r.trays.at(-1)!.join() === "working,0,1");
  r.n.onJob(job("a", "analysed", { verdict: "apply", fit: 80 })); r.n.onQueue(0);
  check("analysed: ONE banner 'Job analysed' naming the job, verdict and fit; the window is hidden so the Dock bounces once; the menu bar goes back to idle", r.banners.length === 1 && r.banners[0].title === "Job analysed" && r.banners[0].body === "Acme, Exec: Apply, fit 80%" && r.dock.bounces === 1 && r.trays.at(-1)!.join() === "idle,0,0");
  r.n.onJob(job("a", "analysed", { verdict: "apply", fit: 80 }));
  check("the same status saved again announces nothing (no duplicates)", r.banners.length === 1);
}
{
  const r = rig({ visible: true }); r.n.seed([job("a", "analysing")]); r.n.onJob(job("a", "analysed", { verdict: "skip", fit: 20 }));
  check("with the window in front there is a banner but no Dock bounce", r.banners.length === 1 && r.dock.bounces === 0);
}
{
  const r = rig(); r.n.seed([job("a", "analysing"), job("b", "building"), job("c", "analysing"), job("d", "analysing")]);
  r.n.onJob(job("a", "paused")); r.n.onJob(job("b", "built")); r.n.onJob(job("c", "needs_input")); r.n.onJob(job("d", "failed"));
  check("paused, CV ready, needs input and failed each give their own banner", r.banners.map((b) => b.kind).join() === "paused,built,needs_input,failed" && r.banners.map((b) => b.title).join("|") === "A job is paused|Your CV is ready|A job needs your answer|A job didn't finish");
  check("the menu bar and Dock count the jobs that need the user (paused, needs input, failed = 3), not the built one", r.trays.at(-1)!.join() === "needs_you,3,0" && r.dock.badge === "3");
  r.n.onJob(job("a", "analysed"));
  check("when a paused job is resumed and finishes, the count goes down", r.trays.at(-1)!.join() === "needs_you,2,0" && r.dock.badge === "2");
}
{
  const r = rig({ settings: { "notify.analysed": false, "notify.failed": false } }); r.n.seed([job("a", "analysing"), job("b", "analysing")]);
  r.n.onJob(job("a", "analysed")); r.n.onJob(job("b", "failed"));
  check("a notification the user switched off in Settings is not shown (the menu bar still counts the failed job)", r.banners.length === 0 && r.dock.bounces === 0 && r.trays.at(-1)!.join() === "needs_you,1,0");
}
{
  const r = rig(); r.n.seed([job("a", "analysing"), job("b", "analysing")]); r.n.onJob(job("a", "analysed")); r.n.onJob(job("b", "analysed"));
  const id = r.n.list()[0].id; check("the list is newest first; dismissing one removes only it; dismissing by job removes that job's", r.n.list().length === 2 && r.n.dismiss(id) && r.n.list().length === 1 && !r.n.dismiss(id) && (r.n.dismissJob("a"), r.n.list().length === 0));
  const many = rig(); many.n.seed([]); for (let i = 0; i < 20; i++) { many.n.seed([job("x" + i, "analysing")]); many.n.onJob(job("x" + i, "failed")); }
  check("only the most recent banners are kept (no unbounded growth)", many.n.list().length <= 8);
  const broken = createNotifier({ settings: () => { throw new Error("closed"); }, windowVisible: () => true, push: () => undefined, tray: () => undefined, dock: { bounce: () => undefined, badge: () => undefined } }); broken.seed([job("a", "analysing")]); broken.onJob(job("a", "analysed"));
  check("if the settings cannot be read, the banner is still shown (never silently lost)", broken.list().length === 1);
}
{
  const r = rig(); r.n.seed([job("a", "analysing")]); r.n.onJob(job("a", "failed")); r.n.onJob(job("a", "failed")); r.n.onJob(job("new", "failed"));
  check("a failure saved twice is announced once, and a job first seen already failed (nothing before it) is not announced", r.banners.length === 1);
}
{
  // banners kept across restarts
  let disk: UiBanner[] = []; const store = { read: () => structuredClone(disk), write: (l: UiBanner[]) => { disk = structuredClone(l); } };
  const make = () => { const banners: UiBanner[] = []; const n = createNotifier({ settings: () => defaultSettings(), windowVisible: () => true, push: (b) => banners.push(b), tray: () => undefined, dock: { bounce: () => undefined, badge: () => undefined }, storage: store }); return { n, banners }; };
  const a = make(); a.n.seed([job("a", "analysing"), job("b", "analysing")]); a.n.onJob(job("a", "analysed", { verdict: "apply", fit: 80 })); a.n.onJob(job("b", "failed"));
  check("a banner is written to the store when it is added", disk.length === 2);
  const b = make(); b.n.seed([job("a", "analysed"), job("b", "failed")]);
  check("after a restart the banners are back, newest first, and NOTHING is announced or pushed again", b.n.list().length === 2 && b.banners.length === 0 && b.n.list()[0].jobId === "b");
  b.n.onJob(job("a", "paused"));
  check("a new banner after the restart gets a fresh id that does not clash with a loaded one", new Set(b.n.list().map((x) => x.id)).size === 3);
  check("dismissing a banner is saved: it does not come back after another restart", (() => { const id = b.n.list()[0].id; b.n.dismiss(id); const c = make(); c.n.seed([job("a", "paused"), job("b", "failed")]); return !c.n.list().some((x) => x.id === id) && c.n.list().length === 2; })());
  const d2 = make(); d2.n.seed([job("a", "paused")]);
  check("a banner for a job that no longer exists is dropped at start-up and the drop is saved", d2.n.list().every((x) => x.jobId === "a") && disk.every((x) => x.jobId === "a"));
  d2.n.seed([]);
  check("when jobs are deleted while the app runs (seed with none) every banner goes", d2.n.list().length === 0 && disk.length === 0);
  disk = [{ id: "n1", kind: "analysed", jobId: "a", title: "t", body: "b", at: "2026-01-01T00:00:00.000Z" }]; const bad = make(); bad.n.seed([job("a", "analysed")]);
  check("a store that cannot be read or is empty leaves the app working with no banners", (() => { const broken = createNotifier({ settings: () => defaultSettings(), windowVisible: () => true, push: () => undefined, tray: () => undefined, dock: { bounce: () => undefined, badge: () => undefined }, storage: { read: () => { throw new Error("corrupt"); }, write: () => { throw new Error("disk full"); } } }); broken.seed([job("a", "analysing")]); broken.onJob(job("a", "failed")); return broken.list().length === 1 && bad.n.list().length === 1; })());
}
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); } else console.log("\nALL PASS");
