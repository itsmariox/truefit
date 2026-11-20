// "Start from scratch" (first run): one short screen per thing a CV needs to pass an applicant-tracking system and to meet the app's start gate (see engine/src/profile.ts, meetsStartGate,
// and engine/src/cv/ats.ts): name and place, contact, each job with at least 3 achievements, skills, education, languages and certificates, where to work, and the right to work.
// Plain fields with hints, suggestions and dictation. Nothing here goes to Claude: it is saved straight into the profile on this Mac. The person may leave at any time ("finish later");
// whatever is complete is saved and the profile page shows what is still missing.
import { useState } from "react";
import type { CvAppBridge } from "../shared/contract.ts";
import { DictBox } from "./Dictate.tsx";
import { emptyProfile, list, uid, type P } from "./Profile.tsx";
import { ONBOARDING as T } from "./onboarding-messages.ts";
import { Button, Checkbox, Field, SelectField } from "./ui.tsx";

const W = T.wizard, MIN_WINS = 3, MIN_SKILLS = 3, MODES = ["onsite", "hybrid", "remote"] as const, LEVELS = ["native", "fluent", "professional", "basic"] as const;
type Level = (typeof LEVELS)[number]; type Mode = (typeof MODES)[number];
type Job = { title: string; company: string; location: string; sm: string; sy: string; em: string; ey: string; current: boolean; wins: string[] };
type D = { name: string; city: string; country: string; email: string; phone: string; linkedin: string; jobs: Job[]; skills: string[]; edu: string[]; langs: { name: string; level: Level }[]; certs: string[]; loc: string; modes: Mode[]; targets: string; rtw: string; sponsor: boolean };
const newJob = (): Job => ({ title: "", company: "", location: "", sm: "", sy: "", em: "", ey: "", current: true, wins: [] });
const blank = (): D => ({ name: "", city: "", country: "", email: "", phone: "", linkedin: "", jobs: [newJob()], skills: [], edu: [], langs: [], certs: [], loc: "", modes: [], targets: "", rtw: "", sponsor: false });
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ymOk = (m: string, y: string) => { const mm = Number(m), yy = Number(y); return Number.isInteger(mm) && mm >= 1 && mm <= 12 && Number.isInteger(yy) && yy >= 1950 && yy <= 2100; };
const jobOk = (j: Job) => !!j.title.trim() && !!j.company.trim() && ymOk(j.sm, j.sy) && (j.current || (ymOk(j.em, j.ey) && Number(j.ey) * 12 + Number(j.em) >= Number(j.sy) * 12 + Number(j.sm)));
const dateBad = (j: Job) => ymOk(j.sm, j.sy) && !j.current && ymOk(j.em, j.ey) && Number(j.ey) * 12 + Number(j.em) < Number(j.sy) * 12 + Number(j.sm);

// Only what is complete is saved: a job without a title, employer and valid start date is left out (the engine refuses undated roles).
export function toProfile(d: D): P {
  const p = emptyProfile(), loc = d.loc.trim() || d.city.trim();
  p.identity = { name: d.name.trim(), city: d.city.trim(), country: d.country.trim(), ...(d.email.trim() ? { email: d.email.trim() } : {}), ...(d.phone.trim() ? { phone: d.phone.trim() } : {}), ...(d.linkedin.trim() ? { linkedin: d.linkedin.trim() } : {}) };
  p.roles = d.jobs.filter(jobOk).map((j) => ({ id: uid("r"), title: j.title.trim(), company: j.company.trim(), location: j.location.trim(), start: { y: Number(j.sy), m: Number(j.sm) }, end: j.current ? ("present" as const) : { y: Number(j.ey), m: Number(j.em) }, status: "verified" as const, bullets: j.wins.map((t) => ({ id: uid("b"), text: t, tags: [], status: "verified" as const })) }));
  p.skills = d.skills.map((name) => ({ name, status: "verified" as const }));
  p.education = d.edu.map((text) => ({ id: uid("e"), text, status: "verified" as const }));
  if (d.langs.length || d.certs.length) p.extras = { languages: d.langs.map((l) => ({ id: uid("l"), name: l.name, level: l.level, status: "verified" as const })), certifications: d.certs.map((name) => ({ id: uid("c"), name, status: "verified" as const })), projects: [] };
  p.rules.location = { current: loc, targets: list(d.targets), workModes: d.modes, cvLocationLines: d.city.trim() ? [[d.city.trim(), d.country.trim()].filter(Boolean).join(", ")] : [] };
  p.rules.rightToWork = { statement: d.rtw.trim(), needsSponsorship: d.sponsor };
  return p;
}

const Chip = ({ on, onClick, children, testid }: { on?: boolean; onClick: () => void; children: string; testid?: string }) => <button type="button" className={`chip${on ? " chip-on" : ""}`} aria-pressed={on === undefined ? undefined : on} onClick={onClick} data-testid={testid}>{children}</button>;
const Items = ({ items, onRemove, label }: { items: string[]; onRemove: (i: number) => void; label: string }) => items.length === 0 ? null : <ul className="wiz-items">{items.map((t, i) => <li key={`${t}${i}`}><span>{t}</span><button type="button" className="wiz-x" onClick={() => onRemove(i)} aria-label={`${label}: ${t}`}>×</button></li>)}</ul>;

export function Wizard({ bridge, onSave, onBack }: { bridge: CvAppBridge; onSave: () => void; onBack: () => void }) {
  const [d, setD] = useState<D>(blank), [i, setI] = useState(0), [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null), [draft, setDraft] = useState(""), [lang, setLang] = useState(""), [level, setLevel] = useState<Level>("fluent");
  const set = (patch: Partial<D>) => setD((x) => ({ ...x, ...patch })), setJob = (n: number, patch: Partial<Job>) => setD((x) => ({ ...x, jobs: x.jobs.map((j, k) => (k === n ? { ...j, ...patch } : j)) }));
  const steps = ["you", "contact", ...d.jobs.flatMap((_, n) => [`job${n}`, `wins${n}`]), "more", "skills", "edu", "extras", "where", "rtw"], key = steps[i], n = key.startsWith("job") || key.startsWith("wins") ? Number(key.replace(/\D/g, "")) : 0, job = d.jobs[n], last = i === steps.length - 1;
  const valid: Record<string, boolean> = { you: !!(d.name.trim() && d.city.trim() && d.country.trim()), contact: /\S+@\S+\.\S+/.test(d.email.trim()), more: true, skills: d.skills.length >= MIN_SKILLS, edu: true, extras: true, where: !!((d.loc.trim() || d.city.trim()) && d.modes.length), rtw: !!d.rtw.trim() };
  const ok = key.startsWith("job") ? jobOk(job) : key.startsWith("wins") ? job.wins.length >= MIN_WINS : valid[key];
  const go = (to: number) => { setProblem(null); setDraft(""); setI(to); };
  const save = async (partial: boolean) => {
    setBusy(true); setProblem(null);
    if (partial && !(d.name.trim() && d.city.trim())) { setBusy(false); onSave(); return; } // nothing worth saving yet: just finish the guide
    const have = await bridge.invoke("profile:get"); // the guide can be replayed from Settings: never replace a profile that already exists
    if (have.ok && have.data.status === "ok") { setBusy(false); if (partial) onSave(); else setProblem(W.exists); return; }
    const r = await bridge.invoke("profile:save", { profile: toProfile(d) as unknown as Record<string, unknown>, baseUpdatedAt: undefined }); setBusy(false);
    if (!r.ok) { setProblem(r.error.message); return; }
    if (!r.data.ok) { setProblem(`${W.saveFailed} ${r.data.errors.join(" ")}`); return; }
    onSave();
  };
  const addWin = () => { const t = draft.trim(); if (t) { setJob(n, { wins: [...job.wins, t] }); setDraft(""); } };
  const addSkills = (raw: string) => { const add = raw.split(/,|\band\b|;/i).map((s) => s.trim().replace(/\.$/, "")).filter(Boolean).filter((s) => !d.skills.some((x) => x.toLowerCase() === s.toLowerCase())); if (add.length) set({ skills: [...d.skills, ...add] }); setDraft(""); };
  const addEdu = () => { const t = draft.trim(); if (t) { set({ edu: [...d.edu, t] }); setDraft(""); } };
  const nextOrSave = () => (last ? void save(false) : go(i + 1));
  const addJob = () => { setD((x) => ({ ...x, jobs: [...x.jobs, newJob()] })); setProblem(null); setDraft(""); setI(2 + d.jobs.length * 2); };
  return (
    <section className="ob-wizard" data-testid="wizard" data-step={key}>
      <p className="muted small" data-testid="wiz-progress">{W.stepOf(i + 1, steps.length)}</p>
      {key === "you" && <><h1 className="ob-title">{W.you.title}</h1><p className="ob-body">{W.you.body}</p>
        <Field id="w-name" label={W.you.name} value={d.name} placeholder={W.you.ph.name} autoComplete="name" onChange={(v) => set({ name: v })} />
        <Field id="w-city" label={W.you.city} value={d.city} placeholder={W.you.ph.city} hint={W.you.cityHint} onChange={(v) => set({ city: v })} />
        <Field id="w-country" label={W.you.country} value={d.country} placeholder={W.you.ph.country} onChange={(v) => set({ country: v })} /></>}
      {key === "contact" && <><h1 className="ob-title">{W.contact.title}</h1><p className="ob-body">{W.contact.body}</p>
        <Field id="w-email" label={W.contact.email} type="email" value={d.email} placeholder={W.contact.ph.email} hint={W.contact.emailHint} autoComplete="email" onChange={(v) => set({ email: v })} />
        <Field id="w-phone" label={`${W.contact.phone} (${W.optional.toLowerCase()})`} type="tel" value={d.phone} placeholder={W.contact.ph.phone} autoComplete="tel" onChange={(v) => set({ phone: v })} />
        <Field id="w-linkedin" label={W.contact.linkedin} value={d.linkedin} placeholder={W.contact.ph.linkedin} hint={W.contact.linkedinHint} onChange={(v) => set({ linkedin: v })} /></>}
      {key.startsWith("job") && <><h1 className="ob-title">{d.jobs.length === 1 && n === 0 ? W.job.title : W.job.titleN(n + 1)}</h1><p className="ob-body">{W.job.body}</p>
        <DictBox bridge={bridge} id="w-title" label={W.job.jobTitle} hint={W.job.hint} value={job.title} placeholder={W.job.ph.title} onChange={(v) => setJob(n, { title: v })} />
        <DictBox bridge={bridge} id="w-company" label={W.job.company} value={job.company} placeholder={W.job.ph.company} onChange={(v) => setJob(n, { company: v })} />
        <Field id="w-jloc" label={`${W.job.location} (${W.optional.toLowerCase()})`} value={job.location} placeholder={W.job.ph.location} onChange={(v) => setJob(n, { location: v })} />
        <div className="wiz-dates"><SelectField id="w-sm" label={`${W.job.from}: ${W.job.month.toLowerCase()}`} value={job.sm} onChange={(v) => setJob(n, { sm: v })} options={[{ value: "", label: W.job.month }, ...MONTHS.map((m, k) => ({ value: String(k + 1), label: m }))]} /><Field id="w-sy" label={`${W.job.from}: ${W.job.year.toLowerCase()}`} type="number" value={job.sy} min={1950} max={2100} placeholder="2021" onChange={(v) => setJob(n, { sy: v })} /></div>
        <Checkbox id="w-current" label={W.job.current} checked={job.current} onChange={(v) => setJob(n, { current: v })} />
        {!job.current && <div className="wiz-dates"><SelectField id="w-em" label={`${W.job.to}: ${W.job.month.toLowerCase()}`} value={job.em} onChange={(v) => setJob(n, { em: v })} options={[{ value: "", label: W.job.month }, ...MONTHS.map((m, k) => ({ value: String(k + 1), label: m }))]} /><Field id="w-ey" label={`${W.job.to}: ${W.job.year.toLowerCase()}`} type="number" value={job.ey} min={1950} max={2100} placeholder="2023" onChange={(v) => setJob(n, { ey: v })} /></div>}
        {dateBad(job) && <p className="problem" role="alert">{W.job.dateBad}</p>}</>}
      {key.startsWith("wins") && <><h1 className="ob-title">{W.wins.title}</h1><p className="ob-body">{W.wins.body}</p><p className="muted small"><strong>{job.title}</strong>{job.company ? `, ${job.company}` : ""}</p>
        <ul className="wiz-hints">{W.wins.hints.map((h) => <li key={h}>{h}</li>)}</ul>
        <DictBox bridge={bridge} id="w-win" label={W.wins.label} rows={3} value={draft} placeholder={`e.g. ${W.wins.examples[job.wins.length % W.wins.examples.length]}`} onChange={setDraft} />
        <div className="row"><Button onClick={addWin} disabled={!draft.trim()} data-testid="wiz-add-win">{W.wins.add}</Button><span className="muted small" role="status" data-testid="wiz-win-count">{W.wins.of(job.wins.length, MIN_WINS)}</span></div>
        <Items items={job.wins} label={W.wins.remove} onRemove={(k) => setJob(n, { wins: job.wins.filter((_, x) => x !== k) })} /></>}
      {key === "more" && <><h1 className="ob-title">{W.more.title}</h1><p className="ob-body">{W.more.body}</p>
        <p className="muted small">{W.more.have}</p><ul className="wiz-items">{d.jobs.filter(jobOk).map((j, k) => <li key={k}><span>{j.title}, {j.company}</span></li>)}</ul>
        <div className="row"><Button onClick={addJob} data-testid="wiz-add-job">{W.more.add}</Button></div></>}
      {key === "skills" && <><h1 className="ob-title">{W.skills.title}</h1><p className="ob-body">{W.skills.body}</p>
        <DictBox bridge={bridge} id="w-skill" label={W.skills.label} value={draft} placeholder={W.skills.ph} onChange={setDraft} onEnter={() => addSkills(draft)} />
        <div className="row"><Button onClick={() => addSkills(draft)} disabled={!draft.trim()} data-testid="wiz-add-skill">{W.skills.add}</Button><span className="muted small" role="status">{W.skills.count(d.skills.length)}</span></div>
        <p className="muted small">{W.skills.suggest}</p><div className="wiz-chips">{W.skills.suggestions.filter((s) => !d.skills.some((x) => x.toLowerCase() === s.toLowerCase())).map((s) => <Chip key={s} onClick={() => addSkills(s)}>{s}</Chip>)}</div>
        <Items items={d.skills} label={W.skills.remove} onRemove={(k) => set({ skills: d.skills.filter((_, x) => x !== k) })} /></>}
      {key === "edu" && <><h1 className="ob-title">{W.edu.title}</h1><p className="ob-body">{W.edu.body}</p>
        <DictBox bridge={bridge} id="w-edu" label={W.edu.label} value={draft} placeholder={W.edu.ph} onChange={setDraft} onEnter={addEdu} /><span className="field-hint">{W.edu.hint}</span>
        <div className="row"><Button onClick={addEdu} disabled={!draft.trim()} data-testid="wiz-add-edu">{W.edu.add}</Button></div>
        <Items items={d.edu} label={W.edu.remove} onRemove={(k) => set({ edu: d.edu.filter((_, x) => x !== k) })} /></>}
      {key === "extras" && <><h1 className="ob-title">{W.extras.title}</h1><p className="ob-body">{W.extras.body}</p>
        <div className="wiz-dates"><Field id="w-lang" label={W.extras.lang} value={lang} placeholder={W.extras.langPh} onChange={setLang} /><SelectField id="w-level" label={W.extras.level} value={level} onChange={(v) => setLevel(v as Level)} options={LEVELS.map((l) => ({ value: l, label: W.extras.levels[l] }))} /></div>
        <div className="row"><Button onClick={() => { if (lang.trim()) { set({ langs: [...d.langs, { name: lang.trim(), level }] }); setLang(""); } }} disabled={!lang.trim()} data-testid="wiz-add-lang">{W.extras.addLang}</Button></div>
        <Items items={d.langs.map((l) => `${l.name} (${W.extras.levels[l.level]})`)} label={W.extras.remove} onRemove={(k) => set({ langs: d.langs.filter((_, x) => x !== k) })} />
        <Field id="w-cert" label={W.extras.cert} value={draft} placeholder={W.extras.certPh} onChange={setDraft} />
        <div className="row"><Button onClick={() => { if (draft.trim()) { set({ certs: [...d.certs, draft.trim()] }); setDraft(""); } }} disabled={!draft.trim()} data-testid="wiz-add-cert">{W.extras.addCert}</Button></div>
        <Items items={d.certs} label={W.extras.remove} onRemove={(k) => set({ certs: d.certs.filter((_, x) => x !== k) })} /></>}
      {key === "where" && <><h1 className="ob-title">{W.where.title}</h1><p className="ob-body">{W.where.body}</p>
        <Field id="w-loc" label={W.where.current} value={d.loc || d.city} onChange={(v) => set({ loc: v })} />
        <div className="field-row"><span className="label" id="w-modes">{W.where.modes}</span><div className="wiz-chips" role="group" aria-labelledby="w-modes">{MODES.map((m) => <Chip key={m} on={d.modes.includes(m)} testid={`mode-${m}`} onClick={() => set({ modes: d.modes.includes(m) ? d.modes.filter((x) => x !== m) : [...d.modes, m] })}>{W.where.modeLabels[m]}</Chip>)}</div></div>
        <Field id="w-targets" label={W.where.targets} value={d.targets} placeholder={W.where.targetsPh} hint={W.where.targetsHint} onChange={(v) => set({ targets: v })} /></>}
      {key === "rtw" && <><h1 className="ob-title">{W.rtw.title}</h1><p className="ob-body">{W.rtw.body}</p>
        <Field id="w-rtw" label={W.rtw.label} value={d.rtw} placeholder={W.rtw.ph} hint={W.rtw.hint} onChange={(v) => set({ rtw: v })} />
        <p className="muted small">{W.rtw.suggest}</p><div className="wiz-chips">{W.rtw.suggestions.map((s) => <Chip key={s} on={d.rtw === s} onClick={() => set({ rtw: s })}>{s}</Chip>)}</div>
        <Checkbox id="w-sponsor" label={W.rtw.sponsor} checked={d.sponsor} onChange={(v) => set({ sponsor: v })} /></>}
      {problem && <p role="alert" className="problem" data-testid="wiz-problem">{problem}</p>}
      <p className="muted small">{W.privacy}</p>
      <div className="wiz-nav">
        <Button disabled={busy} onClick={() => (i === 0 ? onBack() : go(i - 1))} data-testid="wiz-back">{W.back}</Button>
        <div className="wiz-nav-right"><Button disabled={busy} onClick={() => void save(true)} data-testid="wiz-later">{W.later}</Button><Button kind="primary" disabled={busy || !ok} onClick={nextOrSave} data-testid="wiz-next">{busy ? W.saving : last ? W.finish : W.next}</Button></div>
      </div>
    </section>
  );
}
