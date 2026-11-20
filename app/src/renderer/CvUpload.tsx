// Onboarding, "Import from my CV": the person chooses a file and that is all. The text is read on this Mac, sent to Claude once (contact details removed first), and the profile
// is saved; whatever is missing or looks wrong is flagged on the profile page for the person to fix. While it runs the parent shows the loading screen (`onBusy`).
import { useEffect, useState } from "react";
import type { CvAppBridge, UiMessage } from "../shared/contract.ts";
import { Banner, Button } from "./ui.tsx";
import { ONBOARDING as T } from "./onboarding-messages.ts";
import { PROFILE } from "./profile-messages.ts";

export function CvUpload({ bridge, onBusy, onDone }: { bridge: CvAppBridge; onBusy: (b: boolean) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null), [msg, setMsg] = useState<UiMessage | null>(null);
  useEffect(() => { onBusy(busy); }, [busy, onBusy]);
  const go = async () => {
    setProblem(null); setMsg(null);
    const f = await bridge.invoke("profile:importFile"); if (!f.ok) { setProblem(f.error.message); return; }
    if (f.data.status === "cancelled") return;
    if (f.data.status === "refused") { setProblem(PROFILE.import.fileBad[f.data.reason]); return; }
    setBusy(true); const r = await bridge.invoke("profile:import", { text: f.data.text }); setBusy(false);
    if (!r.ok) { setProblem(r.error.message); return; }
    if (r.data.status === "ok") { onDone(); return; }
    if (r.data.reason === "too_short") setProblem(T.import.tooShort); else if (r.data.message) setMsg(r.data.message); else setProblem(T.import.failed);
  };
  return (
    <section className="ob-import" data-testid="cv-upload">
      <p className="muted small">{T.import.privacy}</p>
      <div className="row"><Button kind="primary" onClick={() => void go()} data-testid="cv-choose">{T.import.choose}</Button></div>
      <p className="muted small">{T.import.formats}</p>
      {problem && <p role="alert" className="problem" data-testid="cv-problem">{problem}</p>}
      {msg && <Banner message={msg} handled={() => false} onAction={() => undefined} />}
    </section>
  );
}
