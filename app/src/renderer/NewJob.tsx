// New job (phase 4f, redesigned 2026-11-19): one big input for a pasted ad or a link. Creating a job asks nothing of Claude; the analysis is a separate press (here it follows at once). Duplicates are
// offered back to the user instead of being analysed twice. The same input also sits at the foot of a job page (`AdComposer`), so there is only ever ONE "Job ad or link" box on screen.
import { useRef, useState, type KeyboardEvent } from "react";
import type { CvAppBridge, UiJobRow } from "../shared/contract.ts";
import { DUPLICATE, NEW_JOB, NEW_JOB_NEW, REFUSED } from "./jobs-messages.ts";
import { EASE, gsap, reducedMotion, useGSAP } from "./motion.ts";
import { Banner, BrandMark, Icon, JobRowButton } from "./ui.tsx";

type Notice = { title: string; body: string; actions?: { id: string; label: string }[]; existing?: UiJobRow; retry?: boolean };
export function useAdSubmit(bridge: CvAppBridge, onOpen: (id: string) => void) {
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState<Notice | null>(null), [problem, setProblem] = useState<string | null>(null);
  const analyse = async (id: string) => { const r = await bridge.invoke("jobs:analyse", { id }); if (!r.ok) setProblem(r.error.message); else onOpen(id); };
  const submit = async (force = false) => {
    if (busy) return; setProblem(null); setNotice(null);
    if (!text.trim()) { setNotice({ ...NEW_JOB.nothing }); return; }
    setBusy(true);
    try {
      const r = await bridge.invoke("jobs:create", { text, force: force ? true : undefined });
      if (!r.ok) { setProblem(r.error.message); return; }
      const o = r.data;
      if (o.outcome === "created") { setText(""); await analyse(o.job.id); }
      else if (o.outcome === "duplicate") setNotice({ title: DUPLICATE.title, body: DUPLICATE.body(o.existing.title), existing: o.existing, actions: [{ id: "open", label: DUPLICATE.open }, { id: "again", label: DUPLICATE.again }] });
      else { const m = REFUSED[o.reason] ?? REFUSED.not_ready, notAd = o.reason === "too_short" || o.reason === "not_a_job"; setNotice({ title: m.title, body: o.missing.length ? `${m.body} ${o.missing.join(", ")}.` : m.body, ...(notAd ? { retry: true, actions: [{ id: "force", label: NEW_JOB.tryAnyway }] } : {}) }); }
    } finally { setBusy(false); }
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } };
  const messages = (
    <>
      {problem && <p role="alert" className="problem" data-testid="problem">{problem}</p>}
      {notice && (
        <Banner message={{ id: "newjob.notice", tone: "warn", title: notice.title, body: notice.body, actions: notice.actions ?? [], details: "" }} busy={busy} handled={() => true}
          onAction={(id) => { if (notice.retry) { if (id === "force") void submit(true); return; } if (!notice.existing) return; if (id === "open") onOpen(notice.existing.id); else void analyse(notice.existing.id); }} />
      )}
    </>
  );
  return { text, setText, busy, submit, onKey, messages };
}

export function NewJob({ bridge, onOpen, recent = [] }: { bridge: CvAppBridge; onOpen: (id: string) => void; recent?: UiJobRow[] }) {
  const f = useAdSubmit(bridge, onOpen), last = recent.slice(0, 4), ref = useRef<HTMLDivElement>(null);
  // A short, quiet entrance (the page's own parts settle in once); nothing under reduced motion.
  useGSAP(() => {
    if (reducedMotion()) return;
    gsap.from(ref.current?.children ?? [], { opacity: 0, y: 6, duration: 0.3, stagger: 0.03, ease: EASE, clearProps: "opacity,transform" });
  }, { scope: ref });
  return (
    <div className="newjob" data-testid="new-job-form" ref={ref}>
      <span className="markbig"><BrandMark size={30} /></span>
      <h1 className="hero">{NEW_JOB.hero}</h1>
      <p className="hero-hint">{NEW_JOB.hint}</p>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void f.submit(); }}>
        <label className="sr-only" htmlFor="ad-input">Job ad or link</label>
        <textarea id="ad-input" className="composer-input" rows={3} placeholder={NEW_JOB.placeholder} value={f.text} onChange={(e) => f.setText(e.target.value)} onKeyDown={f.onKey} disabled={f.busy} />
        <div className="composer-foot">
          <span className="composer-keys muted small" aria-hidden="true"><kbd>⌘</kbd><kbd>Return</kbd> {NEW_JOB_NEW.keys}</span>
          <button type="submit" className="send-pill" aria-label={NEW_JOB.send} disabled={f.busy}>{NEW_JOB.send}<span className="send-arrow"><Icon name="arrow" /></span></button>
        </div>
      </form>
      <ul className="trust">{NEW_JOB_NEW.trust.map((t, i) => <li key={t}><Icon name={i === 2 ? "lock" : "shield"} />{t}</li>)}</ul>
      {f.messages}
      {last.length > 0 && (
        <section className="recent" aria-label={NEW_JOB_NEW.recent}>
          <h2 className="recent-title">{NEW_JOB_NEW.recent}</h2>
          <ul className="recent-list">{last.map((j) => <li key={j.id}><JobRowButton row={j} onOpen={onOpen} testId="recent-row" className="recent-row" /></li>)}</ul>
        </section>
      )}
    </div>
  );
}

// The same input, docked at the foot of a job page: paste another ad or link without going back.
export function AdComposer({ bridge, onOpen }: { bridge: CvAppBridge; onOpen: (id: string) => void }) {
  const f = useAdSubmit(bridge, onOpen);
  return (
    <div className="dock" data-testid="dock">
      {f.messages}
      <form className="dock-composer" onSubmit={(e) => { e.preventDefault(); void f.submit(); }}>
        <label className="sr-only" htmlFor="ad-input">Job ad or link</label>
        <textarea id="ad-input" className="dock-input" rows={1} placeholder={NEW_JOB_NEW.dockPlaceholder} value={f.text} onChange={(e) => f.setText(e.target.value)} onKeyDown={f.onKey} disabled={f.busy} />
        <button type="submit" className="send" aria-label={NEW_JOB.send} disabled={f.busy}><Icon name="arrow" /></button>
      </form>
    </div>
  );
}
