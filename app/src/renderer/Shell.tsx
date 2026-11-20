// The app's frame (design "Quiet, refined", 2026-11-19): the labelled rail and the job list on the Mac's translucent material, and the main area with its header (page name and the Claude status line) (design/DESIGN.md). History, My profile and the rest of Settings
// are labelled "coming soon" until their phases; New job shows the Connect screen until Claude is connected, then waits for 4f.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccessView, CvAppBridge, ProfileGate, UiBanner, UiJobRow } from "../shared/contract.ts";
import { Connect } from "./Connect.tsx";
import { BrandMark, Button, Icon, Input, JobRowButton } from "./ui.tsx";
import { JobDetail } from "./JobDetail.tsx";
import { NewJob } from "./NewJob.tsx";
import { Profile } from "./Profile.tsx";
import { History } from "./History.tsx";
import { SettingsPage, filterSections } from "./SettingsPage.tsx";
import { SETTINGS } from "./settings-messages.ts";
import { serviceName, setService } from "./service.ts";
import { PROFILE } from "./profile-messages.ts";
import { CARD, SHELL } from "./jobs-messages.ts";

export const TOAST_MS = 10_000;
type Page = "new" | "history" | "profile" | "settings";
const PAGES: { id: Page; label: string; icon: "compose" | "clock" | "user" | "gear" }[] = [
  { id: "new", label: "New job", icon: "compose" }, { id: "history", label: "History", icon: "clock" }, { id: "profile", label: "My profile", icon: "user" }, { id: "settings", label: "Settings", icon: "gear" },
];

export function Shell({ bridge, appName, startOn, onReplayGuide }: { bridge: CvAppBridge; appName: string; startOn?: { page: "new" | "profile"; importCv?: boolean }; onReplayGuide?: () => void }) {
  const [page, setPage] = useState<Page>(startOn?.page ?? "new");
  const [settingsSection, setSettingsSection] = useState<string>("claude"), [settingsQuery, setSettingsQuery] = useState("");
  const [view, setView] = useState<AccessView | null>(null);
  const [jobs, setJobs] = useState<UiJobRow[]>([]), [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void bridge.invoke("jobs:list").then((r) => { if (live && r.ok) setJobs(r.data); });
    const off = bridge.on("jobs:changed", (p) => setJobs(p.rows));
    return () => { live = false; off(); };
  }, [bridge, view?.connected]);
  // Leaving My profile with unsaved changes asks first (the page would otherwise drop them silently).
  const [gate, setGate] = useState<ProfileGate | null>(null), [identity, setIdentity] = useState<string | undefined>(undefined);
  useEffect(() => { let live = true; void bridge.invoke("profile:get").then((r) => { if (live && r.ok) { setGate(r.data.gate); const n = (r.data.profile as { identity?: { name?: unknown } } | null)?.identity?.name; setIdentity(typeof n === "string" && n.trim() ? n.trim() : undefined); } }); return () => { live = false; }; }, [bridge, page]);
  const [banners, setBanners] = useState<UiBanner[]>([]);
  useEffect(() => {
    let live = true;
    void bridge.invoke("notices:list").then((r) => { if (live && r.ok) setBanners(r.data); });
    const off = bridge.on("app:notice", (n) => setBanners((b) => [n, ...b.filter((x) => x.id !== n.id)].slice(0, 8)));
    return () => { live = false; off(); };
  }, [bridge]);
  const dismiss = (id: string) => { setBanners((b) => b.filter((x) => x.id !== id)); void bridge.invoke("notices:dismiss", { id }); };
  // A banner leaves by itself after TOAST_MS (the sidebar dot and the menu bar keep saying that a job needs the user), so it never sits over the page's controls for long.
  const scheduled = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => { for (const b of banners) if (!scheduled.current.has(b.id)) scheduled.current.set(b.id, setTimeout(() => { scheduled.current.delete(b.id); dismiss(b.id); }, TOAST_MS)); }, [banners]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { scheduled.current.forEach((t) => clearTimeout(t)); }, []);
  const open = (id: string | null) => { setSelected(id); setPage("new"); if (id) banners.filter((b) => b.jobId === id).forEach((b) => dismiss(b.id)); };
  useEffect(() => {
    let live = true;
    void bridge.invoke("access:get").then((r) => { if (live && r.ok) { setService(r.data.provider); setView(r.data); } });
    const off = bridge.on("access:changed", (v) => { setService(v.provider); setView((old) => { if (old && !old.connected && v.connected) setBanners((b) => [{ id: `local-${Date.now()}`, kind: "analysed" as const, jobId: "", title: `${serviceName()} is connected`, body: "You can paste a job ad now.", at: new Date().toISOString() }, ...b].slice(0, 8)); return v; }); });
    return () => { live = false; off(); };
  }, [bridge]);
  const onView = useCallback((v: AccessView) => { setService(v.provider); setView(v); }, []);
  // With a ChatGPT plan the guidelines ask for a visible "Using ChatGPT plan" while the plan pays for requests.
  const planInUse = !!view && view.provider === "openai" && view.mode === "subscription" && view.connected;
  const status = !view ? `Checking ${serviceName()}…` : planInUse ? "Using ChatGPT plan" : view.connected ? `${serviceName()} is connected` : `${serviceName()} is not connected`;
  const railButton = (p: (typeof PAGES)[number]) => (
    <button key={p.id} type="button" className={`rail-item${(p.id === "new" ? page === "new" && !selected : page === p.id) ? " selected" : ""}`} aria-label={p.label} aria-current={page === p.id ? "page" : undefined} onClick={() => { if (p.id === "new") open(null); else setPage(p.id); }}><Icon name={p.icon} /><span className="rail-label" aria-hidden="true">{p.label}</span></button>
  );
  const [jobQuery, setJobQuery] = useState("");
  const q = jobQuery.trim().toLowerCase(), shown = q ? jobs.filter((j) => j.title.toLowerCase().includes(q)) : jobs;
  const crumb = page === "new" ? (selected ? jobs.find((j) => j.id === selected)?.title ?? "" : PAGES[0].label) : PAGES.find((p) => p.id === page)!.label;
  return (
    <div className="window">
      <nav className="rail" aria-label="Pages">
        <div className="rail-main">{PAGES.filter((p) => p.id !== "settings").map((p) => railButton(p))}</div>
        <div className="rail-foot">{PAGES.filter((p) => p.id === "settings").map((p) => railButton(p))}</div>
      </nav>
      {page === "settings" ? (
        <aside className="sidebar" aria-label="Settings sections">
          <h2 className="side-title">{SETTINGS.title}</h2>
          <div className="set-search"><Icon name="search" /><Input id="settings-search" type="search" ariaLabel={SETTINGS.searchLabel} placeholder={SETTINGS.searchLabel} value={settingsQuery} onChange={(q) => { setSettingsQuery(q); const hits = filterSections(q); if (hits.length && !hits.some((x) => x.id === settingsSection)) setSettingsSection(hits[0].id); }} /></div>
          <ul className="set-nav">{filterSections(settingsQuery).map((x) => <li key={x.id}><button type="button" className={`set-nav-item${settingsSection === x.id ? " selected" : ""}`} aria-current={settingsSection === x.id ? "true" : undefined} onClick={() => setSettingsSection(x.id)}><Icon name={x.icon} />{x.label}</button></li>)}</ul>
          {filterSections(settingsQuery).length === 0 && <p className="muted small side-empty" role="status">{SETTINGS.searchNone}</p>}
        </aside>
      ) : (
        <aside className="sidebar" aria-label="Jobs">
          <div className="brand-row"><BrandMark size={22} /><span className="brand-name">{appName}</span></div>
          {jobs.length > 0 && <div className="side-search"><Icon name="search" /><Input id="jobs-search" type="search" ariaLabel={SHELL.searchJobs} placeholder={SHELL.searchJobs} value={jobQuery} onChange={setJobQuery} /></div>}
          <div className="side-scroll">
            {jobs.length === 0 && <p className="muted small side-empty">{CARD.listEmpty}</p>}
            {jobs.length > 0 && shown.length === 0 && <p className="muted small side-empty" role="status">{SHELL.searchNone}</p>}
            <JobGroup title={CARD.listNeeds} rows={shown.filter((j) => j.needsYou)} selected={page === "new" ? selected : null} onOpen={open} />
            <JobGroup title={CARD.listRecent} rows={shown.filter((j) => !j.needsYou)} selected={page === "new" ? selected : null} onOpen={open} />
          </div>
          {identity && <div className="side-me"><span className="avatar" aria-hidden="true">{identity.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span><span className="me-text"><strong>{identity}</strong><span className="muted small">{SHELL.stays}</span></span></div>}
        </aside>
      )}
      <div className="stage">
        <header className="topbar">
          <span className="crumb" data-testid="crumb">{crumb}</span>
          <button type="button" className={`status ${view?.connected ? "status-ok" : "status-warn"}`} onClick={() => { setSettingsSection("claude"); setPage("settings"); }} data-testid="status-line">
            <Icon name={view?.connected ? "check" : "warn"} /><span>{status}</span>
          </button>
        </header>
        {banners.length > 0 && (
          <div className="toasts" role="region" aria-label="Updates" data-testid="toasts">
            {banners.slice(0, 3).map((b) => (
              <div key={b.id} className={`toast toast-${b.kind}`} role="status" data-testid="toast">
                <div className="toast-text"><strong>{b.title}</strong><span>{b.body}</span></div>
                <div className="row"><Button kind="primary" onClick={() => open(b.jobId)}>Open</Button><Button onClick={() => dismiss(b.id)}>Dismiss</Button></div>
              </div>
            ))}
          </div>
        )}
        <main className="main" data-testid="main" data-page={page}>
          {page === "new" && (selected ? <JobDetail bridge={bridge} id={selected} onOpenProfile={() => setPage("profile")} onOpen={open} /> : !(view && view.connected) ? <Connect bridge={bridge} initial={view} onView={onView} /> : gate && !gate.ok ? <ProfileSetup gate={gate} onOpen={() => setPage("profile")} /> : <NewJob bridge={bridge} onOpen={open} recent={jobs} />)}
          {page === "settings" && <SettingsPage bridge={bridge} view={view} onView={onView} section={settingsSection} onShowGuide={onReplayGuide} />}
          {page === "history" && <History bridge={bridge} onOpen={open} />}
          {page === "profile" && <Profile bridge={bridge} onGate={setGate} autoImport={startOn?.importCv} />}
        </main>
      </div>
    </div>
  );
}
const ProfileSetup = ({ gate, onOpen }: { gate: ProfileGate; onOpen: () => void }) => (
  <div className="empty" data-testid="profile-setup"><h1 className="hero">{PROFILE.setup.title}</h1><p className="muted">{PROFILE.setup.body}</p><ul className="plain left">{gate.missing.map((m) => <li key={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</li>)}</ul><Button kind="primary" onClick={onOpen}>{PROFILE.setup.open}</Button></div>
);
function JobGroup({ title, rows, selected, onOpen }: { title: string; rows: UiJobRow[]; selected: string | null; onOpen: (id: string) => void }) {
  if (rows.length === 0) return null;
  return (
    <section className="group" aria-label={title}><h2 className="group-title">{title}</h2>
      <ul className="jobs">{rows.map((j) => <li key={j.id}><JobRowButton row={j} selected={selected === j.id} onOpen={onOpen} /></li>)}</ul>
    </section>
  );
}
