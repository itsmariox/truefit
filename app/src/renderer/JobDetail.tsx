// The Job screen (phase 4f): what Claude found (verdict, fit, your rules, strengths, gaps), or where the job is (waiting, running, paused, interrupted, failed, skipped). The wording
// of a pause comes from the approved access catalogue (through the main process); everything else is in jobs-messages.ts. Build CV is present but off until phase 6.
import { useCallback, useEffect, useRef, useState } from "react";
import type { CvAppBridge, UiJobDetail } from "../shared/contract.ts";
import { BUILD, CARD, JOB_NEW, RULE_NAME, STATES, VERDICT_WORD, WAITING, stageOf } from "./jobs-messages.ts";
import { AdComposer } from "./NewJob.tsx";
import { EASE, gsap, reducedMotion, useGSAP } from "./motion.ts";
import { Banner, BrandMark, Button, FitRing, Icon, TextArea, VerdictMark, WorkingRing } from "./ui.tsx";

const capFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
type ExtraKind = UiJobDetail["extras"][number]["kind"];
const EXTRA_KINDS: [ExtraKind, string][] = [["cover-note", BUILD.extras.cover], ["interview-prep", BUILD.extras.prep], ["recruiter-message", BUILD.extras.recruiter], ["company-brief", BUILD.extras.brief]];
export function JobDetail({ bridge, id, onOpenProfile, onOpen }: { bridge: CvAppBridge; id: string; onOpenProfile?: () => void; onOpen?: (id: string) => void }) {
  const [job, setJob] = useState<UiJobDetail | null | undefined>(undefined), [problem, setProblem] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const alive = useRef(true); useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async () => { const r = await bridge.invoke("jobs:get", { id }); if (!alive.current) return; if (r.ok) setJob(r.data); else setProblem(r.error.message); }, [bridge, id]);
  useEffect(() => { setJob(undefined); void load(); return bridge.on("jobs:changed", () => void load()); }, [bridge, id, load]);
  // The agents at work: the real steps of the run, as they begin and end (only seen while this page is open).
  const [stages, setStages] = useState<{ label: string; done: boolean }[]>([]);
  useEffect(() => bridge.on("jobs:step", (e) => {
    if (e.jobId !== id) return; const label = stageOf(e.scope, e.name); if (!label) return;
    setStages((cur) => { const i = cur.findIndex((x) => x.label === label); const next = i >= 0 ? cur.map((x, k) => (k === i ? { ...x, done: e.phase === "done" } : x)) : e.phase === "start" ? [...cur, { label, done: false }] : cur; return next; });
  }), [bridge, id]);
  useEffect(() => { if (!(job && (job.queue !== null || job.status === "analysing"))) setStages([]); }, [job]);
  const build = async (o: { layout?: "shorter" | "anyway"; ignoreQuestions?: boolean; refreshProfile?: boolean } = {}) => { setBusy(true); setProblem(null); const r = await bridge.invoke("jobs:build", { id, layout: o.layout, ignoreQuestions: o.ignoreQuestions, refreshProfile: o.refreshProfile }); if (alive.current) { setBusy(false); if (!r.ok) setProblem(r.error.message); else if (!r.data.queued) setProblem(r.data.note ?? "This job can't be built yet. Check that your profile is complete."); else await load(); } };
  const [pickedExtra, setPickedExtra] = useState<ExtraKind | null>(null);
  const extra = async (kind: ExtraKind) => { setPickedExtra(kind); setBusy(true); setProblem(null); const r = await bridge.invoke("jobs:extra", { id, kind }); if (alive.current) { setBusy(false); if (!r.ok) setProblem(r.error.message); else await load(); } };
  const run = async (channel: "jobs:analyse" | "jobs:resume" | "jobs:skip") => { setBusy(true); setProblem(null); const r = await bridge.invoke(channel, { id }); if (alive.current) { setBusy(false); if (!r.ok) setProblem(r.error.message); else if ((r.data as { queued?: boolean }).queued === false && (r.data as { note?: string | null }).note) setProblem((r.data as { note: string }).note); else await load(); } };

  // The verdict's arrival is the one authored moment: the ring and number count up together, then the verdict, the note and the evidence settle in. A job opened from the list (no waiting seen) plays the same thing at half length.
  const articleRef = useRef<HTMLElement>(null), mode = useRef<"fresh" | "quick" | "none">("quick"), modeId = useRef(id);
  if (modeId.current !== id) { modeId.current = id; mode.current = "quick"; } // a job opened from the list: the short version
  if (job && (job.queue !== null || job.status === "analysing")) mode.current = job.build.state === "building" ? "none" : "fresh"; // a verdict that arrives after waiting: the full one; a CV build finishing: none (the verdict was already read)
  const isActive = !!job && (job.queue !== null || job.status === "analysing");
  const verdictShown = !!job && !!job.verdict && !isActive && (job.status === "analysed" || job.status === "built");
  useGSAP(() => {
    if (!verdictShown || reducedMotion() || mode.current === "none") return;
    {
      const k = mode.current === "fresh" ? 1 : 0.5, from = { clearProps: "opacity,transform" };
      gsap.timeline({ defaults: { ease: EASE } })
        .from(".reply-head", { opacity: 0, y: 6, duration: 0.3 * k, ...from })
        .from(".verdict-word", { opacity: 0, y: 10, duration: 0.45 * k, ...from }, 0.45 * k)
        .from(".verdict-word .vmark", { scale: 0.5, transformOrigin: "50% 50%", duration: 0.5 * k, ease: "back.out(2)", clearProps: "opacity,transform,transformOrigin" }, "<0.05")
        .from(".fit-text, .verdict-role, .meta", { opacity: 0, y: 8, duration: 0.4 * k, stagger: 0.06 * k, ...from }, "<0.1")
        .from(".verdict-note, .verdict-why, .verdict-actions", { opacity: 0, y: 8, duration: 0.4 * k, stagger: 0.07 * k, ...from }, "<0.12")
        .from(".lead, .job > .banner, .evidence", { opacity: 0, y: 12, duration: 0.5 * k, stagger: 0.08 * k, ...from }, ">-0.2");
    }
  }, { scope: articleRef, dependencies: [verdictShown, job?.id] });

  if (problem && !job) return <p role="alert" className="problem" data-testid="problem">{problem}</p>;
  if (job === undefined) return <p className="muted">Opening…</p>;
  if (job === null) return <Banner message={{ id: "job.missing", tone: "warn", ...STATES.missing, actions: [], details: "" }} handled={() => false} onAction={() => undefined} />;
  const active = job.queue !== null || job.status === "analysing";
  const v = job.verdict, broken = v?.rules.some((r) => r.status === "fail");
  const stateBanner = (key: "interrupted" | "needs_input" | "failed" | "skipped", actions: { id: string; label: string }[]) => <Banner message={{ id: `job.${key}`, tone: key === "skipped" ? "info" : "warn", ...STATES[key], actions, details: "" }} busy={busy} handled={() => true} onAction={(a) => void run(a === "resume" ? "jobs:resume" : a === "skip" ? "jobs:skip" : "jobs:analyse")} />;
  const headline = v?.summary || v?.fitNote || "", noteShort = headline.length > 0 && headline.length <= 160 && !headline.includes("\n"), why = v?.summary && v.fitNote && v.fitNote !== v.summary ? v.fitNote : "";
  const coachBody = job.coach ? (job.coach.replace(/^[^\n]{0,24}?(apply|long shot|skip)[^\n]{0,16}?\d{1,3}\s?%[^\n]*\n+/i, "").trim() || job.coach) : ""; // the Coach opens with "Verdict, 78%: role", which the card above already says
  const written = EXTRA_KINDS.filter(([k]) => job.extras.some((e) => e.kind === k)), shownExtra = pickedExtra ?? written[0]?.[0] ?? null, extraText = job.extras.find((e) => e.kind === shownExtra);
  return (
    <div className="job-screen">
    <article className="job" data-testid="job-detail" data-status={job.status} ref={articleRef}>
      <div className="ad-msg"><span className="ad-icon" aria-hidden="true"><Icon name={job.source === "link" ? "link" : "doc"} /></span><div className="ad-text"><h1 className="ad-title">{job.title}</h1><span className="muted small">{job.url ? "From a link you pasted." : JOB_NEW.adSource}</span></div></div>
      {problem && <p role="alert" className="problem" data-testid="problem">{problem}</p>}
      {active && (
        <section className={`card working-card${job.queue?.state === "queued" ? " is-queued" : ""}`} aria-live="polite" data-testid="working">
          <WorkingRing size={64} />
          <div className="working-text"><p className="working-line"><strong>{job.queue?.state === "queued" ? WAITING.queued(job.queue.position, job.queue.blocked) : job.build.state === "building" ? BUILD.working : WAITING.running}</strong></p>
          <p className="muted small">{job.build.state === "building" ? BUILD.usually : WAITING.usually}</p>
          {job.queue?.state !== "queued" && stages.length > 0 && <ul className="stages" data-testid="stages">{stages.map((x) => <li key={x.label} className={x.done ? "stage-done" : "stage-on"}>{x.done ? <Icon name="check" /> : <WorkingRing size={16} />}<span>{x.label}</span><span className="sr-only">{x.done ? ", done" : ", working"}</span></li>)}</ul>}</div>
        </section>
      )}
      {!active && job.status === "paused" && <section className="card paused-card">{job.pause && <Banner message={job.pause} busy={busy} handled={(a) => a === "resume"} onAction={() => void run("jobs:resume")} />}<div className="row"><Button disabled={busy} onClick={() => void run("jobs:skip")}>{CARD.skip}</Button></div></section>}
      {!active && job.status === "interrupted" && stateBanner("interrupted", [{ id: "resume", label: CARD.resume }, { id: "skip", label: CARD.skip }])}
      {!active && job.status === "needs_input" && job.build.state !== "needs_fact" && job.build.state !== "needs_layout" && stateBanner("needs_input", [{ id: "resume", label: CARD.resume }, { id: "skip", label: CARD.skip }])}
      {!active && job.status === "failed" && stateBanner("failed", [{ id: "again", label: CARD.tryAgain }, { id: "skip", label: CARD.skip }])}
      {!active && job.status === "skipped" && stateBanner("skipped", [{ id: "again", label: CARD.again }])}
      {!active && job.build.state === "needs_fact" && (
        <section className="card" data-testid="needs-fact"><h2>{BUILD.fact.title}</h2><p className="pre">{job.build.question}</p>
          <div className="row"><Button kind="primary" disabled={busy} onClick={() => void build({ refreshProfile: true })}>{BUILD.fact.added}</Button><Button disabled={busy} onClick={() => void build({ ignoreQuestions: true })}>{BUILD.fact.without}</Button>{onOpenProfile && <Button onClick={onOpenProfile}>{BUILD.fact.profile}</Button>}</div></section>
      )}
      {!active && job.build.state === "needs_layout" && (
        <section className="card" data-testid="needs-layout"><h2>{BUILD.layout.title}</h2><p>{BUILD.layout.why(capFirst(job.build.layoutWhy ?? "It runs to more than one page"))}</p>
          <div className="row"><Button kind="primary" disabled={busy} onClick={() => void build({ layout: "shorter" })}>{BUILD.layout.shorter}</Button><Button disabled={busy} onClick={() => void build({ layout: "anyway" })}>{BUILD.layout.anyway}</Button></div></section>
      )}
      {!active && job.build.state === "failed" && <Banner message={{ id: "job.build_failed", tone: "warn", ...BUILD.failed, actions: [], details: "" }} handled={() => false} onAction={() => undefined} />}
      {!active && job.build.state === "built" && (
        <section className="card built-card" data-testid="built"><div className="built-text"><h2>{BUILD.built.title}</h2><p className="muted small">{BUILD.built.versions(job.build.versions)}</p></div>
          <div className="row"><Button kind="primary" disabled={busy} onClick={() => void bridge.invoke("jobs:openPdf", { id })}>{BUILD.built.open}</Button><Button disabled={busy} onClick={() => void bridge.invoke("jobs:reveal", { id })}>{BUILD.built.reveal}</Button><Button disabled={busy} onClick={() => void build()}>{CARD.buildAgain}</Button></div></section>
      )}
      {v && !active && (job.status === "analysed" || job.status === "built") && (
        <>
          <div className="reply">
            <div className="reply-head"><span className="reply-av" aria-hidden="true"><BrandMark size={16} /></span><strong>{JOB_NEW.claude}</strong></div>
            <section className="card verdict" data-testid="verdict" data-verdict={v.verdict}>
              <div className="verdict-head">
                <FitRing fit={v.fit} verdict={v.verdict} large animate={mode.current === "fresh" ? true : mode.current === "quick" ? "quick" : false} />
                <div className="verdict-main">
                  <p className="verdict-word" data-verdict={v.verdict}><VerdictMark kind={v.verdict} label={VERDICT_WORD[v.verdict]} size={32} /><span>{VERDICT_WORD[v.verdict]}</span></p>
                  <p className="fit-text">{CARD.fit(v.fit)}</p>
                  <p className="verdict-role">{job.title}</p>
                  {[v.location, v.workMode, v.seniority, v.salary].some(Boolean) && <p className="meta">{[v.location, v.workMode, v.seniority, v.salary].filter(Boolean).map((m, i) => <span key={i}>{m}</span>)}</p>}
                </div>
              </div>
              {headline && <div className={`verdict-note${noteShort ? " is-short" : ""}`}><h2 className="sr-only">{CARD.why}</h2><p className="pre">{headline}</p></div>}
              {why && <div className="verdict-why"><h2 className="why-label">{CARD.why}</h2><p>{why}</p></div>}
              <div className="verdict-actions" data-testid="job-actions">
                {(job.build.state === "none" || job.build.state === "failed") && <Button kind={v.verdict === "skip" ? "secondary" : "primary"} disabled={busy} onClick={() => void build()} data-testid="build">{CARD.build}</Button>}
                <Button kind={v.verdict === "skip" ? "primary" : "secondary"} disabled={busy} onClick={() => void run("jobs:skip")}>{CARD.skip}</Button>
                <span className="grow" /><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void run("jobs:analyse")}>{CARD.again}</button>
              </div>
            </section>
          </div>
          <p className="lead">{JOB_NEW.lead}</p>
          {broken && <Banner message={{ id: "job.rule_broken", tone: "warn", ...CARD.breaks, actions: [], details: "" }} handled={() => false} onAction={() => undefined} />}
          {v.rules.length > 0 && (
            <section className="card evidence" data-testid="rules"><h2>{CARD.rules}</h2>
              <ul className="rows rules">{v.rules.map((r) => (
                <li key={r.rule} data-status={r.status}><div className="rb"><strong>{RULE_NAME[r.rule] ?? r.rule}</strong>{r.note && <span className="muted small">{r.note}</span>}</div><span className={`st st-${r.status}`}><Icon name={r.status === "ok" ? "check" : r.status === "fail" ? "warn" : "info"} />{r.status === "ok" ? CARD.ruleOk : r.status === "fail" ? CARD.ruleFail : CARD.ruleUnclear}</span></li>
              ))}</ul></section>
          )}
          {v.strengths.length > 0 && <section className="card evidence"><h2>{CARD.strengths}</h2><ul className="rows">{v.strengths.map((x, i) => <li key={i}><span className="row-mark good" aria-hidden="true"><Icon name="check" /></span><span className="txt">{x}</span></li>)}</ul></section>}
          {v.gaps.length > 0 && <section className="card evidence"><h2>{CARD.gaps}</h2><ul className="rows">{v.gaps.map((g, i) => <li key={i}><span className="row-mark" aria-hidden="true"><Icon name="minus" /></span><div className="txt"><strong>{g.gap}</strong>{g.handle && <p className="handle"><span className="handle-label">{CARD.handle}</span>{g.handle}</p>}</div></li>)}</ul></section>}
          {job.coach && <section className="card evidence" data-testid="coach-note"><h2>{CARD.note}</h2><p className="pre evidence-note">{coachBody}</p></section>}
          {(job.status === "analysed" || job.status === "built") && (
            <section className="card evidence extras" data-testid="extras"><h2>{BUILD.extras.title}</h2><p className="muted small extras-hint">{JOB_NEW.extrasHint}</p>
              <div className="segmented" role="group" aria-label={BUILD.extras.title}>{EXTRA_KINDS.map(([k, label]) => <button key={k} type="button" className={`seg${shownExtra === k ? " seg-on" : ""}`} aria-pressed={shownExtra === k} disabled={busy} onClick={() => { if (job.extras.some((e) => e.kind === k)) setPickedExtra(k); else void extra(k); }}>{label}{job.extras.some((e) => e.kind === k) && <span className="seg-dot" aria-hidden="true" />}</button>)}</div>
              {extraText && <ExtraItem key={extraText.kind} bridge={bridge} text={extraText.text} jobTitle={job.title} label={EXTRA_KINDS.find(([k]) => k === extraText.kind)![1]} />}
            </section>
          )}
        </>
      )}
    </article>
    {onOpen && <AdComposer bridge={bridge} onOpen={onOpen} />}
    </div>
  );
}

// One extra: read it, copy it, or edit it first and then copy it or save it as a .txt file. Edits live only in this box (they are not stored in the app); the page never sees the file path.
function ExtraItem({ bridge, text, jobTitle, label }: { bridge: CvAppBridge; text: string; jobTitle: string; label: string }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(text), [note, setNote] = useState<string | null>(null);
  useEffect(() => { setDraft(text); }, [text]);
  const shown = draft;
  const flash = (m: string) => { setNote(m); setTimeout(() => setNote((n) => (n === m ? null : n)), 2500); };
  const copy = async () => { const r = await bridge.invoke("app:copy", { text: shown }); if (r.ok) flash(BUILD.extras.copied); };
  const save = async (format: "txt" | "docx" | "pdf") => { const r = await bridge.invoke("data:saveText", { name: `${label}, ${jobTitle}`, text: shown, format }); if (!r.ok || r.data.status === "failed") flash(BUILD.extras.saveFailed); else if (r.data.status === "saved") flash(BUILD.extras.saved); };
  return (
    <div className="extra" data-testid="extra"><h3 className="label">{label}</h3>
      <div className="extra-body">{editing ? <TextArea ariaLabel={`${label}: text`} rows={8} value={draft} onChange={setDraft} /> : <p className="pre extra-text">{shown}</p>}
      <div className="extra-foot row"><Button onClick={() => void copy()}>{BUILD.extras.copy}</Button><Button onClick={() => void save("txt")} data-testid="extra-save">{BUILD.extras.save}</Button><Button onClick={() => void save("docx")} data-testid="extra-save-docx">{BUILD.extras.saveWord}</Button><Button onClick={() => void save("pdf")} data-testid="extra-save-pdf">{BUILD.extras.savePdf}</Button><Button onClick={() => setEditing(!editing)}>{editing ? BUILD.extras.doneEdit : BUILD.extras.edit}</Button>{draft !== text && !editing && <Button onClick={() => setDraft(text)}>{BUILD.extras.reset}</Button>}</div></div>
      {draft !== text && <p className="muted small">{BUILD.extras.editedNote}</p>}
      <p className="muted small" role="status">{note ?? ""}</p>
    </div>
  );
}
