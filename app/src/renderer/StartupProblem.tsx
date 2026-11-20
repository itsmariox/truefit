// The start-up problem screens (phase 4e): damaged data (restore or start fresh), data from a newer version, an update that stopped, and a start that failed. The wording is
// in startup-messages.ts (DRAFT until approved). Nothing else in the app is reachable while one of these is showing.
import { useState } from "react";
import type { CvAppBridge, StartStatus } from "../shared/contract.ts";
import { STARTUP_COPY } from "./startup-messages.ts";
import { Banner, Button } from "./ui.tsx";

export function StartupProblem({ bridge, status, onStatus }: { bridge: CvAppBridge; status: StartStatus; onStatus: (s: StartStatus) => void }) {
  const phase = status.phase as "damaged" | "too-new" | "upgrade-failed" | "failed", c = STARTUP_COPY[phase] ?? STARTUP_COPY.failed;
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null);
  const run = async (f: () => ReturnType<CvAppBridge["invoke"]>) => { setBusy(true); setProblem(null); const r = await f(); setBusy(false); if (r.ok) onStatus(r.data as StartStatus); else setProblem(r.error.message); };
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Unknown date");
  const showRestore = (phase === "damaged" || phase === "upgrade-failed");
  return (
    <main className="problem-screen" data-testid="startup-problem" data-phase={phase}>
      <Banner message={{ id: `startup.${phase}`, tone: "error", title: c.title, body: c.body, actions: [], details: "" }} handled={() => false} onAction={() => undefined} />
      {problem && <p role="alert" className="problem" data-testid="problem">{problem}</p>}
      {showRestore && (
        <section className="card">
          <h2>{c.restoreHeading}</h2>
          {status.backups.length === 0 ? <p className="muted">{c.noBackups}</p> : (
            <ul className="backups">{status.backups.map((b) => <li key={b.id}><span>{when(b.createdAt)}</span><Button disabled={busy} onClick={() => void run(() => bridge.invoke("app:recover", { id: b.id }))}>{c.restoreButton}</Button></li>)}</ul>
          )}
        </section>
      )}
      {phase === "damaged" && (
        <section className="card">
          {!confirming ? <Button disabled={busy} onClick={() => setConfirming(true)}>{c.freshButton}</Button> : (
            <div role="alertdialog" aria-labelledby="fresh-title" aria-describedby="fresh-text">
              <h2 id="fresh-title">{c.freshWarningTitle}</h2><p id="fresh-text">{c.freshWarning}</p>
              <div className="row"><Button kind="primary" disabled={busy} onClick={() => void run(() => bridge.invoke("app:startFresh", { confirmed: true }))}>{c.freshConfirm}</Button><Button disabled={busy} onClick={() => setConfirming(false)}>{c.freshCancel}</Button></div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
