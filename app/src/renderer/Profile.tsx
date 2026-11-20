// My profile (phase 5): five plain sections plus Do not use and a Review mode (PRD 02). The page edits a copy of the whole profile and sends it to the main process, which runs the
// engine's own validator and start gate. A fact becomes "verified" only when the user ticks "I confirm this is true"; nothing here ever marks one for them.
import { useCallback, useEffect, useRef, useState } from "react";
import type { CvAppBridge, ProfileGate, ProfileOverview, UiMessage } from "../shared/contract.ts";
import { PROFILE as T } from "./profile-messages.ts";
import { Dna } from "./ProfileDna.tsx";
import { Banner, Button, ChipChoices, Checkbox, Field, Input, TagInput, TextAreaField } from "./ui.tsx";

export type Status = "draft" | "verified";
export type YM = { y: number; m: number } | null;
export type Bullet = { id: string; text: string; tags: string[]; status: Status; onlyForFocus?: number[] };
export type Focus = { id: number; name: string; headline: string; leadTags: string[]; status: Status };
export type Role = { id: string; title: string; company: string; location: string; start: YM; end: YM | "present"; status: Status; bullets: Bullet[]; story?: { text: string; status: Status } };
export type Skill = { name: string; status: Status; group?: string };
export type Edu = { id: string; text: string; status: Status };
export type DoNot = { id: string; kind: "phrase" | "skill" | "gap"; text: string; note: string };
export type Extras = { languages: { id: string; name: string; level: "native" | "fluent" | "professional" | "basic"; status: Status }[]; certifications: { id: string; name: string; issuer?: string; year?: number; status: Status }[]; projects: { id: string; name: string; text: string; status: Status }[] };
export type P = {
  extras?: Extras; schemaVersion: number; identity: { name: string; email?: string; phone?: string; linkedin?: string; city: string; country: string };
  roles: Role[]; skills: Skill[]; education: Edu[]; focusTypes: Focus[]; doNotUse: DoNot[];
  rules: { salaryFloor: { amount: number; currency: string } | null; location: { current: string; targets: string[]; workModes: ("onsite" | "hybrid" | "remote")[]; cvLocationLines: string[] }; seniority: { levels: string[]; avoid: string[] }; rightToWork: { statement: string; needsSponsorship: boolean }; avoidRoles: string[]; availability?: string };
};
export const emptyProfile = (): P => ({ schemaVersion: 1, identity: { name: "", city: "", country: "" }, roles: [], skills: [], education: [], focusTypes: [], doNotUse: [], rules: { salaryFloor: null, location: { current: "", targets: [], workModes: [], cvLocationLines: [] }, seniority: { levels: [], avoid: [] }, rightToWork: { statement: "", needsSponsorship: false }, avoidRoles: [] } });
const withFocus = (x: P): P => ({ ...x, focusTypes: x.focusTypes ?? [] });
export const uid = (p: string) => p + Math.random().toString(36).slice(2, 9);
export const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
// The copy that goes to the server: no blank rows (a skill, study, language, certificate or project with nothing typed), no role without a title and a company, no achievement without text.
// The page keeps its own blank rows until the user fills them or leaves them (see ProfileDna.tsx); stored data the page does not show (groups, focus types, never-say items) passes through untouched.
export const forServer = (p: P): P => ({
  ...p, roles: p.roles.filter((r) => r.title.trim() && r.company.trim()).map((r) => ({ ...r, bullets: r.bullets.filter((b) => b.text.trim()) })),
  skills: p.skills.filter((s) => s.name.trim()), education: p.education.filter((e) => e.text.trim()),
  ...(p.extras ? { extras: { languages: p.extras.languages.filter((x) => x.name.trim()), certifications: p.extras.certifications.filter((x) => x.name.trim()), projects: p.extras.projects.filter((x) => x.name.trim() && x.text.trim()) } } : {}),
});
const sigOf = (o: P) => { const { extras, ...rest } = o; return JSON.stringify([rest, extras ?? { languages: [], certifications: [], projects: [] }]); }; // no extras and empty extras are the same thing
const sig = (p: P) => sigOf(forServer(p));


export function Profile({ bridge, onGate, autoImport }: { bridge: CvAppBridge; onGate?: (g: ProfileGate) => void; autoImport?: boolean }) {
  const [p, setP] = useState<P | null>(null), [gate, setGate] = useState<ProfileGate | null>(null);
  const [importNote, setImportNote] = useState<{ text: string; check: string | null } | null>(null), [status, setStatus] = useState<"idle" | "saving" | "saved">("idle"), [errors, setErrors] = useState<string[]>([]), [warnings, setWarnings] = useState<string[]>([]), [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { let live = true; void bridge.invoke("profile:get").then((r) => { if (!live) return; if (r.ok) { const w = withFocus((r.data.profile as unknown as P) ?? emptyProfile()); pRef.current = w; sentRef.current = sig(w); baseRef.current = r.data.updatedAt; setP(w); setGate(r.data.gate); setBase(r.data.updatedAt); } else setProblem(r.error.message); }); return () => { live = false; }; }, [bridge]);
  // Autosave: every edit marks the draft unsaved and (re)starts an 800 ms timer; the draft is also saved at once on leaving, before a card button and before an import.
  const [overview, setOverview] = useState<ProfileOverview>({ cards: [], unchecked: [], sources: [] }), [base, setBase] = useState<string | null>(null), pRef = useRef<P | null>(null), baseRef = useRef<string | null>(null), dirtyRef = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | null>(null), flight = useRef<Promise<boolean> | null>(null), flushRef = useRef<() => Promise<boolean>>(async () => true);
  pRef.current = p;
  const sentRef = useRef<string | null>(null); // what the server last has (the filtered copy), so a save that would change nothing is skipped
  const save = async (): Promise<boolean> => {
    const snap = pRef.current; if (!snap) return false; const bad = snap.roles.find((r) => dateProblem(r)); if (bad) { setErrors([`${bad.title || "A role"} at ${bad.company || "a company"}: ${dateProblem(bad)}`]); setStatus("idle"); return false; }
    const out = forServer(snap), sent = sigOf(out); // blank rows are never sent, but they stay on the page: the page's own draft is never replaced while the user is typing
    if (sent === sentRef.current) { dirtyRef.current = false; setStatus("idle"); return true; } // nothing that matters changed (for example a blank row was added or removed): no save, no "Saved"
    dirtyRef.current = false; setStatus("saving"); setErrors([]); setWarnings([]); setProblem(null);
    const r = await bridge.invoke("profile:save", { profile: out as unknown as Record<string, unknown>, baseUpdatedAt: baseRef.current ?? undefined });
    const again = pRef.current !== snap; // typed during the save: that newer draft is saved by its own timer
    if (!r.ok) { dirtyRef.current = true; setProblem(r.error.message); setStatus("idle"); return false; }
    if (r.data.ok) { sentRef.current = sent; baseRef.current = r.data.updatedAt; setBase(r.data.updatedAt); setWarnings(r.data.warnings); setGate(r.data.gate); onGate?.(r.data.gate); setStatus(again ? "saving" : "saved"); return true; }
    dirtyRef.current = true; setErrors(r.data.errors); setStatus("idle"); return false;
  };
  const flush = async (): Promise<boolean> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    while (flight.current) await flight.current.catch(() => false); // one save at a time
    if (!dirtyRef.current) return true;
    const run = save(); flight.current = run; try { return await run; } finally { flight.current = null; }
  };
  flushRef.current = flush;
  const edit = useCallback((fn: (draft: P) => void) => { const cur = pRef.current; if (!cur) return; const next = structuredClone(cur); fn(next); pRef.current = next; setP(next); dirtyRef.current = true; setStatus("idle"); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => { timer.current = null; void flushRef.current(); }, 800); }, []);
  useEffect(() => () => { void flushRef.current(); }, []); // leaving the page saves what is waiting
  const refresh = useCallback(() => { void bridge.invoke("profile:overview").then((r) => { if (r.ok) setOverview(r.data); }); }, [bridge]);
  useEffect(() => { refresh(); }, [refresh, base]);
  // A card button: unsaved edits are saved first, then the main process applies the action to the stored profile and the page takes the result.
  const onCard = async (key: string, action: "accept" | "dismiss" | "merge") => {
    if (!(await flush())) return;
    const r = await bridge.invoke("profile:card", { key, action }); if (!r.ok) { setProblem(r.error.message); return; }
    if (!r.data.ok) { setProblem(T.dna.staleCard); refresh(); return; }
    const np = withFocus(r.data.profile as unknown as P); pRef.current = np; sentRef.current = sig(np); dirtyRef.current = false; setP(np); baseRef.current = r.data.updatedAt; setBase(r.data.updatedAt); setOverview(r.data.overview);
    void bridge.invoke("profile:get").then((g) => { if (g.ok) { setGate(g.data.gate); onGate?.(g.data.gate); } });
  };
  if (problem && !p) return <p role="alert" className="problem" data-testid="problem">{problem}</p>;
  if (!p) return <p className="muted">Opening your profile…</p>;
  const importSlot = <><ImportCv startOpen={autoImport} bridge={bridge} prepare={flush} onResult={(prof, note, updatedAt) => { const np = withFocus(prof as unknown as P); pRef.current = np; sentRef.current = sig(np); dirtyRef.current = false; setP(np); setStatus("saved"); baseRef.current = updatedAt; setBase(updatedAt); setImportNote(note); void bridge.invoke("profile:get").then((g) => { if (g.ok) { setGate(g.data.gate); onGate?.(g.data.gate); } }); }} /></>;
  return (
    <div className="profile" data-testid="profile">
      <header className="page-head"><h1 className="page-title">{T.title}</h1><div className="page-actions"><span className="muted small profile-status" role="status">{status === "saving" ? T.saving : status === "saved" ? T.saved : ""}</span></div></header>
      <p className="muted">{T.intro}</p>
      {gate && !gate.ok && <Banner message={{ id: "profile.gate", tone: "info", title: T.gateTitle, body: gate.missing.join("; ") + ".", actions: [], details: "" }} handled={() => false} onAction={() => undefined} />}
      {importNote && <div className="banner banner-info" role="status" data-testid="import-note"><div className="banner-text"><p>{importNote.text}</p>{importNote.check && <p><strong>{importNote.check}</strong></p>}<p className="muted small">{T.import.review}</p></div></div>}
      <Dna p={p} edit={edit} overview={overview} onCard={(k, a) => void onCard(k, a)} importSlot={importSlot} />
      {errors.length > 0 && <div role="alert" className="banner banner-error" data-testid="errors"><div className="banner-text"><h2>{T.errorsTitle}</h2><ul className="plain">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div></div>}
      {warnings.length > 0 && <div className="banner banner-warn" data-testid="warnings" role="status"><div className="banner-text"><ul className="plain">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div></div>}
      {problem && <p role="alert" className="problem" data-testid="problem">{problem}</p>}
    </div>
  );
}

export function ImportCv({ bridge, onResult, prepare, startOpen }: { startOpen?: boolean; bridge: CvAppBridge; prepare: () => Promise<boolean>; onResult: (profile: Record<string, unknown>, note: { text: string; check: string | null }, updatedAt: string) => void }) {
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null), [msg, setMsg] = useState<UiMessage | null>(null), [open, setOpen] = useState(!!startOpen);
  const choose = async () => { setProblem(null); const r = await bridge.invoke("profile:importFile"); if (!r.ok) { setProblem(r.error.message); return; } if (r.data.status === "picked") setText(r.data.text); else if (r.data.status === "refused") setProblem(T.import.fileBad[r.data.reason]); };
  const go = async () => {
    setBusy(true); setProblem(null); setMsg(null); if (!(await prepare())) { setBusy(false); return; } // edits not saved yet are saved first, so the import never overwrites them
    const r = await bridge.invoke("profile:import", { text }); setBusy(false);
    if (!r.ok) { setProblem(r.error.message); return; }
    const d = r.data; if (d.status === "ok") { onResult(d.profile, { text: T.import.done(d.added.roles, d.added.bullets, d.added.skills, d.added.education), check: d.notFromCv > 0 ? T.import.check(d.notFromCv) : null }, d.updatedAt); setText(""); setOpen(false); }
    else if (d.reason === "too_short") setProblem(T.import.tooShort); else if (d.message) setMsg(d.message); else setProblem(T.errorsTitle);
  };
  if (!open) return <div className="row"><Button onClick={() => setOpen(true)} data-testid="import-open">{T.import.title}</Button></div>;
  return (
    <section className="subcard" data-testid="import-cv"><h2>{T.import.title}</h2><p>{T.import.intro}</p><p className="muted small">{T.import.privacy}</p>
      <div className="row"><Button disabled={busy} onClick={() => void choose()}>{T.import.choose}</Button></div>
      <TextAreaField id="import-text" label={T.import.paste} rows={6} value={text} onChange={setText} disabled={busy} />
      <div className="row"><Button kind="primary" disabled={busy || text.trim().length === 0} onClick={() => void go()}>{busy ? T.import.working : T.import.go}</Button></div>
      {problem && <p role="alert" className="problem" data-testid="import-problem">{problem}</p>}
      {msg && <Banner message={msg} handled={() => false} onAction={() => undefined} />}
    </section>
  );
}

export type EditFn = (fn: (d: P) => void) => void; export type Sec = { p: P; edit: EditFn };
export function countDrafts(p: P): number { return p.roles.reduce((n, r) => n + r.bullets.filter((b) => b.status === "draft").length, 0) + p.skills.filter((s) => s.status === "draft").length + p.education.filter((e) => e.status === "draft").length + p.roles.filter((r) => r.story?.status === "draft").length + (p.focusTypes ?? []).filter((f) => f.status === "draft").length; }

export function YMInputs({ id, label, v, onChange }: { id: string; label: string; v: YM; onChange: (v: YM) => void }) {
  const put = (k: "y" | "m", s: string) => { const n = Number(s); const cur = v ?? { y: 0, m: 1 }; onChange(s === "" ? null : { ...cur, [k]: Number.isFinite(n) ? n : cur[k] }); };
  return <div className="ym"><label className="label" htmlFor={`${id}-m`}>{label.replace("year", "month")}</label><Input id={`${id}-m`} narrow type="number" min={1} max={12} value={v?.m ?? ""} onChange={(x) => put("m", x)} /><label className="label" htmlFor={`${id}-y`}>{label}</label><Input id={`${id}-y`} narrow type="number" min={1950} max={2100} value={v?.y && v.y > 0 ? v.y : ""} onChange={(x) => put("y", x)} /></div>;
}
const MONTHS_OK = (v: YM) => !v || (Number.isInteger(v.m) && v.m >= 1 && v.m <= 12 && Number.isInteger(v.y) && v.y >= 1950 && v.y <= 2100);
export function dateProblem(r: Role): string | null {
  if (!MONTHS_OK(r.start) || (r.end !== "present" && !MONTHS_OK(r.end as YM))) return "Use a month from 1 to 12 and a year from 1950 to 2100.";
  if (r.start && r.end && r.end !== "present" && r.end.y * 12 + r.end.m < r.start.y * 12 + r.start.m) return "This role ends before it starts.";
  return null;
}
// The levels offered as chips. The engine stores seniority levels as plain text (its fixtures use "entry" and "mid"), so these are the values saved; a level already saved that is not listed here still shows, ticked.
const LEVELS = ["entry", "junior", "mid", "senior", "lead"];
export function Rules({ p, edit }: Sec) {
  const r = p.rules; const mode = (m: "onsite" | "hybrid" | "remote") => (c: boolean) => edit((d) => { const s = new Set(d.rules.location.workModes); if (c) s.add(m); else s.delete(m); d.rules.location.workModes = [...s]; });
  return <>
    <Field id="ru-sal" label={T.rules.salary} type="number" value={r.salaryFloor?.amount ?? ""} onChange={(v) => edit((d) => { d.rules.salaryFloor = v === "" || !Number.isFinite(Number(v)) ? null : { amount: Math.max(0, Math.round(Number(v))), currency: "GBP" }; })} />
    <Field id="ru-here" label={T.rules.here} value={r.location.current} onChange={(v) => edit((d) => { d.rules.location.current = v; d.rules.location.cvLocationLines = v.trim() ? [v.trim()] : []; })} />
    <TagInput id="ru-targets" label={T.rules.targets} hint={T.rules.targetsHint} placeholder={T.rules.targetsPlaceholder} listLabel={T.rules.targetsList} removeLabel={T.rules.removeTarget} values={r.location.targets} onChange={(v) => edit((d) => { d.rules.location.targets = v; })} />
    <fieldset className="subcard"><legend>{T.rules.modes}</legend><Checkbox id="ru-m1" label={T.rules.onsite} checked={r.location.workModes.includes("onsite")} onChange={mode("onsite")} /><Checkbox id="ru-m2" label={T.rules.hybrid} checked={r.location.workModes.includes("hybrid")} onChange={mode("hybrid")} /><Checkbox id="ru-m3" label={T.rules.remote} checked={r.location.workModes.includes("remote")} onChange={mode("remote")} /></fieldset>
    <ChipChoices idPrefix="ru-lv" legend={T.rules.levels} options={[...new Set([...LEVELS, ...r.seniority.levels])].map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }))} selected={r.seniority.levels} onChange={(v) => edit((d) => { d.rules.seniority.levels = v; })} />
    <Field id="ru-av2" label={T.rules.availability} value={r.availability ?? ""} onChange={(v) => edit((d) => { d.rules.availability = v || undefined; })} />
  </>;
}
