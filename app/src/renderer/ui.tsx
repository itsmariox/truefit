// Small shared pieces of the design system "Quiet" (design/DESIGN.md). Real buttons and labelled inputs only; no inline styles (the page's content policy forbids them).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { UiJobRow, UiMessage } from "../shared/contract.ts";
import { VERDICT_WORD } from "./jobs-messages.ts";
import { useCountUp } from "./motion.ts";

type IconName = "lock" | "close" | "bell" | "doc" | "power" | "send" | "chart" | "database" | "chat" | "search" | "chevron" | "compose" | "plus" | "clock" | "user" | "gear" | "check" | "warn" | "info" | "mic" | "arrow" | "shield" | "copy" | "minus" | "pencil" | "refresh" | "link" | "sun" | "contrast";
const PATHS: Record<IconName, ReactNode> = {
  lock: <><rect x="5.5" y="10.5" width="13" height="9" rx="2" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  bell: <><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  doc: <><path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5A.5.5 0 0 1 6.5 20V4a.5.5 0 0 1 .5-.5z" /><path d="M14 3.5V8h4M9 12.5h6M9 16h6" /></>,
  power: <><path d="M12 4v8" /><path d="M7.5 6.8a7 7 0 1 0 9 0" /></>,
  send: <><path d="M20 4 10 14" /><path d="M20 4l-6.5 16-3.5-6-6-3.5z" /></>,
  chart: <path d="M5 20V10M12 20V4M19 20v-7" />,
  database: <><ellipse cx="12" cy="6" rx="7" ry="2.5" /><path d="M5 6v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 12v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6" /></>,
  chat: <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 4v-4h-.5A2.5 2.5 0 0 1 5 12.5z" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.2-4.2" /></>,
  chevron: <path d="m6 9.5 6 6 6-6" />,
  compose: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></>,
  plus: <path d="M12 5v14M5 12h14" />, clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>, user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 19c.8-3.4 3.6-5 7-5s6.2 1.6 7 5" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" /></>,
  shield: <><path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></>, copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.5 8.5V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2" /></>, minus: <path d="M6 12h12" />,
  pencil: <><path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z" /><path d="m14.5 6.5 3 3" /></>, refresh: <><path d="M19.5 12a7.5 7.5 0 1 1-2.3-5.4" /><path d="M19.5 4.5V8.5h-4" /></>, link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.8 6.5" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" /></>,
  contrast: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" stroke="none" /></>,
  sun: <><circle cx="12" cy="12" r="3.6" /><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" /></>,
  mic: <><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></>,
  arrow: <path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" />, check: <path d="m5 12.5 4.5 4.5L19 7.5" />, warn: <><path d="M12 4 3.5 19h17z" /><path d="M12 10v4M12 16.8v.2" /></>, info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8v.2" /></>,
};
export function Icon({ name }: { name: IconName }) { return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{PATHS[name]}</svg>; }

export const Button = ({ kind = "secondary", ...p }: { kind?: "primary" | "secondary" | "danger"; children: ReactNode; onClick?: () => void; disabled?: boolean; type?: "button" | "submit"; "data-testid"?: string; "aria-pressed"?: boolean }) =>
  <button type={p.type ?? "button"} className={`btn btn-${kind}`} onClick={p.onClick} disabled={p.disabled} data-testid={p["data-testid"]} aria-pressed={p["aria-pressed"]}>{p.children}</button>;

// A message from the approved catalogue: icon and tone, title, text, its buttons, and the technical details behind an expander. Tone is shown by icon and word-free layout, never by colour alone.
export function Banner({ message, onAction, handled, busy }: { message: UiMessage; onAction: (id: string) => void; handled: (id: string) => boolean; busy?: boolean }) {
  const icon: IconName = message.tone === "ok" ? "check" : message.tone === "info" ? "info" : "warn";
  const buttons = message.actions.filter((a) => handled(a.id));
  return (
    <section className={`banner banner-${message.tone}`} role={message.tone === "error" ? "alert" : "status"} data-testid="banner" data-message={message.id}>
      <Icon name={icon} />
      <div className="banner-text">
        <h2>{message.title}</h2>
        <p>{message.body}</p>
        {buttons.length > 0 && <div className="row">{buttons.map((a, i) => <Button key={a.id} kind={i === 0 ? "primary" : "secondary"} disabled={busy} onClick={() => onAction(a.id)}>{a.label}</Button>)}</div>}
        {message.details && <details className="details"><summary>Details</summary><pre>{message.details}</pre></details>}
      </div>
    </section>
  );
}

// The Truefit mark: a fit ring with a tick. Drawn once, used in the sidebar, onboarding and the About section.
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="17" fill="none" className="mark-track" strokeWidth="6" />
      <path d="M24 7a17 17 0 1 1-16.3 12.3" fill="none" className="mark-arc" strokeWidth="6" strokeLinecap="round" />
      <path d="M17 24.5l5 5 9-10" fill="none" className="mark-tick" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// The fit score, first: a ring that fills to the percentage. The number is real text (tabular figures), the ring is its picture; the arc length is an SVG attribute (no inline style).
// `large` is the answer card's 128 px ring; the small one (92 px) is for anywhere else.
export function FitRing({ fit, verdict, large, animate }: { fit: number; verdict: "apply" | "long_shot" | "skip"; large?: boolean; animate?: boolean | "quick" }) {
  const size = large ? 128 : 92, sw = large ? 8 : 7, r = (size - sw) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, fit)), mid = size / 2, shown = useCountUp(v, !!animate, animate === "quick" ? 0.4 : large ? 0.8 : 0.7);
  return (
    <div className={`fitring fitring-${verdict}${large ? " fitring-lg" : ""}`} data-testid="fit-ring">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Fit ${v}%`}>
        <circle cx={mid} cy={mid} r={r} fill="none" className="fitring-track" strokeWidth={sw} />
        <circle cx={mid} cy={mid} r={r} fill="none" className="fitring-arc" strokeWidth={sw} strokeLinecap="round" strokeDasharray={`${(c * shown) / 100} ${c}`} transform={`rotate(-90 ${mid} ${mid})`} />
      </svg>
      <span className="fitring-num" aria-hidden="true">{shown}<small>%</small></span>
    </div>
  );
}

// The verdict as a small drawn mark: shape and fill carry the meaning as well as colour (apply = tick in a green disc, long shot = half-filled ring, skip = a line through a ring, needs you = a dashed ring with a pause,
// working = a ring that turns). It is a named image, so a screen reader hears the same word the sighted user reads.
export type MarkKind = "apply" | "long_shot" | "skip" | "wait" | "none";
export function VerdictMark({ kind, label, size = 20 }: { kind: MarkKind; label: string; size?: number }) {
  return (
    <svg className={`vmark vmark-${kind}`} width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={label} fill="none" strokeLinecap="round" strokeLinejoin="round">
      {kind === "apply" && <><circle cx="12" cy="12" r="10" className="vm-fill" stroke="none" /><path d="m7.5 12.4 3 3 6-6.4" className="vm-on" strokeWidth="2" /></>}
      {kind === "long_shot" && <><circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.6" /><path d="M12 2.75a9.25 9.25 0 0 1 0 18.5z" fill="currentColor" stroke="none" /></>}
      {kind === "skip" && <><circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.6" /><path d="M8 12h8" stroke="currentColor" strokeWidth="1.6" /></>}
      {kind === "wait" && <><circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3 3.2" /><path d="M10 9v6M14 9v6" stroke="currentColor" strokeWidth="1.8" /></>}
      {kind === "none" && <><circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="1.6" className="vm-track" /><path d="M12 2.75a9.25 9.25 0 0 1 9.25 9.25" stroke="currentColor" strokeWidth="1.8" className="vm-spin" /></>}
    </svg>
  );
}

export const markOf = (j: { verdict: "apply" | "long_shot" | "skip" | null; needsYou: boolean }): { kind: MarkKind; label: string } =>
  j.verdict ? { kind: j.verdict, label: VERDICT_WORD[j.verdict] } : j.needsYou ? { kind: "wait", label: "Needs you" } : { kind: "none", label: "Working" };
// One job as a row: its verdict mark, its title with the verdict word under it, and its fit on the right. The mark is the named image; the word and the number are decoration for the eye (aria-hidden), so nothing is read twice.
export function JobRowButton({ row, selected, onOpen, testId = "job-row", className }: { row: UiJobRow; selected?: boolean; onOpen: (id: string) => void; testId?: string; className?: string }) {
  const m = markOf(row);
  return (
    <button type="button" className={cx("job-row", selected && "selected", className)} onClick={() => onOpen(row.id)} aria-current={selected ? "true" : undefined} data-testid={testId}>
      <VerdictMark kind={m.kind} label={m.label} /><span className="job-text"><span className="job-title">{row.title}</span></span><span className="job-side" aria-hidden="true">{row.fit !== null && <span className="job-fit">{row.fit}</span>}<span className="job-sub">{m.label}</span></span>
    </button>
  );
}

// The working indicator: the Truefit ring with one arc that travels round it and breathes, while Claude is busy. It claims no progress (it only says "working"). Under reduced motion it stands still and pulses gently.
export function WorkingRing({ size = 40 }: { size?: number }) {
  return (
    <svg className="workring" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="17" fill="none" className="workring-track" strokeWidth="6" />
      <circle cx="24" cy="24" r="17" fill="none" className="workring-arc" strokeWidth="6" strokeLinecap="round" pathLength="100" />
    </svg>
  );
}

// ---------- the primitives: every screen builds from these, and spacing comes only from Stack and Inline (see styles.css) ----------
type Gap = 4 | 8 | 12 | 16 | 24 | 32;
const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");
export const Stack = ({ gap = 16, className, children }: { gap?: Gap; className?: string; children: ReactNode }) => <div className={cx("stack", `stack-${gap}`, className)}>{children}</div>;
export const Inline = ({ gap = 8, end, between, top, bottom, nowrap, className, children }: { gap?: 4 | 8 | 12 | 16 | 24; end?: boolean; between?: boolean; top?: boolean; bottom?: boolean; nowrap?: boolean; className?: string; children: ReactNode }) =>
  <div className={cx("inline", `inline-${gap}`, end && "inline-end", between && "inline-between", top && "inline-top", bottom && "inline-bottom", nowrap && "inline-nowrap", className)}>{children}</div>;

// A text box with its label above and an optional hint or error below. The label is tied to the box, so the accessible name never changes.
export function Field({ id, label, value, onChange, type = "text", hint, error, narrow, placeholder, autoComplete = "off", spellCheck, min, max, disabled, srOnlyLabel }: { id: string; label: string; value: string | number; onChange: (v: string) => void; type?: string; hint?: string; error?: string | null; narrow?: boolean; srOnlyLabel?: boolean; placeholder?: string; autoComplete?: string; spellCheck?: boolean; min?: number; max?: number; disabled?: boolean }) {
  return <div className="field-row"><label className={srOnlyLabel ? "sr-only" : "label"} htmlFor={id}>{label}</label><input id={id} className={cx("field", narrow && "narrow")} type={type} value={value} placeholder={placeholder} autoComplete={autoComplete} spellCheck={spellCheck} min={min} max={max} disabled={disabled} onChange={(e) => onChange(e.target.value)} />{hint && <span className="field-hint">{hint}</span>}{error && <span className="field-error" role="alert">{error}</span>}</div>;
}
export function TextAreaField({ id, label, value, onChange, rows = 3, placeholder, hint, srOnlyLabel, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; hint?: string; srOnlyLabel?: boolean; disabled?: boolean }) {
  return <div className="field-row"><label className={srOnlyLabel ? "sr-only" : "label"} htmlFor={id}>{label}</label><textarea id={id} className="field small-area" rows={rows} placeholder={placeholder} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />{hint && <span className="field-hint">{hint}</span>}</div>;
}
// A custom drop-down (the WAI-ARIA select-only combobox): a button that shows the choice and a listbox that opens under it (or above, when there is no room below). The native menu is never used, so it matches the app in light and dark.
export function Select({ id, value, onChange, options, label }: { id: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label?: string }) {
  const [open, setOpen] = useState(false), [active, setActive] = useState(0), [up, setUp] = useState(false);
  const btn = useRef<HTMLButtonElement>(null), list = useRef<HTMLUListElement>(null), wrap = useRef<HTMLSpanElement>(null), typed = useRef({ text: "", at: 0 });
  const chosen = Math.max(0, options.findIndex((o) => o.value === value));
  const show = (i: number) => { setActive(i); setOpen(true); };
  const pick = (i: number) => { setOpen(false); btn.current?.focus(); if (options[i] && options[i].value !== value) onChange(options[i].value); };
  useLayoutEffect(() => {
    if (!open || !btn.current || !list.current) return;
    const r = btn.current.getBoundingClientRect(), h = list.current.offsetHeight + 8;
    setUp(window.innerHeight - r.bottom < h && r.top > window.innerHeight - r.bottom);
  }, [open]);
  useEffect(() => { if (open) (list.current?.children[active] as HTMLElement | undefined)?.scrollIntoView?.({ block: "nearest" }); }, [open, active]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away); return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const key = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const n = options.length; if (e.altKey || e.ctrlKey || e.metaKey) return;
    const go = (i: number) => { e.preventDefault(); if (open) setActive(i); else show(i); };
    if (e.key === "ArrowDown") go(open ? Math.min(n - 1, active + 1) : chosen);
    else if (e.key === "ArrowUp") go(open ? Math.max(0, active - 1) : chosen);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(n - 1);
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (open) pick(active); else show(chosen); }
    else if (e.key === "Escape") { if (open) { e.preventDefault(); setOpen(false); } }
    else if (e.key === "Tab") { if (open) setOpen(false); }
    else if (e.key.length === 1) { // type-ahead: letters typed in quick succession build one word
      const now = Date.now(), t = typed.current; t.text = now - t.at > 700 ? e.key.toLowerCase() : t.text + e.key.toLowerCase(); t.at = now;
      const from = t.text.length === 1 ? (open ? active : chosen) + 1 : open ? active : chosen;
      const i = [...options.keys()].map((k) => (from + k) % n).find((k) => options[k].label.toLowerCase().startsWith(t.text));
      if (i !== undefined) go(i);
    }
  };
  return (
    <span className="select" ref={wrap}>
      <button ref={btn} type="button" id={id} className="field select-btn" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} aria-label={label} aria-activedescendant={open ? `${id}-o${active}` : undefined} onKeyDown={key} onClick={() => (open ? setOpen(false) : show(chosen))} onBlur={(e) => { if (open && !wrap.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
        <span className="select-value">{options[chosen]?.label ?? ""}</span><Icon name="chevron" />
      </button>
      <ul ref={list} id={`${id}-list`} role="listbox" aria-label={label} className={cx("select-pop", up && "select-up")} hidden={!open}>
        {options.map((o, i) => <li key={o.value} id={`${id}-o${i}`} role="option" aria-selected={i === chosen} className={cx("select-opt", i === active && "select-active")} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}><span>{o.label}</span>{i === chosen && <Icon name="check" />}</li>)}
      </ul>
    </span>
  );
}
export function SelectField({ id, label, value, onChange, options, srOnlyLabel }: { id: string; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; srOnlyLabel?: boolean }) {
  return <div className="field-row"><label className={srOnlyLabel ? "sr-only" : "label"} htmlFor={id}>{label}</label><Select id={id} value={value} onChange={onChange} options={options} /></div>;
}
export const Checkbox = ({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) =>
  <label className="check" htmlFor={id}><input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span>{label}</span></label>;
// A list of short values typed into one box: Enter or a comma turns the text into a chip, Backspace in an empty box removes the last chip, and each chip has its own remove button.
// The box keeps its raw text while you type, so commas and spaces are never stripped; a pasted "a, b" becomes two chips; leaving the box adds whatever is left.
export function TagInput({ id, label, values, onChange, placeholder, hint, listLabel, removeLabel }: { id: string; label: string; values: string[]; onChange: (v: string[]) => void; placeholder?: string; hint?: string; listLabel: string; removeLabel: (value: string) => string }) {
  const [text, setText] = useState("");
  const has = (list: string[], v: string) => list.some((x) => x.toLowerCase() === v.toLowerCase());
  const add = (parts: string[]) => { const next = [...values]; for (const p of parts.map((x) => x.trim()).filter(Boolean)) if (!has(next, p)) next.push(p); if (next.length !== values.length) onChange(next); };
  const typed = (v: string) => { if (!v.includes(",")) { setText(v); return; } const parts = v.split(","); setText(parts.pop() ?? ""); add(parts); };
  const key = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); if (text.trim()) { add([text]); setText(""); } }
    else if (e.key === "Backspace" && text === "" && values.length) onChange(values.slice(0, -1));
  };
  return <div className="field-row"><label className="label" htmlFor={id}>{label}</label>
    <div className="tagin">
      {values.length > 0 && <ul className="tag-list" aria-label={listLabel}>{values.map((v) => <li key={v} className="tag"><span>{v}</span><button type="button" className="chip-x" aria-label={removeLabel(v)} onClick={() => onChange(values.filter((x) => x !== v))}><Icon name="close" /></button></li>)}</ul>}
      <input id={id} className="tagin-input" type="text" value={text} placeholder={values.length ? undefined : placeholder} autoComplete="off" onChange={(e) => typed(e.target.value)} onKeyDown={key} onBlur={() => { if (text.trim()) { add([text]); setText(""); } }} />
    </div>
    {hint && <span className="field-hint">{hint}</span>}</div>;
}
// A set of options to switch on and off, shown as a row of chips. Each chip is a real checkbox inside a labelled group, so keyboard and screen-reader use is the same as for any checkbox.
export function ChipChoices({ legend, options, selected, onChange, idPrefix }: { legend: string; options: { value: string; label: string }[]; selected: string[]; onChange: (v: string[]) => void; idPrefix: string }) {
  return <fieldset className="chip-choices"><legend className="label">{legend}</legend>
    <div className="chip-choices-row">{options.map((o) => <label key={o.value} className="opt" htmlFor={`${idPrefix}-${o.value}`}><input id={`${idPrefix}-${o.value}`} type="checkbox" className="sr-only" checked={selected.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...selected, o.value] : selected.filter((x) => x !== o.value))} /><span>{o.label}</span></label>)}</div>
  </fieldset>;
}
// A yes/no setting as a toggle switch (still a real checkbox underneath, with the switch role).
export const Switch = ({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) =>
  <label className="check set-row" htmlFor={id}><span className="set-text"><span className="set-title">{label}</span></span><input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} /></label>;
// A grey rounded surface. Use `Card` for a block of content and `SettingsCard` (rows with hairlines between them) for settings.
export const Card = ({ title, children, testId, label, className }: { title?: string; children: ReactNode; testId?: string; label?: string; className?: string }) =>
  <section className={cx("card", className)} data-testid={testId} aria-label={label}>{title && <h2>{title}</h2>}{children}</section>;
export const SettingsCard = ({ children }: { children: ReactNode }) => <div className="set-card">{children}</div>;
// One setting: its name and a note on the left, its control on the right.
export const SettingRow = ({ id, title, note, stack, children }: { id?: string; title: string; note?: string; stack?: boolean; children: ReactNode }) => (
  <div className={cx("set-row", stack && "set-stack")}><div className="set-text">{id ? <label className="set-title" htmlFor={id}>{title}</label> : <h3 className="set-title">{title}</h3>}{note && <span className="muted small">{note}</span>}</div><div className="set-control">{children}</div></div>
);
export const PageHeader = ({ title, children }: { title: string; children?: ReactNode }) => <header className="page-head"><h1 className="page-title">{title}</h1>{children && <div className="page-actions">{children}</div>}</header>;

// The bare controls, for places where the label already sits somewhere else (a settings row, a month and year pair, a typed-phrase box): they only draw the box.
export function Input({ id, value, onChange, type = "text", narrow, placeholder, min, max, ariaLabel, autoComplete = "off" }: { id?: string; value: string | number; onChange: (v: string) => void; type?: string; narrow?: boolean; placeholder?: string; min?: number; max?: number; ariaLabel?: string; autoComplete?: string }) {
  return <input id={id} className={cx("field", narrow && "narrow")} type={type} value={value} placeholder={placeholder} min={min} max={max} aria-label={ariaLabel} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} />;
}
export const TextArea = ({ id, value, onChange, rows = 3, ariaLabel, placeholder }: { id?: string; value: string; onChange: (v: string) => void; rows?: number; ariaLabel?: string; placeholder?: string }) =>
  <textarea id={id} className="field small-area" rows={rows} value={value} placeholder={placeholder} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} />;

// Light, dark or follow the Mac: three real radio buttons, each with a small drawn picture of the look. Used in Settings and in the first-run guide.
const LookPicture = ({ tone }: { tone: "light" | "dark" }) => <span className={`lp look-${tone}`}><span className="lp-side" /><span className="lp-main"><span className="lp-bar" /><span className="lp-line" /><span className="lp-line lp-short" /><span className="lp-pill" /></span></span>;
export function AppearancePicker({ value, onChange, legend, labels }: { value: string; onChange: (v: "light" | "dark" | "system") => void; legend: string; labels: { light: string; dark: string; system: string } }) {
  return (
    <fieldset className="look-pick" data-testid="appearance"><legend className="sr-only">{legend}</legend>
      {(["light", "dark", "system"] as const).map((k) => (
        <label key={k} className="look-tile"><input type="radio" name="appearance" value={k} checked={value === k} onChange={() => onChange(k)} />
          <span className={`look-frame${k === "system" ? " look-system" : ""}`} aria-hidden="true">{k === "system" ? <><LookPicture tone="light" /><span className="lp-half"><LookPicture tone="dark" /></span></> : <LookPicture tone={k} />}</span>
          <span className="look-name">{labels[k]}</span></label>
      ))}
    </fieldset>
  );
}
