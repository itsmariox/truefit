import { useEffect, useState } from "react";
import type { AppInfo, CvAppBridge, StartStatus } from "../shared/contract.ts";
import { Onboarding, type StartOn } from "./Onboarding.tsx";
import { Shell } from "./Shell.tsx";
import { StartupProblem } from "./StartupProblem.tsx";
import { applyAppearance } from "./theme.ts";

// The page decides between three things: still starting, a start-up problem (nothing else is reachable), or the app. The main process shows the window once `app:ready` is sent.
export function App({ bridge }: { bridge: CvAppBridge }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [status, setStatus] = useState<StartStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [onboarded, setOnboarded] = useState<boolean | null>(null), [startOn, setStartOn] = useState<StartOn | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void bridge.invoke("app:info").then((r) => { if (cancelled) return; if (r.ok) setInfo(r.data); else setProblem(r.error.message); });
    void bridge.invoke("app:ready");
    const poll = async () => { // the core starts a moment after the window: ask until it is no longer 'starting'
      for (let i = 0; i < 200 && !cancelled; i++) {
        const r = await bridge.invoke("app:status"); if (cancelled) return;
        if (r.ok && r.data.phase !== "starting") { setStatus(r.data); return; }
        if (!r.ok) { setProblem(r.error.message); return; }
        await new Promise((res) => setTimeout(res, 150));
      }
    };
    void poll();
    return () => { cancelled = true; };
  }, [bridge]);
  useEffect(() => { if (status?.phase !== "ready") return; let live = true; void bridge.invoke("settings:get").then((r) => { if (live) { setOnboarded(r.ok ? r.data.onboardingDone : true); if (r.ok) applyAppearance(r.data.appearance); } }); return () => { live = false; }; }, [bridge, status?.phase]);
  if (problem) return <main className="shell"><p role="alert" className="problem" data-testid="problem">{problem}</p></main>;
  if (!info || !status) return <main className="shell"><h1 className="brand">{info?.name ?? "Truefit"}</h1><p className="muted">Starting…</p></main>;
  if (status.phase !== "ready") return <StartupProblem bridge={bridge} status={status} onStatus={setStatus} />;
  if (onboarded === null) return <main className="shell"><h1 className="brand">{info.name}</h1></main>;
  if (!onboarded) return <Onboarding bridge={bridge} onDone={(to) => { setStartOn(to); setOnboarded(true); }} />;
  return <Shell bridge={bridge} appName={info.name} startOn={startOn} onReplayGuide={() => { setStartOn(undefined); setOnboarded(false); }} />;
}
