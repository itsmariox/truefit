// The access runtime (phase 3g): puts the access state, the spend cap, the usage ledger, the key and mode checks and the error memory behind the one thing the pipeline needs,
// a runner. The app shell builds ONE runtime and passes `runnerFor` to the pipeline. Each call: read the chosen way to connect and the key at that moment (never cached), refuse
// as a PAUSE (not a failure) when nothing is connected, run the guarded call, write the ledger, and teach the access state what happened (a success clears the remembered error;
// an error about access is remembered; any other error is not).
import { EXIT } from "../agents/errors.ts";
import { createSdkRunner, type AgentRunner, type QueryFn, type RunnerDeps } from "../agents/runner.ts";
import type { PauseKind } from "./messages.ts";
import { describePause, type Message } from "./messages.ts";
import { describeOpenAIPause } from "./messages-openai.ts";
import { createOpenAIProvider, OpenAIAuthError, type OpenAIProviderDeps } from "../agents/openai-provider.ts";
import { createPlanAuth, createPlanStore, planStatus } from "./openai-plan.ts";
import type { Db } from "../store/db.ts";
import { getSettings } from "../store/settings-store.ts";
import { SECRET_NAMES, type SecretStore } from "../store/secrets.ts";
import { createAccess } from "./access.ts";
import { capGate, capStatus, recordUsage } from "./ledger.ts";
import { checkLoginStatus, type StatusRunner } from "./status.ts";
import { minimalEnv } from "../agents/options.ts";
import type { Mode } from "./state.ts";
import { checkJobAd, CLAUDE_GATE_MODEL, OPENAI_GATE_MODEL, type AdGateResult } from "./adgate.ts";
import { createClaudeProvider } from "../agents/claude-provider.ts";
import { createRecoveryWatcher, type Timers, type WatchEvent, type WatchHandle, type WatchKind } from "./watch.ts";
import type { Profile } from "../profile.ts";
import { markJobService, otherService } from "./job-service.ts";

export type RuntimeDeps = {
  db: Db; secrets: SecretStore; statusRunner: StatusRunner; query: QueryFn; now?: () => Date; timers?: Timers;
  openai?: { fetch?: typeof fetch; baseUrl?: string; authBase?: string };   // where OpenAI is (tests point these at a pretend local service; the product leaves them out)
  base: Omit<RunnerDeps, "profile" | "query" | "mode" | "apiKey" | "beforeCall" | "onUsage">;   // tone, config, skillsDir, tmpRoot, env, writerMode ... from the shell
};

export function createAccessRuntime(d: RuntimeDeps) {
  const now = () => d.now?.() ?? new Date();
  const planStore = createPlanStore(d.secrets);
  const planAuth = createPlanAuth({ store: planStore, fetch: d.openai?.fetch, authBase: d.openai?.authBase, now });
  const access = createAccess({ db: d.db, secrets: d.secrets, run: d.statusRunner, plan: planStore, now, env: d.base.env, configDir: d.base.configDir });
  const settings = () => getSettings(d.db).settings;
  const checkStatus = () => (access.provider() === "openai" ? planStatus(planStore) : checkLoginStatus(d.statusRunner, minimalEnv(d.base.env ?? process.env, { configDir: d.base.configDir })));
  // The OpenAI provider: the credential is read at the moment of each call (never cached): the API key from the secret store, or the ChatGPT-plan token (renewed if needed, once, however many calls ask).
  const openaiAuth: OpenAIProviderDeps["getAuth"] = async (mode) => {
    if (mode === "apiKey") { let k: string | null; try { k = await d.secrets.get(SECRET_NAMES.openaiApiKey); } catch { throw new OpenAIAuthError("the saved API key could not be read"); } if (!k) throw new OpenAIAuthError("no API key is saved"); return { kind: "apiKey", token: k }; }
    return { kind: "plan", token: await planAuth.getAccessToken() };
  };
  const openaiProvider = createOpenAIProvider({ getAuth: openaiAuth, fetch: d.openai?.fetch, baseUrl: d.openai?.baseUrl });
  const DEFAULT_OPENAI_MODELS = { analyst: "gpt-6.2-sol", writer: "gpt-6.2-sol", checker: "gpt-6.2-sol", coach: "gpt-6.2-sol" };
  const watcher = createRecoveryWatcher({ access: { state: () => access.state(), lastError: () => access.lastError(), signedIn: () => access.signedIn(), mode: () => (settings()["claude.mode"] as Mode | null) ?? null }, db: d.db, checkStatus, now, timers: d.timers });

  // Nothing connected is a PAUSE with the sign-in message, never a hard failure: the job keeps its finished steps and Resume works once the user has connected.
  const notReady = (log: string) => ({ code: EXIT.auth as number, log: `call not started: ${log}` });

  return {
    access, planAuth, planStore, openaiProvider,
    // A provider that uses exactly this API key (for proving a pasted key BEFORE it is saved).
    openaiKeyProvider: (apiKey: string) => createOpenAIProvider({ getAuth: async () => ({ kind: "apiKey" as const, token: apiKey }), fetch: d.openai?.fetch, baseUrl: d.openai?.baseUrl }),
    authBase: d.openai?.authBase,
    runnerFor(profile: Profile): AgentRunner {
      return async (dir, role, mode) => {
        const s = settings(), chosen = (s["claude.mode"] as Mode | null) ?? null, openai = access.provider() === "openai", who = openai ? "OpenAI" : "Claude";
        // Backstop for the rule "a job is carried on only by the service that started it" (the app refuses earlier, with words; this keeps any other path honest). Nothing is sent.
        const startedWith = otherService(dir, access.provider()); if (startedWith) return { code: EXIT.setup as number, log: `call not started: this job was started with ${startedWith}` };
        markJobService(dir, access.provider());
        if (!chosen) return notReady(`no way to connect to ${who} has been chosen`);
        if (chosen === "subscription" && !s[openai ? "openai.noticeAcceptedAt" : "claude.noticeAcceptedAt"]) return notReady("the subscription notice has not been accepted");
        let apiKey: string | undefined;
        if (chosen === "apiKey") {
          try { apiKey = (await d.secrets.get(openai ? SECRET_NAMES.openaiApiKey : SECRET_NAMES.claudeApiKey)) ?? undefined; } catch { return notReady("the saved API key could not be read"); }
          if (!apiKey) return notReady("no API key is saved");
        }
        const common = { ...d.base, profile, mode: chosen, now: d.base.now ?? d.now, beforeCall: () => capGate(d.db, now(), chosen), onUsage: (r: Parameters<typeof recordUsage>[1]) => { try { recordUsage(d.db, { ...r, provider: access.provider() }); } catch { /* the ledger must never break a job */ } } };
        const inner = openai
          ? createSdkRunner({ ...common, config: { ...d.base.config, models: d.base.config.openaiModels ?? DEFAULT_OPENAI_MODELS }, provider: d.base.provider ?? openaiProvider })
          : createSdkRunner({ ...common, query: d.query, apiKey });
        const res = await inner(dir, role, mode);
        if (res.code === EXIT.ok) access.recordSuccess(); else if (res.error) access.recordError(res.error);
        return res;
      };
    },
    // The gate in front of "New job" (access/adgate.ts): the same credentials and way to connect as a real call, one small call on the service's cheapest model, the main model as the
    // fallback. Anything that stops it from answering lets the job through ("unsure"): the gate never stands between the user and a real job.
    async checkAd(text: string): Promise<AdGateResult> {
      const s = settings(), chosen = (s["claude.mode"] as Mode | null) ?? null, openai = access.provider() === "openai";
      if (!chosen) return { verdict: "unsure", why: "no way to connect has been chosen" };
      if (chosen === "subscription" && !s[openai ? "openai.noticeAcceptedAt" : "claude.noticeAcceptedAt"]) return { verdict: "unsure", why: "the subscription notice has not been accepted" };
      let apiKey: string | undefined;
      if (chosen === "apiKey") { try { apiKey = (await d.secrets.get(openai ? SECRET_NAMES.openaiApiKey : SECRET_NAMES.claudeApiKey)) ?? undefined; } catch { return { verdict: "unsure", why: "the saved API key could not be read" }; } if (!apiKey) return { verdict: "unsure", why: "no API key is saved" }; }
      const provider = d.base.provider ?? (openai ? openaiProvider : createClaudeProvider({ query: d.query, env: minimalEnv(d.base.env ?? process.env, { apiKey, configDir: d.base.configDir }), tmpRoot: d.base.tmpRoot }));
      const main = openai ? (d.base.config.openaiModels ?? DEFAULT_OPENAI_MODELS).analyst : d.base.config.models.analyst, cheap = openai ? OPENAI_GATE_MODEL : CLAUDE_GATE_MODEL;
      return checkJobAd(text, { provider, mode: chosen, provider_id: openai ? "openai" : "claude", models: cheap === main ? [cheap] : [cheap, main], db: d.db, now });
    },
    // The words for a paused job, with what is known now (the reset time of a limit, the amounts of a spend cap).
    describePause(kind: PauseKind, o: { pausable?: boolean; details?: string } = {}): Message {
      const e = access.lastError(), cap = capStatus(d.db, now());
      return (access.provider() === "openai" ? describeOpenAIPause : describePause)(kind, { now: now(), mode: (settings()["claude.mode"] as Mode | null) ?? null, resetsAt: e?.resetsAt ?? null, capUsd: cap.capUsd, spentUsd: cap.capUsd === null ? null : cap.spentUsd, pausable: o.pausable, details: o.details });
    },
    // Start watching after a job paused. Only events come out; nothing is ever resumed from here.
    watchPause(kind: PauseKind, onEvent: (e: WatchEvent) => void, o: { screenOpen?: boolean } = {}): Promise<WatchHandle> | null {
      const k: WatchKind | null = (["auth", "rate_limit", "cap", "unavailable", "timeout", "account"] as const).find((x) => x === kind) ?? null;
      return k ? watcher.watch(k, onEvent, o) : null;
    },
  };
}
