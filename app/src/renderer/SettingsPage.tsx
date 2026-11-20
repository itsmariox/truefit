// Settings (phase 7): Claude (the Connect screen), notifications, CV defaults, start-up, spend limit, your data (export, delete everything with a typed phrase) and About.
import { useEffect, useState } from "react";
import type { AccessView, CvAppBridge, ImportPick, UiSettings, UiTelegram } from "../shared/contract.ts";
import { Connect } from "./Connect.tsx";
import { APPEARANCE, SETTINGS as T, TELEGRAM as TG } from "./settings-messages.ts";
import { applyAppearance } from "./theme.ts";
import { AppearancePicker, Button, Checkbox, Field, Input, Select, SettingRow, SettingsCard, Stack, Switch } from "./ui.tsx";

function Telegram({ bridge }: { bridge: CvAppBridge }) {
  const [st, setSt] = useState<UiTelegram | null>(null), [show, setShow] = useState(false), [token, setToken] = useState(""), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; const load = () => void bridge.invoke("telegram:status").then((r) => { if (live && r.ok) setSt(r.data); }); load(); const t = setInterval(load, 2000); return () => { live = false; clearInterval(t); }; }, [bridge]);
  const run = async (f: () => ReturnType<CvAppBridge["invoke"]>) => { setBusy(true); setMsg(null); const r = await f(); setBusy(false); return r; };
  if (!st) return null;
  return (
    <section className="set-card set-pad" data-testid="telegram" aria-label={TG.title}><h2 className="sr-only">{TG.title}</h2><p className="muted small">{TG.intro}</p>
      {st.state === "off" && <form onSubmit={(e) => { e.preventDefault(); void run(() => bridge.invoke("telegram:saveToken", { token })).then((r) => { if (!r.ok) return; const d = r.data as { ok: boolean; botName: string | null; reason: string | null; status: UiTelegram }; setSt(d.status); if (d.ok) { setToken(""); setMsg(TG.saved(d.botName ?? "bot")); } else setMsg((TG as never as Record<string, string>)[d.reason ?? "unreachable"] ?? TG.unreachable); }); }}>
        <Stack gap={16}><p className="small">{TG.step1}</p><Field id="tg-token" label={TG.token} type={show ? "text" : "password"} value={token} onChange={setToken} spellCheck={false} /><Checkbox id="tg-show" label={TG.show} checked={show} onChange={setShow} /><div className="row"><Button type="submit" disabled={busy || !token.trim()}>{TG.save}</Button></div></Stack></form>}
      {st.state === "token_saved" && <div className="row"><Button kind="primary" disabled={busy} onClick={() => void run(() => bridge.invoke("telegram:pair")).then((r) => r.ok && setSt(r.data as UiTelegram))}>{TG.pair}</Button><Button disabled={busy} onClick={() => void run(() => bridge.invoke("telegram:disconnect")).then((r) => r.ok && setSt(r.data as UiTelegram))}>{TG.disconnect}</Button></div>}
      {st.state === "pairing" && st.code && <><p role="status" data-testid="tg-code"><strong>{TG.pairing(st.code)}</strong></p><div className="row"><Button onClick={() => void bridge.invoke("telegram:cancelPair").then((r) => r.ok && setSt(r.data))}>{TG.cancel}</Button></div></>}
      {(st.state === "paired" || st.state === "running") && <><p data-testid="tg-paired">{TG.paired}</p><div className="row"><Button onClick={() => void run(() => bridge.invoke("telegram:disconnect")).then((r) => r.ok && setSt(r.data as UiTelegram))}>{TG.disconnect}</Button></div></>}
      {msg && <p role="status" className="muted" data-testid="tg-msg">{msg}</p>}
    </section>
  );
}

// The sections of Settings, shown one at a time (the list is in the sidebar, see Shell.tsx). Every section stays in the page and the others are hidden by CSS.
// The sections of Settings, shown one at a time (the list is in the sidebar, see Shell.tsx). Every section stays in the page and the others are hidden by CSS.
// `words` are the names of the settings inside, so the search box finds "token" in Telegram and "delete" in Your data.
export const SETTINGS_SECTIONS = [
  { id: "claude", label: T.claude, icon: "chat", words: ["sign in", "subscription", "api key", "connect", "login"] },
  { id: "look", label: APPEARANCE.section, icon: "contrast", words: APPEARANCE.words },
  { id: "notify", label: T.notify, icon: "bell", words: Object.values(T.notifyLabels) },
  { id: "cv", label: T.cv, icon: "doc", words: [T.tone, T.accent, T.rtw] },
  { id: "general", label: T.startup, icon: "power", words: [T.login] },
  { id: "telegram", label: TG.title, icon: "send", words: [TG.token, "bot", "pair", "phone"] },
  { id: "usage", label: T.usage, icon: "chart", words: ["requests", "spend", "quota", T.cap, "limit"] },
  { id: "data", label: T.data, icon: "database", words: [T.export, T.restore, T.deleteJobs, T.delete, "backup", "copy"] },
  { id: "about", label: T.about, icon: "info", words: ["version"] },
] as const;
export const filterSections = (q: string) => { const k = q.trim().toLowerCase(); return k ? SETTINGS_SECTIONS.filter((x) => [x.label, ...x.words].some((w) => w.toLowerCase().includes(k))) : SETTINGS_SECTIONS; };
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];
export function SettingsPage({ bridge, view, onView, section = "claude", onShowGuide }: { bridge: CvAppBridge; view: AccessView | null; onView: (v: AccessView) => void; section?: string; onShowGuide?: () => void }) {
  const [s, setS] = useState<UiSettings | null>(null), [msg, setMsg] = useState<string | null>(null), [msgKey, setMsgKey] = useState(0), [problem, setProblem] = useState<string | null>(null), [cap, setCap] = useState("");
  const [jobsPhrase, setJobsPhrase] = useState(""), [pick, setPick] = useState<ImportPick | null>(null), [restorePhrase, setRestorePhrase] = useState(""), [restored, setRestored] = useState(false), [phrase, setPhrase] = useState(""), [done, setDone] = useState(false), [busy, setBusy] = useState(false);
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  useEffect(() => { let live = true; void bridge.invoke("settings:get").then((r) => { if (!live) return; if (r.ok) { setS(r.data); setCap(r.data.capUsd === null ? "" : String(r.data.capUsd)); } else setProblem(r.error.message); }); return () => { live = false; }; }, [bridge]);
  const say = (m: string) => { setMsg(m); setMsgKey((k) => k + 1); }; // a new key restarts the fade, so the same words twice still show twice
  const change = async (patch: Record<string, unknown>) => { setProblem(null); setMsg(null); const r = await bridge.invoke("settings:set", { patch }); if (!r.ok) setProblem(r.error.message); else if (r.data.ok) { setS(r.data.settings); say(T.saved); } else setProblem(T.problem); };
  const doExport = async () => { setBusy(true); setMsg(null); setProblem(null); const r = await bridge.invoke("data:export"); setBusy(false); if (!r.ok) setProblem(r.error.message); else if (r.data.status === "saved") say(T.exported(r.data.jobs)); else if (r.data.status === "failed") setProblem(T.exportFailed); };
  const doDeleteJobs = async () => { setBusy(true); setMsg(null); const r = await bridge.invoke("data:deleteJobs", { phrase: jobsPhrase }); setBusy(false); if (r.ok && r.data.deleted) { say(T.jobsDeleted(r.data.jobs)); setJobsPhrase(""); } else setProblem(r.ok ? T.problem : r.error.message); };
  const doPick = async () => { setPick(null); setMsg(null); const r = await bridge.invoke("data:importPick"); if (r.ok) setPick(r.data); else setProblem(r.error.message); };
  const doRestore = async () => { setBusy(true); const r = await bridge.invoke("data:importConfirm", { phrase: restorePhrase }); setBusy(false); if (r.ok && r.data.imported) setRestored(true); else setProblem(r.ok ? T.problem : r.error.message); };
  const doDelete = async () => { setBusy(true); const r = await bridge.invoke("data:delete", { phrase }); setBusy(false); if (r.ok && r.data.deleted) setDone(true); else setProblem(r.ok ? T.problem : r.error.message); };
  const check = (id: string, label: string, on: boolean, key: string) => <Switch id={id} label={label} checked={on} onChange={(v) => void change({ [key]: v })} />;
  const sec = (id: SettingsSection, label: string, content: React.ReactNode) => <div role="group" className={`set-section${section === id ? "" : " set-hidden"}`} aria-label={label} data-section={id}>{content}</div>;
  const here = SETTINGS_SECTIONS.find((x) => x.id === section)?.label ?? T.title;
  return (
    <div className="profile settings" data-testid="settings">
      <h1 className="page-title">{here}</h1>
      {msg && <p key={msgKey} role="status" className="set-msg" data-testid="settings-msg">{msg}</p>}{problem && <p role="alert" className="problem" data-testid="problem">{problem}</p>}
      {sec("claude", T.claude, <Connect bridge={bridge} initial={view} onView={onView} embedded />)}
      {s && <>
        {sec("look", APPEARANCE.section, <><p className="muted set-intro">{APPEARANCE.note}</p><section className="set-card set-pad" aria-label={APPEARANCE.title}><AppearancePicker value={s.appearance} legend={APPEARANCE.title} labels={APPEARANCE.options} onChange={(v) => { applyAppearance(v); void change({ appearance: v }); }} /></section></>)}
        {sec("notify", T.notify, <><p className="muted set-intro">{T.notifyNote}</p><SettingsCard>
          {check("n1", T.notifyLabels.analysed, s.notify.analysed, "notifyAnalysed")}{check("n2", T.notifyLabels.cvReady, s.notify.cvReady, "notifyCvReady")}{check("n3", T.notifyLabels.needsInput, s.notify.needsInput, "notifyNeedsInput")}{check("n4", T.notifyLabels.failed, s.notify.failed, "notifyFailed")}</SettingsCard></>)}
        {sec("cv", T.cv, <SettingsCard>
          <SettingRow id="s-tone" title={T.tone}><Select id="s-tone" value={s.tone} onChange={(v) => void change({ tone: v })} options={s.tones.map((t) => ({ value: t, label: capitalize(t) }))} /></SettingRow>
          <SettingRow id="s-acc" title={T.accent}><Select id="s-acc" value={s.accent} onChange={(v) => void change({ accent: v })} options={s.accents.map((t) => ({ value: t, label: capitalize(t) }))} /></SettingRow>
          {check("s-rtw", T.rtw, s.showRightToWork, "showRightToWork")}</SettingsCard>)}
        {sec("general", T.startup, <SettingsCard>{check("s-login", T.login, s.startAtLogin, "startAtLogin")}</SettingsCard>)}
        {sec("telegram", TG.title, <Telegram bridge={bridge} />)}
        {sec("usage", T.usage, <>
          <SettingsCard><SettingRow id="s-cap" title={T.cap}><Input id="s-cap" narrow type="number" min={0} value={cap} onChange={setCap} /><Button onClick={() => void change({ capUsd: cap === "" ? null : Number(cap) })}>{T.capSave}</Button></SettingRow></SettingsCard>
          {s.usage.length > 0 ? <section className="set-card set-pad" data-testid="usage"><h2 className="set-title">{T.usage}</h2>{s.usage.map((l) => <p key={l} className="muted">{l}</p>)}</section> : <p className="muted">{T.none}</p>}</>)}
        {sec("data", T.data, <SettingsCard><p className="muted set-pad">{T.dataNote}</p>
          <SettingRow title={T.export}><Button disabled={busy} onClick={() => void doExport()}>{T.export}</Button></SettingRow>
          <SettingRow title={T.restore} note={T.restoreNote}>{restored ? <p role="status" data-testid="restored">{T.restored}</p> : <Button disabled={busy} onClick={() => void doPick()}>{T.restorePick}</Button>}</SettingRow>
          {!restored && pick?.status === "invalid" && <p role="alert" className="problem small set-pad">{T.restoreBad}</p>}
          {!restored && pick?.status === "picked" && <div className="set-extra"><p data-testid="restore-found">{T.restoreFound(pick.jobs, new Date(pick.createdAt).toLocaleDateString(), pick.hasProfile)}</p><p className="muted small">{T.restoreHint}</p><div className="phrase-row"><Input id="s-restore" ariaLabel={T.restoreLabel} placeholder={T.restoreLabel} value={restorePhrase} onChange={setRestorePhrase} /><Button kind="danger" disabled={busy || restorePhrase.trim().toLowerCase() !== "replace everything"} onClick={() => void doRestore()}>{T.restoreGo}</Button></div></div>}
          <SettingRow title={T.deleteJobs} note={T.deleteJobsNote} stack><Input id="s-delj" ariaLabel={T.deleteJobsLabel} placeholder={T.deleteJobsLabel} value={jobsPhrase} onChange={setJobsPhrase} /><Button kind="danger" disabled={busy || jobsPhrase.trim().toLowerCase() !== "delete jobs"} onClick={() => void doDeleteJobs()}>{T.deleteJobsGo}</Button></SettingRow>
          <SettingRow title={T.delete} note={T.deleteNote} stack>{done ? <p role="status" data-testid="deleted">{T.deleted}</p> : <><Input id="s-del" ariaLabel={T.deleteLabel} placeholder={T.deleteLabel} value={phrase} onChange={setPhrase} /><Button kind="danger" disabled={busy || phrase.trim().toLowerCase() !== "delete everything"} onClick={() => void doDelete()}>{T.deleteGo}</Button></>}</SettingRow></SettingsCard>)}
        {sec("about", T.about, <SettingsCard><SettingRow title={T.about}><span className="muted">{T.version(s.version)}</span></SettingRow>{onShowGuide && <SettingRow title={T.guide} note={T.guideNote}><Button onClick={() => void bridge.invoke("settings:set", { patch: { onboardingDone: false } }).then((r) => { if (r.ok && r.data.ok) onShowGuide(); else setProblem(T.problem); })}>{T.guideShow}</Button></SettingRow>}</SettingsCard>)}
      </>}
      {!s && problem && <p role="alert" className="problem">{problem}</p>}
    </div>
  );
}
