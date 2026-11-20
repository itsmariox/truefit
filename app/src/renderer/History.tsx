// History (phase 7): every job, searchable by company or role, with a verdict filter and an order. Rows open the job.
import { useCallback, useEffect, useRef, useState } from "react";
import type { CvAppBridge, UiHistory, UiSummary } from "../shared/contract.ts";
import { HISTORY as T } from "./settings-messages.ts";
import { Field, SelectField, VerdictMark } from "./ui.tsx";

const PAGE = 200; // the main process sends 200 rows a page; "Show more" asks for the next page, with no upper limit
export function History({ bridge, onOpen }: { bridge: CvAppBridge; onOpen: (id: string) => void }) {
  const [text, setText] = useState(""), [verdict, setVerdict] = useState(""), [sort, setSort] = useState("newest"), [busy, setBusy] = useState(false);
  const [data, setData] = useState<UiHistory | null>(null), [sum, setSum] = useState<UiSummary | null>(null), [problem, setProblem] = useState<string | null>(null);
  const shown = useRef(0); shown.current = data?.rows.length ?? 0;
  const ask = useCallback((offset: number) => bridge.invoke("history:search", { text, verdict: (verdict || undefined) as never, sort: sort as never, offset: String(offset) }), [bridge, text, verdict, sort]);
  // A new search, filter or order starts again at the first page; a change to the jobs reloads as many pages as are on screen.
  useEffect(() => {
    let live = true; const reload = async () => {
      const pages = Math.max(1, Math.ceil(shown.current / PAGE)); let rows: UiHistory["rows"] = [], total = 0;
      for (let i = 0; i < pages; i++) { const r = await ask(i * PAGE); if (!live) return; if (!r.ok) { setProblem(r.error.message); return; } rows = rows.concat(r.data.rows); total = r.data.total; if (r.data.rows.length < PAGE) break; }
      setProblem(null); setData({ rows, total });
    };
    const t = setTimeout(() => { shown.current = 0; void reload(); }, 150);
    const off = bridge.on("jobs:changed", () => { void reload(); });
    return () => { live = false; clearTimeout(t); off(); };
  }, [bridge, ask]);
  const more = async () => { if (!data || busy) return; setBusy(true); const r = await ask(data.rows.length); setBusy(false); if (!r.ok) { setProblem(r.error.message); return; } setData((cur) => cur && { total: r.data.total, rows: [...cur.rows, ...r.data.rows.filter((x) => !cur.rows.some((y) => y.id === x.id))] }); };
  useEffect(() => { void bridge.invoke("history:summary").then((r) => { if (r.ok) setSum(r.data); }); }, [bridge, data?.total]);
  return (
    <div className="profile" data-testid="history">
      <h1 className="page-title">{T.title}</h1><p className="muted">{T.intro}</p>
      {sum && <p className="muted small" data-testid="history-summary">{T.summary(sum)}</p>}
      <div className="inline-row">
        <Field id="h-q" label={T.search} srOnlyLabel placeholder={T.search} type="search" value={text} onChange={setText} />
        <SelectField id="h-v" srOnlyLabel label={T.all} value={verdict} onChange={setVerdict} options={[{ value: "", label: T.all }, ...(["apply", "long_shot", "skip"] as const).map((v) => ({ value: v, label: T.verdicts[v] }))]} />
        <SelectField id="h-s" srOnlyLabel label={T.sort} value={sort} onChange={setSort} options={Object.entries(T.sorts).map(([k, l]) => ({ value: k, label: l }))} />
      </div>
      {problem && <p role="alert" className="problem" data-testid="problem">{problem}</p>}
      {data && data.rows.length === 0 && <p className="muted" data-testid="history-empty">{text || verdict ? T.empty : T.none}</p>}
      <ul className="history-list">{data?.rows.map((r) => (
        <li key={r.id}><button type="button" className="job-row" onClick={() => onOpen(r.id)} data-testid="history-row">
          <VerdictMark kind={r.verdict ?? (r.status === "paused" ? "wait" : "none")} label={r.verdict ? T.verdicts[r.verdict] : r.status === "paused" ? "Needs you" : "Not analysed"} />
          <span className="job-text"><span className="job-title">{r.title}</span><span className="job-sub" aria-hidden="true"></span></span><span className="job-side" aria-hidden="true">{r.fit !== null && <span className="job-fit">{r.fit}</span>}<span className="job-sub">{r.verdict ? T.verdicts[r.verdict] : r.status === "paused" ? "Needs you" : r.status.charAt(0).toUpperCase() + r.status.slice(1)}</span></span></button></li>))}</ul>
      {data && data.total > data.rows.length && <div className="row"><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void more()} data-testid="history-more">{T.more(data.rows.length, data.total)}</button></div>}
    </div>
  );
}
