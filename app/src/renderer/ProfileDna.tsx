// My profile as a "DNA" page (phase 2 of the automatic profile builder): one scrolling page, no tabs and no tick-boxes. Review cards first, then the hard facts, the experience as a timeline,
// skills as chips, studies, languages and more, and what the user wants. Every control stays a real, labelled input (quiet until hovered or focused), so keyboard use and
// screen readers work as before. Anything the user ADDS or EDITS is trusted at once; only items imported but not found word for word wait for a look (they show a "needs review" mark).
import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import type { ProfileOverview } from "../shared/contract.ts";
import { PROFILE as T } from "./profile-messages.ts";
import { Rules, YMInputs, dateProblem, list, uid, type P, type Role, type Sec } from "./Profile.tsx";
import { Button, Checkbox, Icon, Input, SelectField, TextAreaField } from "./ui.tsx";

const NavButton = ({ id, children }: { id: string; children: ReactNode }) => <button type="button" className="dna-nav-item" onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}>{children}</button>;
// One rule for every list that can hold a blank row (the same rows are left out of what is saved: see forServer in Profile.tsx). Add inserts one blank row and focuses its first box; if a blank row is
// already there, Add only focuses it; and leaving a blank row (focus going anywhere outside that row) removes it again. Moving between the boxes of one row never counts as leaving.
const focusSoon = (id: string) => { setTimeout(() => document.getElementById(id)?.focus(), 0); };
const addRow = (blank: number, count: number, idAt: (i: number) => string, push: () => void) => { if (blank >= 0) focusSoon(idAt(blank)); else { push(); focusSoon(idAt(count)); } };
const dropWhenBlank = (blank: boolean, drop: () => void) => (e: FocusEvent<HTMLElement>) => { if (!blank) return; const to = e.relatedTarget as Node | null; if (to && e.currentTarget.contains(to)) return; if (to instanceof HTMLElement && to.dataset.testid === "add-row") return; /* pressing an Add button moves focus to the existing blank row instead of removing it */ drop(); };
const blankBullet = (b: Role["bullets"][number]) => !b.text.trim() && b.tags.length === 0;
const blankRole = (r: Role) => !r.title.trim() && !r.company.trim() && !r.location.trim() && !r.start && !r.story && r.bullets.every(blankBullet);
const StatusMark = ({ verified }: { verified: boolean }) => (
  <svg className={`statusmark ${verified ? "statusmark-on" : "statusmark-off"}`} width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" strokeLinecap="round" strokeLinejoin="round">
    {verified ? <><circle cx="12" cy="12" r="11" className="sm-fill" /><path d="m7.2 12.4 3.2 3.2 6.4-6.8" className="sm-tick" strokeWidth="2" /></> : <circle cx="12" cy="12" r="10" className="sm-dash" strokeWidth="1.6" strokeDasharray="3 3.4" />}
  </svg>
);
const Mark = () => <span className="mark-review" title={T.dna.reviewMark}><Icon name="info" />{T.dna.reviewMark}</span>;
function Q({ id, label, value, onChange, type = "text", wide, placeholder, check }: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string; wide?: boolean; placeholder?: string; check?: boolean }) {
  return <div className={`q${wide ? " q-wide" : ""}`}><label htmlFor={id}>{label}{check && <span className="check-mark" data-testid="check-mark">{T.dna.checkThis}</span>}</label><input id={id} className="quiet" type={type} value={value} placeholder={placeholder} autoComplete="off" onChange={(e) => onChange(e.target.value)} /></div>;
}
const Section = ({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) => <section id={id} className="dna-sec" aria-labelledby={`${id}-h`}><header className="dna-sec-head"><h2 id={`${id}-h`}>{title}</h2>{note && <p className="muted small">{note}</p>}</header>{children}</section>;

function FactField({ id, label, value, onChange, type = "text", mark, wide, required }: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string; mark?: ReactNode; wide?: boolean; required?: boolean }) {
  const [touched, setTouched] = useState(false), miss = !!required && touched && !value.trim();
  return <div className={`q${wide ? " q-wide" : ""}`}><label htmlFor={id}>{label}{mark}</label><input id={id} className="field" type={type} value={value} autoComplete="off" aria-required={required || undefined} aria-describedby={miss ? `${id}-req` : undefined} onBlur={() => setTouched(true)} onChange={(e) => onChange(e.target.value)} />{miss && <span id={`${id}-req`} className="field-hint" data-testid="required-hint">{T.details.required}</span>}</div>;
}
function Facts({ p, edit, unchecked }: Sec & { unchecked: string[] }) {
  const i = p.identity, set = (k: keyof P["identity"]) => (v: string) => edit((d) => { (d.identity as Record<string, string>)[k] = v; }), rt = p.rules.rightToWork;
  const mark = (k: string) => (unchecked.includes(k) ? <span className="check-mark" data-testid="check-mark">{T.dna.checkThis}</span> : null);
  return (
    <div className="facts-card"><p className="facts-lock"><Icon name="lock" />{T.dna.factsNote}</p>
      <div className="facts-grid">
        <FactField id="d-name" label={T.details.name} value={i.name} onChange={set("name")} mark={mark("name")} required />
        <FactField id="d-city" label={T.details.city} value={i.city} onChange={set("city")} required />
        <FactField id="d-country" label={T.details.country} value={i.country} onChange={set("country")} required />
        <FactField id="d-email" type="email" label={T.details.email} value={i.email ?? ""} onChange={set("email")} mark={mark("email")} required />
        <FactField id="d-phone" label={T.details.phone} value={i.phone ?? ""} onChange={set("phone")} mark={mark("phone")} />
        <FactField id="d-li" label={T.details.linkedin} value={i.linkedin ?? ""} onChange={set("linkedin")} mark={mark("linkedin")} />
        <FactField id="ru-rtw" label={T.rules.rtw} value={rt.statement} onChange={(v) => edit((d) => { d.rules.rightToWork.statement = v; })} wide required />
      </div>
      <div className="q"><Checkbox id="ru-sp" label={T.rules.sponsor} checked={rt.needsSponsorship} onChange={(c) => edit((d) => { d.rules.rightToWork.needsSponsorship = c; })} /></div>
      <p className="muted small">{T.details.note}</p>
    </div>
  );
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const when = (r: Role) => { const f = (d: { y: number; m: number } | null | "present") => (d === "present" ? "now" : d ? `${MON[(d.m || 1) - 1] ?? ""} ${d.y}`.trim() : ""); const a = f(r.start), b = f(r.end); return a || b ? `${a || "?"} – ${b || "?"}` : T.dna.noDates; };
function RoleCard({ r, ri, edit, startOpen, focus }: { r: Role; ri: number; edit: Sec["edit"]; startOpen: boolean; focus: { ids: string[]; n: number } | null }) {
  const [open, setOpen] = useState(startOpen), body = `role-body-${ri}`, n = r.bullets.length, li = useRef<HTMLLIElement>(null);
  useEffect(() => { if (focus?.ids.includes(r.id)) { setOpen(true); if (focus.ids[0] === r.id) setTimeout(() => li.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); } }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <li ref={li} className="tl-item" data-testid="role" onBlur={dropWhenBlank(blankRole(r), () => edit((d) => { const x = d.roles.find((q) => q.id === r.id); if (x && blankRole(x)) d.roles.splice(d.roles.indexOf(x), 1); }))}><span className="tl-dot" aria-hidden="true" />
      <article className={`tl-card${open ? " tl-open" : ""}`}>
        <button type="button" className="tl-toggle" aria-expanded={open} aria-controls={body} onClick={() => setOpen(!open)}>
          <span className="tl-sum"><strong>{r.title || T.dna.untitled}</strong>{r.company ? <span className="muted"> · {r.company}</span> : null}</span>
          <span className="tl-when-sum muted">{when(r)}</span>
          <span className="tl-count muted">{T.dna.achievements(n)}</span>
          {r.status === "draft" && <Mark />}<Icon name="chevron" />
        </button>
        <div id={body} className="tl-body" hidden={!open}>
        <header className="tl-head">
          <p className="sentence">{T.dna.iWorkAs} <Input id={`r${ri}-t`} ariaLabel={T.roles.title} placeholder={T.roles.title} value={r.title} onChange={(v) => edit((d) => { d.roles[ri].title = v; d.roles[ri].status = "verified"; })} /> {T.dna.at} <Input id={`r${ri}-c`} ariaLabel={T.roles.company} placeholder={T.roles.company} value={r.company} onChange={(v) => edit((d) => { d.roles[ri].company = v; d.roles[ri].status = "verified"; })} />.</p>
        </header>
        <div className="tl-when">
          <YMInputs id={`r${ri}-s`} label={T.roles.startY} v={r.start} onChange={(v) => edit((d) => { d.roles[ri].start = v; })} />
          {r.end !== "present" && <YMInputs id={`r${ri}-e`} label={T.roles.endY} v={r.end as P["roles"][number]["start"]} onChange={(v) => edit((d) => { d.roles[ri].end = v; })} />}
          <Checkbox id={`r${ri}-cur`} label={T.roles.current} checked={r.end === "present"} onChange={(c) => edit((d) => { d.roles[ri].end = c ? "present" : null; })} />
          <Q id={`r${ri}-l`} label={T.roles.location} value={r.location} onChange={(v) => edit((d) => { d.roles[ri].location = v; })} />
        </div>
        {dateProblem(r) && <p role="alert" className="problem small" data-testid="date-problem">{dateProblem(r)}</p>}
        <ul className="ach-list">
          {r.bullets.map((b, bi) => (
            <li key={b.id} className="ach" data-testid="bullet" onBlur={dropWhenBlank(blankBullet(b), () => edit((d) => { const x = d.roles[ri]?.bullets.find((q) => q.id === b.id); if (x && blankBullet(x)) d.roles[ri].bullets.splice(d.roles[ri].bullets.indexOf(x), 1); }))}>
              <div className="ach-text"><StatusMark verified={b.status !== "draft"} /><TextAreaField id={`b-${b.id}`} label={T.roles.bulletHint} srOnlyLabel rows={2} placeholder={T.roles.bulletHint} value={b.text} onChange={(v) => edit((d) => { d.roles[ri].bullets[bi].text = v; d.roles[ri].bullets[bi].status = "verified"; })} />{b.status === "draft" ? <Mark /> : <span className="ach-tag" aria-hidden="true">{T.dna.stats.verifiedTag}</span>}</div>
              <div className="ach-more">
                <div className="q"><label htmlFor={`bt-${b.id}`}>{T.roles.tags}</label><input id={`bt-${b.id}`} className="quiet" value={b.tags.join(", ")} autoComplete="off" onChange={(e) => edit((d) => { d.roles[ri].bullets[bi].tags = list(e.target.value); })} /></div>
                <Button onClick={() => edit((d) => { d.roles[ri].bullets.splice(bi, 1); })}>{T.roles.removeBullet}</Button>
              </div>
            </li>
          ))}
        </ul>
        {r.story && <TextAreaField id={`r${ri}-st`} label={T.roles.story} rows={3} value={r.story.text} onChange={(v) => edit((d) => { if (!v.trim()) delete d.roles[ri].story; else d.roles[ri].story = { text: v, status: "verified" }; })} />}
        <div className="row"><Button data-testid="add-row" onClick={() => { const blank = r.bullets.findIndex(blankBullet), nid = uid("b"); if (blank >= 0) focusSoon(`b-${r.bullets[blank].id}`); else { edit((d) => { d.roles[ri].bullets.push({ id: nid, text: "", tags: [], status: "verified" }); }); focusSoon(`b-${nid}`); } }}>{T.roles.addBullet}</Button>{!r.story && <Button onClick={() => edit((d) => { d.roles[ri].story = { text: " ", status: "verified" }; })}>{T.dna.addStory}</Button>}<Button onClick={() => edit((d) => { d.roles.splice(ri, 1); })}>{T.roles.remove}</Button></div>
        </div>
      </article>
    </li>
  );
}

// Skills are a plain wrapping list of chips. The group a skill was stored under (and anything else the page does not show) stays in the data untouched.
function Skills({ p, edit }: Sec) {
  const blank = p.skills.findIndex((s) => !s.name.trim());
  return (
    <div className="skills">{p.skills.length === 0 && <p className="muted">{T.skills.empty}</p>}
      {p.skills.length > 0 && <ul className="chips" data-testid="skills-list">{p.skills.map((s, i) => (
        <li key={i} className={`chip${s.status === "draft" ? " chip-review" : ""}`} data-testid="skill" onBlur={dropWhenBlank(!s.name.trim(), () => edit((d) => { if (d.skills[i] && !d.skills[i].name.trim()) d.skills.splice(i, 1); }))}>
          <input id={`s${i}-n`} className="quiet" aria-label={T.skills.name} size={Math.max(6, s.name.length + 1)} value={s.name} autoComplete="off" onChange={(e) => edit((d) => { d.skills[i].name = e.target.value; d.skills[i].status = "verified"; })} />
          <button type="button" className="chip-x" aria-label={`${T.dna.removeSkill}: ${s.name || T.skills.name}`} onClick={() => edit((d) => { d.skills.splice(i, 1); })}><Icon name="close" /></button>
        </li>))}</ul>}
      <div className="row"><Button data-testid="add-row" onClick={() => addRow(blank, p.skills.length, (i) => `s${i}-n`, () => edit((d) => { d.skills.push({ name: "", status: "verified" }); }))}>{T.skills.add}</Button></div>
    </div>
  );
}

const LEVELS = ["native", "fluent", "professional", "basic"] as const;
const blankCert = (c: NonNullable<P["extras"]>["certifications"][number]) => !c.name.trim() && !c.issuer?.trim() && c.year === undefined;
const blankProject = (j: NonNullable<P["extras"]>["projects"][number]) => !j.name.trim() && !j.text.trim();
function ExtrasBlock({ p, edit }: Sec) {
  const X = T.dna.extras, ex = p.extras ?? { languages: [], certifications: [], projects: [] };
  const upd = (fn: (x: NonNullable<P["extras"]>) => void) => edit((d) => { d.extras ??= { languages: [], certifications: [], projects: [] }; fn(d.extras); });
  return (
    <div className="extras">
      <h3 className="skill-group-name">{X.languages}</h3>
      {ex.languages.length === 0 && <p className="muted">{X.empty}</p>}
      <ul className="plain">{ex.languages.map((l, i) => <li key={l.id} className="study" data-testid="language" onBlur={dropWhenBlank(!l.name.trim(), () => upd((x) => { x.languages = x.languages.filter((q) => q.id !== l.id || q.name.trim()); }))}><Input id={`xl${i}`} ariaLabel={X.language} placeholder={X.language} value={l.name} onChange={(v) => upd((x) => { x.languages[i].name = v; x.languages[i].status = "verified"; })} /><SelectField id={`xl${i}-v`} label={X.level} srOnlyLabel value={l.level} onChange={(v) => upd((x) => { x.languages[i].level = v as (typeof LEVELS)[number]; x.languages[i].status = "verified"; })} options={LEVELS.map((v) => ({ value: v, label: X.levels[v] }))} /><Button onClick={() => upd((x) => { x.languages.splice(i, 1); })}>{X.remove}</Button></li>)}</ul>
      <div className="row"><Button data-testid="add-row" onClick={() => addRow(ex.languages.findIndex((l) => !l.name.trim()), ex.languages.length, (i) => `xl${i}`, () => upd((x) => { x.languages.push({ id: uid("l"), name: "", level: "fluent", status: "verified" }); }))}>{X.addLanguage}</Button></div>
      <h3 className="skill-group-name">{X.certs}</h3>
      {ex.certifications.length === 0 && <p className="muted">{X.empty}</p>}
      <ul className="plain">{ex.certifications.map((c, i) => <li key={c.id} className="study" data-testid="certificate" onBlur={dropWhenBlank(blankCert(c), () => upd((x) => { x.certifications = x.certifications.filter((q) => q.id !== c.id || !blankCert(q)); }))}><Input id={`xc${i}`} ariaLabel={X.certName} placeholder={X.certName} value={c.name} onChange={(v) => upd((x) => { x.certifications[i].name = v; x.certifications[i].status = "verified"; })} /><Input id={`xc${i}-i`} ariaLabel={X.issuer} placeholder={X.issuer} value={c.issuer ?? ""} onChange={(v) => upd((x) => { if (v) x.certifications[i].issuer = v; else delete x.certifications[i].issuer; x.certifications[i].status = "verified"; })} /><Input id={`xc${i}-y`} ariaLabel={X.year} placeholder={X.yearShort} narrow type="number" min={1950} max={2100} value={c.year ?? ""} onChange={(v) => upd((x) => { if (v === "") delete x.certifications[i].year; else x.certifications[i].year = Number(v); x.certifications[i].status = "verified"; })} /><Button onClick={() => upd((x) => { x.certifications.splice(i, 1); })}>{X.remove}</Button></li>)}</ul>
      <div className="row"><Button data-testid="add-row" onClick={() => addRow(ex.certifications.findIndex(blankCert), ex.certifications.length, (i) => `xc${i}`, () => upd((x) => { x.certifications.push({ id: uid("c"), name: "", status: "verified" }); }))}>{X.addCert}</Button></div>
      <h3 className="skill-group-name">{X.projects}</h3>
      {ex.projects.length === 0 && <p className="muted">{X.empty}</p>}
      <ul className="plain">{ex.projects.map((j, i) => <li key={j.id} className="study study-tall" data-testid="project" onBlur={dropWhenBlank(blankProject(j), () => upd((x) => { x.projects = x.projects.filter((q) => q.id !== j.id || !blankProject(q)); }))}><Input id={`xp${i}`} ariaLabel={X.projectName} placeholder={X.projectName} value={j.name} onChange={(v) => upd((x) => { x.projects[i].name = v; x.projects[i].status = "verified"; })} /><TextAreaField id={`xp${i}-t`} label={X.projectText} srOnlyLabel placeholder={X.projectText} rows={2} value={j.text} onChange={(v) => upd((x) => { x.projects[i].text = v; x.projects[i].status = "verified"; })} /><Button onClick={() => upd((x) => { x.projects.splice(i, 1); })}>{X.remove}</Button></li>)}</ul>
      <div className="row"><Button data-testid="add-row" onClick={() => addRow(ex.projects.findIndex(blankProject), ex.projects.length, (i) => `xp${i}`, () => upd((x) => { x.projects.push({ id: uid("j"), name: "", text: "", status: "verified" }); }))}>{X.addProject}</Button></div>
    </div>
  );
}
function Studies({ p, edit }: Sec) {
  return (
    <div className="studies">{p.education.length === 0 && <p className="muted">{T.education.empty}</p>}
      <ul className="plain">{p.education.map((e, i) => <li key={e.id} className="study" data-testid="education" onBlur={dropWhenBlank(!e.text.trim(), () => edit((d) => { d.education = d.education.filter((x) => x.id !== e.id || x.text.trim()); }))}><Input id={`e${i}`} ariaLabel={T.education.text} value={e.text} onChange={(v) => edit((d) => { d.education[i].text = v; d.education[i].status = "verified"; })} />{e.status === "draft" && <Mark />}<Button onClick={() => edit((d) => { d.education.splice(i, 1); })}>{T.roles.removeBullet}</Button></li>)}</ul>
      <div className="row"><Button data-testid="add-row" onClick={() => addRow(p.education.findIndex((e) => !e.text.trim()), p.education.length, (i) => `e${i}`, () => edit((d) => { d.education.push({ id: uid("e"), text: "", status: "verified" }); }))}>{T.education.add}</Button></div>
    </div>
  );
}

export function Dna({ p, edit, importSlot, overview, onCard }: { p: P; edit: Sec["edit"]; importSlot: ReactNode; overview: ProfileOverview; onCard: (key: string, action: "accept" | "dismiss" | "merge") => void }) {
  const cards = overview.cards, [focus, setFocus] = useState<{ ids: string[]; n: number } | null>(null);
  const roleIdsOf = (ids: string[]) => [...new Set(ids.map((id) => p.roles.find((r) => r.id === id || r.bullets.some((b) => b.id === id))?.id).filter((x): x is string => !!x))];
  const bullets = p.roles.reduce((n, r) => n + r.bullets.length, 0);
  const X = p.extras ?? { languages: [], certifications: [], projects: [] };
  const facts = [...p.roles, ...p.roles.flatMap((r) => r.bullets), ...p.skills, ...p.education, ...X.languages, ...X.certifications, ...X.projects];
  const empty = p.roles.length === 0 && !p.identity.name.trim();
  const verified = facts.filter((f) => f.status === "verified").length, toCheck = facts.length - verified, S = T.dna.stats;
  return (
    <div className="dna">
      <p className="sr-only" data-testid="dna-summary">{T.dna.summary(p.roles.length, bullets, p.skills.length)}</p>
      <section className="dna-stats" aria-label={S.label} data-testid="dna-stats">
        <div><b>{verified}</b><span>{S.verified}</span></div><div><b>{toCheck}</b><span>{S.check}</span></div>
      </section>
      <p className="dna-legend" aria-hidden="true"><span><StatusMark verified />{S.legendVerified}</span><span><StatusMark verified={false} />{S.legendCheck}</span></p>
      {empty && <div className="dna-import">{importSlot}</div>}
      {cards.length > 0 && (
        <Section id="dna-review" title={T.dna.review} note={T.dna.reviewNote}>
          <ul className="review-cards">{cards.map((c) => <li key={c.key} className="review-card" data-testid="review-card" data-kind={c.kind}><Icon name="info" /><p>{c.message}</p><div className="row">{c.options.includes("accept") && <Button kind="primary" onClick={() => onCard(c.key, "accept")}>{c.kind === "locked-check" ? T.dna.confirm : T.dna.accept}</Button>}{c.options.includes("merge") && <Button kind="primary" onClick={() => onCard(c.key, "merge")}>{T.dna.merge}</Button>}{c.options.includes("edit") && roleIdsOf(c.factIds ?? []).length > 0 && <Button kind={c.kind === "overlap" ? "primary" : undefined} onClick={() => setFocus({ ids: roleIdsOf(c.factIds ?? []), n: (focus?.n ?? 0) + 1 })}>{T.dna.editBtn[c.kind] ?? "Edit"}</Button>}{c.options.includes("dismiss") && <Button onClick={() => onCard(c.key, "dismiss")}>{c.kind === "overlap" ? T.dna.keepBoth : T.dna.dismiss}</Button>}</div></li>)}</ul>
        </Section>
      )}
      <nav className="dna-nav" aria-label={T.dna.navLabel}>
        {cards.length > 0 && <NavButton id="dna-review">{T.dna.review} ({cards.length})</NavButton>}
        <NavButton id="dna-facts">{T.dna.facts}</NavButton><NavButton id="dna-experience">{T.dna.experience}</NavButton><NavButton id="dna-skills">{T.dna.skills}</NavButton><NavButton id="dna-studies">{T.dna.studies}</NavButton><NavButton id="dna-extras">{T.dna.extras.nav}</NavButton>
        <NavButton id="dna-wants">{T.dna.wants}</NavButton>
      </nav>
      <Section id="dna-facts" title={T.dna.facts}><Facts p={p} edit={edit} unchecked={overview.unchecked} /></Section>
      <Section id="dna-experience" title={T.dna.experience} note={p.roles.length === 0 ? T.roles.empty : undefined}>
        <ol className="timeline">{p.roles.map((r, ri) => <RoleCard key={r.id} r={r} ri={ri} edit={edit} focus={focus} startOpen={ri === 0 || p.roles.length <= 2 || !r.title} />)}</ol>
        <div className="row"><Button data-testid="add-row" onClick={() => addRow(p.roles.findIndex(blankRole), p.roles.length, (i) => `r${i}-t`, () => edit((d) => { d.roles.push({ id: uid("r"), title: "", company: "", location: "", start: null, end: "present", status: "verified", bullets: [] }); }))}>{T.roles.add}</Button></div>
      </Section>
      <Section id="dna-skills" title={T.dna.skills}><Skills p={p} edit={edit} /></Section>
      <Section id="dna-studies" title={T.dna.studies}><Studies p={p} edit={edit} /></Section>
      <Section id="dna-extras" title={T.dna.extras.title} note={T.dna.extras.note}><ExtrasBlock p={p} edit={edit} /></Section>
      <Section id="dna-wants" title={T.dna.wants}><div className="dna-card"><Rules p={p} edit={edit} /></div></Section>
      {!empty && <div className="dna-import">{importSlot}</div>}
    </div>
  );
}
