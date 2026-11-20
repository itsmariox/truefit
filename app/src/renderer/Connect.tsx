// The Connect screen (phase 4e): choose subscription or API key, read and tick the notice, sign in (link, code, cancel), enter and test a key. The wording comes from the main
// process (the approved catalogue); this file only decides what to show and which button does what. Reused by onboarding (phase 5) and Settings (phase 7).
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccessView, CvAppBridge, SignInProgress, UiMessage } from "../shared/contract.ts";
import { Banner, Button, Checkbox, Field } from "./ui.tsx";
import { serviceName, setService } from "./service.ts";

const HANDLED = new Set(["choose_subscription", "choose_api_key", "read_notice", "signin", "reconnect", "enter_key", "test", "retry", "switch_to_key", "switch_to_subscription", "open_account", "copy_diagnostics", "cancel"]);
const ACCOUNT_URL = { claude: "https://claude.ai/", openaiPlan: "https://chatgpt.com/settings/usage", openaiKey: "https://platform.openai.com/" };

export function Connect({ bridge, initial, onView, embedded }: { bridge: CvAppBridge; initial?: AccessView | null; onView?: (v: AccessView) => void; embedded?: boolean }) {
  const [view, setView] = useState<AccessView | null>(initial ?? null);
  const [result, setResult] = useState<UiMessage | null>(null);
  const [signin, setSignin] = useState<SignInProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNotice, setShowNotice] = useState(false), [ticked, setTicked] = useState(false);
  const [showKey, setShowKey] = useState(false), [key, setKey] = useState(""), [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [switchTo, setSwitchTo] = useState<"claude" | "openai" | null>(null);
  const alive = useRef(true); useEffect(() => () => { alive.current = false; }, []);

  const take = useCallback((v: AccessView) => { if (!alive.current) return; setService(v.provider); setView(v); onView?.(v); }, [onView]);
  const call = useCallback(async <T,>(f: () => Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>): Promise<T | null> => {
    setBusy(true); setProblem(null);
    try { const r = await f(); if (!alive.current) return null; if (r.ok) return r.data; setProblem(r.error.message); return null; } finally { if (alive.current) setBusy(false); }
  }, []);

  useEffect(() => {
    if (!view) void bridge.invoke("access:get").then((r) => { if (!alive.current) return; if (r.ok) take(r.data); else setProblem(r.error.message); });
    const offChanged = bridge.on("access:changed", (v) => take(v));
    const offSignin = bridge.on("access:signin", (p) => { if (alive.current) setSignin(p.running ? p : null); if (!p.running && alive.current) setResult(p.message); });
    return () => { offChanged(); offSignin(); };
  }, [bridge, take, view]);

  if (view) setService(view.provider); // before anything below is drawn, so every table reads the right service name
  if (!view) return <div className="connect">{problem ? <p role="alert" className="problem" data-testid="problem">{problem}</p> : <p className="muted">Checking your connection…</p>}</div>;

  const mode = view.mode, needsKey = mode === "apiKey" && !view.connected && view.kind !== "key_saved";
  const act = async (id: string) => {
    setResult(null);
    switch (id) {
      case "choose_subscription": case "switch_to_subscription": { const v = await call(() => bridge.invoke("access:chooseMode", { mode: "subscription" })); if (v) { take(v); setShowKey(false); setShowNotice(!v.noticeAccepted); } break; }
      case "choose_api_key": case "switch_to_key": { const v = await call(() => bridge.invoke("access:chooseMode", { mode: "apiKey" })); if (v) { take(v); setShowNotice(false); setShowKey(true); } break; }
      case "read_notice": setShowNotice(true); break;
      case "enter_key": setShowKey(true); break;
      case "signin": case "reconnect": { const r = await call(() => bridge.invoke("access:signIn")); if (r && !r.started) setProblem("A sign-in is already open. Finish it in your browser, or cancel it."); break; }
      case "test": case "retry": { const r = await call(() => bridge.invoke("access:test")); if (r) { take(r.view); setResult(r.message); } break; }
      case "open_account": await call(() => bridge.invoke("app:openLink", { url: view.provider === "openai" ? (mode === "apiKey" ? ACCOUNT_URL.openaiKey : ACCOUNT_URL.openaiPlan) : ACCOUNT_URL.claude })); break;
      case "copy_diagnostics": await call(() => bridge.invoke("app:copy", { text: [result?.details, view.message.details].filter(Boolean).join("\n") })); break;
      case "cancel": await call(() => bridge.invoke("access:cancelSignIn")); break;
    }
  };
  // Switching service forgets how this Mac is connected to the current one, and a job started with one service can only be carried on by that service: so a switch from a set-up connection asks first.
  const choose = (p: "claude" | "openai") => { if (p === view.provider) return; setResult(null); if (view.mode !== null || view.connected) { setSwitchTo(p); return; } void doSwitch(p); };
  const doSwitch = async (p: "claude" | "openai") => { setSwitchTo(null); setShowKey(false); setShowNotice(false); setTicked(false); const v = await call(() => bridge.invoke("access:chooseProvider", { provider: p })); if (v) take(v); };
  const disconnect = async (forget = false) => { setResult(null); const r = await call(() => bridge.invoke("access:signOut", { forget })); if (r) { const v = await call(() => bridge.invoke("access:get")); if (v) take(v); setResult({ id: "oai.signout", tone: r.revoked ? "ok" : "warn", title: r.revoked ? "ChatGPT is disconnected" : "ChatGPT is disconnected on this Mac", body: r.revoked ? "The saved sign-in was removed from this Mac and OpenAI was told to end it." : "The saved sign-in was removed from this Mac. OpenAI could not be reached to end it, so you may also want to remove this app in your ChatGPT settings.", actions: [], details: `revoked=${r.revoked}` }); } };
  const accept = async () => { const v = await call(() => bridge.invoke("access:acceptNotice")); if (v) { take(v); setShowNotice(false); setTicked(false); } };
  const saveKey = async () => { const r = await call(() => bridge.invoke("access:saveKey", { key: key.trim() })); if (r) { take(r.view); setResult(r.message); if (r.message?.tone === "ok") { setKey(""); setShowKey(false); } } };

  return (
    <div className="connect" data-testid="connect">
      {embedded ? <h2 className="section-title">{serviceName()}</h2> : <h1 className="page-title">Connect to {serviceName()}</h1>}
      {!signin && (
        <div className="row" role="group" aria-label="AI service" data-testid="provider-choice">
          <Button kind={view.provider === "claude" ? "primary" : undefined} aria-pressed={view.provider === "claude"} disabled={busy} onClick={() => choose("claude")}>Claude</Button>
          <Button kind={view.provider === "openai" ? "primary" : undefined} aria-pressed={view.provider === "openai"} disabled={busy} onClick={() => choose("openai")}>OpenAI (ChatGPT plan or API key)</Button>
        </div>
      )}
      {view.provider === "openai" && !signin && <p className="muted small" data-testid="beta-note"><strong>Beta.</strong> Connecting to OpenAI is new and has not been tried with many accounts yet. If something doesn't work, use an API key or switch to Claude, and tell us what happened.</p>}
      {switchTo && (
        <section className="card" role="alertdialog" aria-labelledby="switch-title" data-testid="switch-confirm">
          <h2 id="switch-title">Switch to {switchTo === "openai" ? "OpenAI" : "Claude"}?</h2>
          <p>This Mac will forget how it is connected to {view.provider === "openai" ? "OpenAI" : "Claude"} and you will connect to {switchTo === "openai" ? "OpenAI" : "Claude"} instead. Saved keys and sign-ins stay where they are. A job that was started with {view.provider === "openai" ? "OpenAI" : "Claude"} can only be carried on by {view.provider === "openai" ? "OpenAI" : "Claude"}: to use {switchTo === "openai" ? "OpenAI" : "Claude"} for it, add the ad again as a new job.</p>
          <div className="row"><Button kind="primary" disabled={busy} onClick={() => void doSwitch(switchTo)}>Switch to {switchTo === "openai" ? "OpenAI" : "Claude"}</Button><Button disabled={busy} onClick={() => setSwitchTo(null)}>Stay with {view.provider === "openai" ? "OpenAI" : "Claude"}</Button></div>
        </section>
      )}
      {problem && <p role="alert" className="problem" data-testid="problem">{problem}</p>}
      {signin ? (
        <section className="card" aria-live="polite" data-testid="signin">
          <Banner message={signin.message} busy={busy} handled={(id) => id === "cancel"} onAction={(id) => void act(id)} />
          {signin.link && <div className="link-box"><span className="label">If the page didn't open, use this link</span><code data-testid="signin-link">{signin.link}</code><Button onClick={() => void bridge.invoke("app:openLink", { url: signin.link! })}>Open the link</Button></div>}
          {signin.awaitingCode && (
            <form className="stack stack-12" onSubmit={(e) => { e.preventDefault(); if (code.trim()) void call(() => bridge.invoke("access:submitCode", { code: code.trim() })).then(() => setCode("")); }}>
              <Field id="signin-code" label="Code from your browser" value={code} onChange={setCode} spellCheck={false} />
              <div className="row"><Button type="submit" disabled={busy || !code.trim()}>Submit code</Button></div>
            </form>
          )}
        </section>
      ) : (
        <Banner message={view.message} busy={busy} handled={(id) => HANDLED.has(id) && !(id === "read_notice" && showNotice)} onAction={(id) => void act(id)} />
      )}
      {showNotice && mode === "subscription" && !view.noticeAccepted && (
        <section className="card notice" data-testid="notice">
          <h2>{view.notice.title}</h2><p>{view.notice.intro}</p>
          <ul>{view.notice.points.map((p) => <li key={p.heading}><strong>{p.heading}.</strong> {p.text}</li>)}</ul>
          <Checkbox id="notice-tick" label={view.notice.checkbox} checked={ticked} onChange={setTicked} />
          <div className="row"><Button kind="primary" disabled={!ticked || busy} onClick={() => void accept()}>Continue</Button></div>
        </section>
      )}
      {(showKey || needsKey) && mode === "apiKey" && !signin && (
        <form className="card" data-testid="key-form" onSubmit={(e) => { e.preventDefault(); if (key.trim()) void saveKey(); }}>
          <Field id="api-key" label="API key" type="password" value={key} onChange={setKey} spellCheck={false} hint={`The key is checked with one tiny call to ${serviceName()}, then stored encrypted on this Mac. It is never shown again.`} />
          <div className="row"><Button type="submit" kind="primary" disabled={busy || !key.trim()}>Save and test</Button></div>
        </form>
      )}
      {view.provider === "openai" && mode === "subscription" && view.connected && !signin && (
        <section className="card" data-testid="plan-in-use">
          <p><strong>Using ChatGPT plan.</strong> Requests from this app count towards your ChatGPT usage.</p>
          <div className="row"><Button disabled={busy} onClick={() => void bridge.invoke("app:openLink", { url: ACCOUNT_URL.openaiPlan })}>Manage usage</Button><Button disabled={busy} onClick={() => void disconnect()}>Disconnect ChatGPT</Button></div>
        </section>
      )}
      {view.provider === "openai" && mode === "subscription" && !signin && (
        <p className="muted small" data-testid="other-account"><Button disabled={busy} onClick={() => void disconnect(true)}>Use a different ChatGPT account</Button> Forgets the account this Mac was connected to, so the next connect can use another one.</p>
      )}
      {result && <Banner message={result} busy={busy} handled={(id) => HANDLED.has(id)} onAction={(id) => void act(id)} />}
    </div>
  );
}
