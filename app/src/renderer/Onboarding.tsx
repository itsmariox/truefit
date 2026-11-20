// First-run guide (Truefit): four steps: what it does, why it can be trusted, connect Claude (required, no skip), build your profile. The last step offers two ways, each on its own screen:
// import a CV (upload or paste) or start from scratch (type or dictate). A loading animation runs while Claude reads it, and on success the guide is finished (the engine setting "onboarding.done") and the user lands on Home.
// The Connect step is the same component Settings uses.
import { useEffect, useState } from "react";
import type { AccessView, CvAppBridge } from "../shared/contract.ts";
import { Connect } from "./Connect.tsx";
import { ONBOARDING as T } from "./onboarding-messages.ts";
import { APPEARANCE } from "./settings-messages.ts";
import { applyAppearance } from "./theme.ts";
import { AppearancePicker, Button, FitRing, Icon } from "./ui.tsx";
import { CvUpload } from "./CvUpload.tsx";
import { Wizard } from "./Wizard.tsx";

export type StartOn = { page: "new" | "profile"; importCv?: boolean };
const Working = () => { const [i, setI] = useState(0); useEffect(() => { const t = setInterval(() => setI((n) => Math.min(n + 1, T.import.stages.length - 1)), 4000); return () => clearInterval(t); }, []); return <div className="ob-working" role="status" data-testid="ob-working"><div className="ob-bar" aria-hidden="true" /><p className="ob-body">{T.import.stages[i]}</p></div>; };
export function Onboarding({ bridge, onDone }: { bridge: CvAppBridge; onDone: (to: StartOn) => void }) {
  const [door, setDoor] = useState<"cv" | "scratch" | null>(null), [busy, setBusy] = useState(false), [step, setStep] = useState(0), [view, setView] = useState<AccessView | null>(null), [problem, setProblem] = useState<string | null>(null);
  const [look, setLook] = useState<string>(() => document.documentElement.dataset.theme ?? "system");
  const chooseLook = (v: "light" | "dark" | "system") => { setLook(v); applyAppearance(v); void bridge.invoke("settings:set", { patch: { appearance: v } }); }; // shown at once; saved quietly (the window itself follows when it is saved)
  useEffect(() => { let live = true; void bridge.invoke("access:get").then((r) => { if (live && r.ok) setView(r.data); }); const off = bridge.on("access:changed", (v) => setView(v)); return () => { live = false; off(); }; }, [bridge]);
  const finish = async (to: StartOn) => { setProblem(null); const r = await bridge.invoke("settings:set", { patch: { onboardingDone: true } }); if (r.ok && r.data.ok) onDone(to); else setProblem("That didn't save. Try again."); };
  const last = step === T.steps.length - 1, connected = !!view?.connected;
  return (
    <div className="window onboarding" data-testid="onboarding">
      <header className="topbar"><span className="topbar-spacer" /></header>
      <main className="ob-main">
        <ol className="ob-steps" aria-label="Setup steps">{T.steps.map((n, i) => <li key={n} className={i === step ? "on" : i < step ? "past" : ""} aria-current={i === step ? "step" : undefined}><span className="sr-only">{n}</span></li>)}</ol>
        <section className="ob-card" aria-live="polite" data-step={step}>
          {step === 0 && (
            <>
              <h1 className="ob-title">{T.welcome.title}</h1><p className="ob-body">{T.welcome.body}</p>
              <div className="ob-example" aria-label={T.welcome.example}>
                <FitRing fit={78} verdict="apply" />
                <div className="ob-example-main"><span className="pill pill-apply"><Icon name="check" />{T.welcome.sampleVerdict}</span><strong>{T.welcome.sampleRole}</strong>
                  <ul className="ob-proof">{T.welcome.proof.map((p) => <li key={p.label}><Icon name={p.state.startsWith("Thin") ? "warn" : "check"} /><span>{p.label}</span><em>{p.state}</em></li>)}</ul></div>
                <span className="ob-tag">{T.welcome.example}</span>
              </div>
              <h2 className="ob-sub">{APPEARANCE.welcomeTitle}</h2>
              <AppearancePicker value={look} legend={APPEARANCE.welcomeTitle} labels={APPEARANCE.options} onChange={chooseLook} />
            </>
          )}
          {step === 1 && (
            <>
              <h1 className="ob-title">{T.honest.title}</h1>
              <ul className="ob-points">{T.honest.points.map((p) => <li key={p.head}><Icon name="check" /><div><strong>{p.head}</strong> {p.text}</div></li>)}</ul>
            </>
          )}
          {step === 2 && (
            <>
              <h1 className="ob-title">{T.connect.title}</h1><p className="ob-body">{T.connect.body}</p>
              <Connect bridge={bridge} initial={view} onView={setView} embedded />
              {connected && <p className="ob-ok" role="status" data-testid="ob-connected"><Icon name="check" />{T.connect.connected}</p>}
            </>
          )}
          {step === 3 && (
            <>
              {busy && <Working />}
              <div className="ob-step" hidden={busy}>
                {door === null && (
                  <>
                    <h1 className="ob-title">{T.choose.title}</h1><p className="ob-body">{T.choose.body}</p>
                    <div className="ob-choices">
                      <button type="button" className="ob-choice ob-choice-main" onClick={() => setDoor("cv")} data-testid="ob-cv"><strong>{T.choose.cv}</strong><span>{T.choose.cvHint}</span></button>
                      <button type="button" className="ob-choice" onClick={() => setDoor("scratch")} data-testid="ob-scratch"><strong>{T.choose.scratch}</strong><span>{T.choose.scratchHint}</span></button>
                    </div>
                  </>
                )}
                {door === "cv" && <><h1 className="ob-title">{T.import.title}</h1><p className="ob-body">{T.import.body}</p><CvUpload bridge={bridge} onBusy={setBusy} onDone={() => void finish({ page: "new" })} /></>}
                {door === "scratch" && <Wizard bridge={bridge} onSave={() => void finish({ page: "new" })} onBack={() => setDoor(null)} />}
              </div>
            </>
          )}
          {problem && <p role="alert" className="problem">{problem}</p>}
        </section>
        {!(step === 3 && door === "scratch") && <footer className="ob-foot">
          {step > 0 ? <Button disabled={busy} onClick={() => (step === 3 && door ? setDoor(null) : setStep(step - 1))}>{T.back}</Button> : <span />}
          {!last && <div className="ob-foot-right">
            <Button kind="primary" disabled={step === 2 && !connected} onClick={() => setStep(step + 1)} data-testid="ob-next">{step === 0 ? T.welcome.go : T.next}</Button>
          </div>}
        </footer>}
      </main>
    </div>
  );
}
