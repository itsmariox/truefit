// The OpenAI implementation of the provider seam: ONE direct call to the Responses API (POST /v1/responses), so what is sent is exactly what we built: the skill as `instructions`, the
// prompt as one user message, our JSON schema in strict mode, no tools (the company brief alone gets web search), nothing stored. It works with an OpenAI API key or with a ChatGPT-plan
// access token (Sign in with ChatGPT, "ChatGPT plan usage"); both use the same endpoint and request, which satisfies the plan path's rules (store:false, stream:true, no system-role
// message, no temperature). Nothing is bundled and no program is run. Written from OpenAI's published docs (read 2026-11-19); never run against the real service.
import { redact } from "../checks.ts";
import { SCHEMAS } from "./schemas.ts";
import { openaiCostUsd } from "./openai-prices.ts";
import type { Mode } from "../access/state.ts";
import type { ModelProvider, ProviderCall, ProviderFailure, ProviderOutcome, ProviderRun } from "./provider.ts";

export type OpenAIAuth = { kind: "apiKey" | "plan"; token: string };
// Thrown by `getAuth` when there is no usable credential (nothing saved, the saved one cannot be read, the sign-in must be redone). It becomes a pause, never a crash.
export class OpenAIAuthError extends Error { type: "authentication_failed" | "oauth_org_not_allowed"; constructor(msg: string, type: "authentication_failed" | "oauth_org_not_allowed" = "authentication_failed") { super(msg); this.type = type; } }
export type OpenAIProviderDeps = { getAuth: (mode: Mode | undefined) => Promise<OpenAIAuth>; fetch?: typeof fetch; baseUrl?: string };
export const OPENAI_BASE_URL = "https://api.openai.com/v1";
const MAX_STREAM_BYTES = 8_000_000, MAX_ERROR_BYTES = 4000;

// Which of our error types the access layer already understands (agents/errors.ts, access/state.ts) an OpenAI status and error code stands for.
export function openaiErrorType(status: number | null, code: string | undefined): string {
  const c = code ?? "";
  if (c === "subscription_sharing_user_not_eligible") return "oauth_org_not_allowed";
  if (c === "insufficient_quota" || c === "billing_hard_limit_reached") return "billing_error";
  if (c === "subscription_sharing_usage_limit_exceeded" || c === "rate_limit_exceeded" || status === 429) return "rate_limit";
  if (c === "subscription_sharing_invalid_user" || c === "invalid_api_key" || c === "invalid_grant" || status === 401) return "authentication_failed";
  if (c === "subscription_sharing_usage_unavailable" || c === "subscription_sharing_user_unavailable" || status === 503) return "overloaded";
  if (c === "model_not_found" || status === 404) return "model_not_found";
  if (c === "server_error" || c === "internal_error") return "server_error";
  if (status !== null && status >= 500) return "server_error";
  if (status === 400 || status === 403 || c.startsWith("subscription_sharing_") || c.startsWith("chatpass_")) return "invalid_request";
  return "unknown";
}

function sseEvents(chunks: string) { // pure helper: the JSON payloads of the complete events in a buffer, and what is left over
  const parts = chunks.split(/\r?\n\r?\n/), rest = parts.pop() ?? "", events: any[] = [];
  for (const p of parts) {
    const data = p.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") continue;
    try { events.push(JSON.parse(data)); } catch { /* a malformed event is skipped; completion is judged by response.completed only */ }
  }
  return { events, rest };
}
const textOf = (resp: any): { text: string; refusal: string | null } => {
  let text = "", refusal: string | null = null;
  for (const item of resp?.output ?? []) if (item?.type === "message") for (const part of item.content ?? []) { if (part?.type === "output_text" && typeof part.text === "string") text += part.text; else if (part?.type === "refusal") refusal = String(part.refusal ?? "refused"); }
  return { text, refusal };
};

export function createOpenAIProvider(d: OpenAIProviderDeps): ModelProvider {
  const doFetch = d.fetch ?? fetch, base = (d.baseUrl ?? OPENAI_BASE_URL).replace(/\/$/, "");
  const fail = (call: ProviderCall, f: Partial<ProviderFailure> & { text: string }, kind: string): ProviderOutcome => ({ type: "finished", usage: null, answer: null, failure: { msg: `${call.role} failed: ${f.text}`, type: f.type, status: f.status ?? null, text: f.text, apiKeySource: kind, resetsAt: f.resetsAt ?? null } });
  return {
    id: "openai",
    preflight: (mode: Mode | undefined) => (mode === "subscription" || mode === "apiKey" || mode === undefined ? [] : [`unknown way to connect: ${String(mode)}`]),
    async run(call: ProviderCall, o: ProviderRun, mode: Mode | undefined): Promise<ProviderOutcome> {
      let auth: OpenAIAuth;
      try { auth = await d.getAuth(mode); } catch (e) { if (!(e instanceof OpenAIAuthError)) throw e; /* a network failure while renewing: the runner pauses it as "unavailable" */ return fail(call, { text: redact(e.message, 200), type: e.type }, mode === "apiKey" ? "OPENAI_API_KEY" : "chatgpt_plan"); }
      const source = auth.kind === "apiKey" ? "OPENAI_API_KEY" : "chatgpt_plan";
      const scrub = (t: string, max = 200) => redact(auth.token ? t.split(auth.token).join("[redacted]") : t, max); // the exact credential is removed from anything we keep, whatever its shape
      // never switch silently: the credential must be the kind the user chose (PRD 09). Nothing has been sent yet.
      if (mode && (mode === "apiKey") !== (auth.kind === "apiKey")) return { type: "breach", problems: [`this call would use "${source}" but the chosen way to connect is "${mode}"`] };
      const body: Record<string, unknown> = {
        model: call.model, instructions: call.system, input: [{ role: "user", content: call.prompt }],
        text: { format: { type: "json_schema", name: call.schema, strict: true, schema: SCHEMAS[call.schema] } },
        store: false, stream: true,
        ...(call.web ? { tools: [{ type: "web_search" }] } : {}),
      };
      let res: Response;
      try {
        res = await doFetch(`${base}/responses`, { method: "POST", headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(body), signal: o.abort.signal });
      } catch (e) { if (o.timedOut()) return { type: "timeout" }; throw e; } // a dropped connection with nothing said: the runner turns it into an "unavailable" pause
      const headerRetry = Number(res.headers.get("retry-after"));
      const resetsAt = auth.kind === "apiKey" && Number.isFinite(headerRetry) && headerRetry > 0 ? new Date(Date.now() + headerRetry * 1000).toISOString() : null; // a plan limit never gets a guessed reset time (OpenAI says not to infer one)
      if (!res.ok) {
        let raw = ""; try { raw = (await res.text()).slice(0, MAX_ERROR_BYTES); } catch { /* ignore */ }
        let code: string | undefined, message = raw; try { const j = JSON.parse(raw); code = j?.error?.code ?? j?.error?.type; message = j?.error?.message ?? j?.detail ?? raw; } catch { /* a non-JSON body is only diagnostic text */ }
        return fail(call, { text: scrub(`HTTP ${res.status}${code ? " " + code : ""}: ${String(message)}`), type: openaiErrorType(res.status, code), status: res.status, resetsAt }, source);
      }
      if (!res.body) return fail(call, { text: "the service sent no stream", type: "server_error", status: res.status }, source);
      let buf = "", bytes = 0, completed: any = null, failed: any = null, incomplete: any = null, errEvent: any = null, streamed = "";
      const reader = res.body.getReader(), dec = new TextDecoder();
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          bytes += value.byteLength; if (bytes > MAX_STREAM_BYTES) { await reader.cancel().catch(() => undefined); return fail(call, { text: "the answer was larger than allowed", type: "unknown" }, source); }
          const r = sseEvents(buf + dec.decode(value, { stream: true })); buf = r.rest;
          for (const ev of r.events) {
            if (ev?.type === "response.output_text.delta" && typeof ev.delta === "string") streamed += ev.delta;
            else if (ev?.type === "response.completed") completed = ev.response;
            else if (ev?.type === "response.failed") failed = ev.response;
            else if (ev?.type === "response.incomplete") incomplete = ev.response;
            else if (ev?.type === "error") errEvent = ev;
          }
        }
      } catch (e) { if (o.timedOut()) return { type: "timeout" }; if (!completed && !failed && !incomplete && !errEvent) throw e; }
      if (o.timedOut() && !completed) return { type: "timeout" };
      const u = (completed ?? failed ?? incomplete)?.usage;
      const tokens = u ? { input: Number(u.input_tokens) || 0, cachedInput: Number(u.input_tokens_details?.cached_tokens) || 0, cacheWrite: Number(u.input_tokens_details?.cache_write_tokens) || 0, output: Number(u.output_tokens) || 0 } : null;
      const usage = tokens ? { inTokens: tokens.input, outTokens: tokens.output, costUsd: openaiCostUsd(call.model, tokens) ?? 0 } : null;
      // success only on response.completed (OpenAI: "Treat inference as successful only after receiving response.completed")
      if (!completed) {
        const e = failed?.error ?? errEvent?.error ?? errEvent ?? null, code: string | undefined = e?.code ?? (incomplete ? "incomplete" : undefined);
        const text = scrub(incomplete ? `the answer was cut short (${incomplete.incomplete_details?.reason ?? "incomplete"})` : e ? `${code ?? "error"}: ${e.message ?? ""}` : "the stream ended without response.completed");
        return { type: "finished", usage, answer: null, failure: { msg: `${call.role} failed: ${text}`, type: incomplete ? "max_output_tokens" : code || e ? openaiErrorType(code === "subscription_sharing_usage_limit_exceeded" ? 429 : null, code) : "server_error", status: null, text, apiKeySource: source, resetsAt } };
      }
      const { text, refusal } = textOf(completed), raw = text || streamed;
      if (refusal) return { type: "finished", usage, answer: null, failure: { msg: `${call.role} failed: the model refused`, type: "invalid_request", status: null, text: scrub(`refused: ${refusal}`), apiKeySource: source, resetsAt } };
      let answer: unknown; try { answer = JSON.parse(raw); } catch { return { type: "finished", usage, answer: null, failure: { msg: `${call.role} failed: the answer was not valid JSON`, type: "unknown", status: null, text: "the answer was not valid JSON", apiKeySource: source, resetsAt } }; }
      if (!answer || typeof answer !== "object") return { type: "finished", usage, answer: null, failure: { msg: `${call.role} failed: the answer was not an object`, type: "unknown", status: null, text: "the answer was not an object", apiKeySource: source, resetsAt } };
      return { type: "finished", usage, answer };
    },
  };
}
