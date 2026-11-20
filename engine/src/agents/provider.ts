// The seam between the agent runner and whichever AI service answers (phase 1 of the OpenAI option). The runner builds the prompt, asks the spend-cap gate, writes the
// answer file and reports usage; a PROVIDER does the one vendor-specific thing: send one call and say what came back, in the same plain shape whatever the vendor.
// Nothing here is Claude- or OpenAI-specific. The Claude implementation is claude-provider.ts; a fake provider for tests is in tests/ (and the app's test build).
import type { ClaudeCall } from "./options.ts";
import type { Mode } from "../access/state.ts";

export type ProviderCall = ClaudeCall;                       // role label, model, system prompt, prompt, schema name, web search allowed, timeout
export type Usage = { inTokens: number; outTokens: number; costUsd: number };
// A failed call, as the provider learned it. `msg` is the composed one-line message (already redacted), `text` the redacted words of the service, `type` its error type.
export type ProviderFailure = { msg: string; type?: string; status?: number | null; text: string; apiKeySource?: string; resetsAt?: string | null };
export type ProviderOutcome =
  | { type: "breach"; problems: string[] }                   // the session contained more than we asked for, or used a credential other than the chosen one: nothing it said is used
  | { type: "timeout" }                                      // stopped by the runner's timer before any result
  | { type: "finished"; usage: Usage | null; answer: unknown | null; failure?: ProviderFailure }; // usage is null when the service never reported a result; answer is the structured answer
export type ProviderRun = { abort: AbortController; timedOut: () => boolean }; // the runner owns the timer; the provider must stop when `abort` fires

export interface ModelProvider {
  readonly id: string;                                       // "claude", later "openai"
  // The guard that acts BEFORE anything is sent: the chosen way to connect and the credentials this provider would use must agree. Returns the problems (empty = fine).
  preflight(mode: Mode | undefined): string[];
  // Sends ONE call. May throw (a dropped connection with nothing said before it); the runner turns a throw into a failure code.
  run(call: ProviderCall, o: ProviderRun, mode: Mode | undefined): Promise<ProviderOutcome>;
}
