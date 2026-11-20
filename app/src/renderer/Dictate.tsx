// Dictation for a text box: a small mic button that records on this Mac, turns the audio into text with the bundled speech model, and hands the words back.
// Nothing is uploaded. The mic is hidden where the page cannot record.
import { useEffect, useRef, useState } from "react";
import type { CvAppBridge } from "../shared/contract.ts";
import { Icon } from "./ui.tsx";
import { micSupported, startMic, type MicSession } from "./mic.ts";
import { PROFILE } from "./profile-messages.ts";

const V = PROFILE.talk.voice;
export function useDictation(bridge: CvAppBridge, onText: (text: string) => void) {
  const [rec, setRec] = useState(false), [hearing, setHearing] = useState(false), [problem, setProblem] = useState<string | null>(null), session = useRef<MicSession | null>(null), cb = useRef(onText);
  cb.current = onText;
  useEffect(() => () => { void session.current?.stop(); }, []);
  const finish = async () => {
    const s = session.current; if (!s) return; session.current = null; setRec(false); setHearing(true);
    const audio = await s.stop(); if (!audio) { setHearing(false); setProblem(V.nothing); return; }
    const r = await bridge.invoke("voice:transcribe", { audio }); setHearing(false);
    if (!r.ok) { setProblem(r.error.message); return; }
    if (r.data.status === "ok") cb.current(r.data.text); else setProblem(V.problems[r.data.reason]);
  };
  const toggle = async () => {
    setProblem(null); if (rec) { await finish(); return; }
    const acc = await bridge.invoke("voice:mic"); if (acc.ok && (acc.data.access === "denied" || acc.data.access === "restricted")) { setProblem(V.blocked); return; }
    try { session.current = await startMic({ onLevel: () => undefined, onSilence: () => { void finish(); } }); setRec(true); }
    catch (e) { setProblem((e as Error)?.name === "NotAllowedError" ? V.blocked : V.noMic); }
  };
  return { rec, hearing, problem, toggle };
}

// A text box (one line or several) with the mic inside it. `value`/`onChange` as any controlled box; dictated words are added after what is already there.
export function DictBox({ bridge, id, label, value, onChange, rows, placeholder, disabled, onEnter, hint }: { hint?: string; bridge: CvAppBridge; id: string; label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; disabled?: boolean; onEnter?: () => void }) {
  const d = useDictation(bridge, (said) => onChange(value.trim() ? `${value.trimEnd()} ${said}` : said));
  const mic = micSupported();
  return (
    <div className="field-row">
      <label className="label" htmlFor={id}>{label}</label>
      <div className="composer">
        {rows ? <textarea id={id} className="composer-input dict-area" rows={rows} placeholder={placeholder} value={value} disabled={disabled || d.hearing} onChange={(e) => onChange(e.target.value)} />
          : <input id={id} className="composer-input dict-line" type="text" placeholder={placeholder} value={value} disabled={disabled || d.hearing} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); } }} />}
        {mic && <button type="button" className={`mic-btn${d.rec ? " mic-on" : ""}${rows ? "" : " mic-line"}`} onClick={() => void d.toggle()} disabled={disabled || d.hearing} aria-pressed={d.rec} aria-label={d.rec ? V.stop : d.hearing ? V.working : `Dictate: ${label}`} title={d.rec ? V.stop : "Dictate"} data-testid={`mic-${id}`}><Icon name="mic" /></button>}
      </div>
      {hint && <span className="field-hint">{hint}</span>}
      {d.rec && <span className="field-hint" role="status">{V.listeningHint}</span>}
      {d.problem && <span className="field-error" role="alert">{d.problem}</span>}
    </div>
  );
}
