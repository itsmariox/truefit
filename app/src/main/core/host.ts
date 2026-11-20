// The host (phase 4e): holds what start-up produced and lets the page ask "did it start?", restore a backup, or start fresh. It never opens a core that is not safe, accepts only
// backup files that were LISTED to the user (never a path from the page), and requires an explicit confirmation to start fresh. No Electron import: tested with the real core.
import { createHash } from "node:crypto";
import type { StartPhase, StartStatus, UiBackup } from "../../shared/contract.ts";
import type { AppCore, StartResult } from "./app-core.ts";

export function createHost(o: { start: () => Promise<StartResult>; onReady: (core: AppCore) => void; log?: (l: string) => void }) {
  let result: StartResult | null = null, core: AppCore | null = null, phase: StartPhase = "starting";
  const install = (r: StartResult) => { result = r; phase = r.status; if (r.status === "ready") { core = r.core; o.onReady(r.core); } };
  // The page is given an opaque id per backup, never a path (a path holds the user's name); the id maps back to the file here.
  const idOf = (file: string) => "b" + createHash("sha256").update(file).digest("hex").slice(0, 12);
  const listed = () => (result && (result.status === "damaged" || result.status === "upgrade-failed") ? result.backups.filter((b) => b.valid && !b.newer) : []);
  const backups = (): UiBackup[] => listed().map((b) => ({ id: idOf(b.file), createdAt: b.createdAt, reason: b.reason }));
  const status = (): StartStatus => ({ phase, backups: backups() });
  return {
    async start(): Promise<void> { try { install(await o.start()); } catch (e) { phase = "failed"; o.log?.(`start-up failed (${(e as Error).name})`); } },
    core: (): AppCore | null => core,
    status,
    async recover(id: string): Promise<StartStatus> {
      if (!result || (result.status !== "damaged" && result.status !== "upgrade-failed")) return status();
      const pick = listed().find((b) => idOf(b.file) === id); if (!pick) throw new Error("not a listed backup");
      install(await result.recover(pick.file)); return status();
    },
    async startFresh(confirmed: boolean): Promise<StartStatus> {
      if (!confirmed || !result || result.status !== "damaged") return status();
      install(await result.startFresh()); return status();
    },
  };
}
export type Host = ReturnType<typeof createHost>;
