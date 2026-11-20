// The handlers for start-up and Claude access (phase 4e). The main process builds the wording from the APPROVED message catalogue (engine/src/access/messages.ts); the page only
// shows it. Nothing here touches Electron: the clipboard and the event push are passed in.
import { ACTION_LABELS, SUBSCRIPTION_NOTICE, describeConnect, describeSignInEvent, describeSignInResult, describeState, describeTest, type Message } from "../../../engine/src/access/messages.ts";
import { usable } from "../../../engine/src/access/state.ts";
import { OPENAI_ACTION_LABELS, OPENAI_PLAN_NOTICE, describeOpenAIConnect, describeOpenAISignInEvent, describeOpenAISignInResult, describeOpenAIState, describeOpenAITest } from "../../../engine/src/access/messages-openai.ts";
import type { AccessView, ActionResult, SignInProgress, UiMessage } from "../shared/contract.ts";
import type { Handlers } from "./ipc.ts";
import type { Host } from "./core/host.ts";

export const toUi = (m: Message, labels: Record<string, string> = ACTION_LABELS): UiMessage => ({ id: m.id, tone: m.tone, title: m.title, body: m.body, actions: m.actions.map((id) => ({ id, label: labels[id] ?? ACTION_LABELS[id] })), details: m.details });
type CoreHandlerNames = "app:status" | "app:recover" | "app:startFresh" | "app:copy" | "access:get" | "access:chooseMode" | "access:acceptNotice" | "access:saveKey" | "access:test" | "access:signIn" | "access:cancelSignIn" | "access:submitCode" | "access:chooseProvider" | "access:signOut";

export function createCoreHandlers(d: { host: Host; now?: () => Date; push: { signin(p: SignInProgress): void; changed(v: AccessView): void }; copy: (text: string) => void }): Pick<Handlers, CoreHandlerNames> {
  const now = () => d.now?.() ?? new Date();
  const core = () => { const c = d.host.core(); if (!c) throw new Error("not ready"); return c; };
  // Everything the page is shown is worded for the service in use: Claude's catalogue is unchanged, OpenAI has its own (messages-openai.ts).
  const words = (provider: "claude" | "openai") => provider === "openai"
    ? { labels: OPENAI_ACTION_LABELS as Record<string, string>, state: describeOpenAIState, test: describeOpenAITest, connect: describeOpenAIConnect, event: describeOpenAISignInEvent as (e: never) => Message, result: describeOpenAISignInResult as (r: never) => Message, notice: OPENAI_PLAN_NOTICE as { title: string; intro: string; points: readonly { heading: string; text: string }[]; checkbox: string } }
    : { labels: ACTION_LABELS as Record<string, string>, state: describeState, test: describeTest, connect: describeConnect, event: describeSignInEvent as (e: never) => Message, result: describeSignInResult as (r: never) => Message, notice: SUBSCRIPTION_NOTICE as { title: string; intro: string; points: readonly { heading: string; text: string }[]; checkbox: string } };
  async function view(): Promise<AccessView> {
    const c = core(), st = await c.access.state(), s = c.settings.get().settings, provider = c.access.provider(), w = words(provider);
    return { provider, message: toUi(w.state(st, now()), w.labels), kind: st.kind, mode: s["claude.mode"], noticeAccepted: !!s[provider === "openai" ? "openai.noticeAcceptedAt" : "claude.noticeAcceptedAt"], connected: usable(st), // an API key that was saved is usable (it is proven by the call made when it was saved)
      notice: { title: w.notice.title, intro: w.notice.intro, points: w.notice.points.map((p) => ({ heading: p.heading, text: p.text })), checkbox: w.notice.checkbox } };
  }
  const changed = async () => { const v = await view(); d.push.changed(v); return v; };
  let signingIn = false;
  return {
    "app:status": () => d.host.status(),
    "app:recover": ({ id }) => d.host.recover(id),
    "app:startFresh": ({ confirmed }) => d.host.startFresh(confirmed),
    "app:copy": ({ text }) => { d.copy(text); return { copied: true }; },
    "access:get": () => view(),
    "access:chooseMode": async ({ mode }) => { core().access.chooseMode(mode); return changed(); },
    "access:chooseProvider": async ({ provider }) => { core().access.chooseProvider(provider); return changed(); },
    "access:signOut": async ({ forget }) => { const r = await core().access.signOutOpenAI(forget); await changed(); return r; },
    "access:acceptNotice": async () => { core().access.acceptNotice(); return changed(); },
    "access:saveKey": async ({ key }): Promise<ActionResult> => {
      const r = await core().access.saveKey(key); const v = await changed();
      const w = words(core().access.provider()); return { view: v, message: toUi(w.connect(r as never, { now: now() }), w.labels) };
    },
    "access:test": async (): Promise<ActionResult> => {
      const c = core(), mode = c.settings.get().settings["claude.mode"];
      const r = await c.access.testConnection();
      const w = words(c.access.provider());
      const message = r.ok === false && r.kind === ("not_chosen" as never) ? toUi(w.state({ kind: "not_chosen" }, now()), w.labels) : toUi(w.test(r as never, { now: now(), mode: mode ?? "subscription" }), w.labels);
      return { view: await changed(), message };
    },
    "access:signIn": () => {
      const c = core(); // first: with no core nothing is marked as running
      if (signingIn) return { started: false };
      signingIn = true; let link: string | null = null, awaitingCode = false;
      const w = words(c.access.provider());
      const send = (m: Message, running: boolean) => d.push.signin({ running, message: toUi(m, w.labels), link, awaitingCode });
      void c.access.startSignIn((e) => { if (e.type === "link") link = e.url; if (e.type === "code_requested") awaitingCode = true; send(w.event(e as never), true); })
        .then((r) => { link = null; awaitingCode = false; send(w.result(r as never), false); })
        .catch(() => { send(w.result({ ok: false, reason: "failed" } as never), false); })
        .finally(() => { signingIn = false; void changed().catch(() => undefined); });
      return { started: true };
    },
    "access:cancelSignIn": () => { core().access.cancelSignIn(); return { cancelled: true }; },
    "access:submitCode": ({ code }) => ({ accepted: core().access.submitCode(code) }),
  };
}
