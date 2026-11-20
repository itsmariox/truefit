// The Claude implementation of the provider seam: the code that used to sit inside runner.ts, moved here unchanged in behaviour. One isolated call through the Claude Agent
// SDK (every tool, MCP server, plugin and setting source closed, see options.ts), the first-message isolation and credential check, and the reading of the result message.
import { mkdtemp, rm } from "node:fs/promises";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { redact } from "../checks.ts";
import { isolatedOptions, isolationProblems, type InitMessage } from "./options.ts";
import { modeProblems, preflightProblems, type Mode } from "../access/state.ts";
import { parseResetsAt } from "../access/watch.ts";
import type { ModelProvider, ProviderCall, ProviderOutcome, ProviderRun } from "./provider.ts";

export type ClaudeQuery = (args: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<any>;
export type ClaudeProviderDeps = { query: ClaudeQuery; env: Record<string, string>; tmpRoot?: string };

export function createClaudeProvider(d: ClaudeProviderDeps): ModelProvider {
  return {
    id: "claude",
    preflight: (mode: Mode | undefined) => preflightProblems(mode, d.env),
    async run(call: ProviderCall, o: ProviderRun, mode: Mode | undefined): Promise<ProviderOutcome> {
      const cwd = await mkdtemp(path.join(d.tmpRoot ?? os.tmpdir(), "cvapp-agent-"));
      try {
        const allowed = call.web ? ["WebSearch"] : [];
        let result: any = null, assistantError: string | undefined, breach: string[] = [], limitInfo: unknown = null, source: string | undefined, streamError: unknown = null;
        try {
          const q = d.query({ prompt: call.prompt, options: isolatedOptions(call, cwd, d.env, o.abort, (line) => console.error("[claude]", redact(line, 200))) as unknown as Record<string, unknown> });
          for await (const m of q) {
            if (m.type === "system" && m.subtype === "init") {
              source = (m as { apiKeySource?: string }).apiKeySource;
              breach = [...isolationProblems(m as InitMessage, allowed, cwd, (p) => realpathSync(p)), ...modeProblems((m as { apiKeySource?: string }).apiKeySource, mode)];
              if (breach.length) { o.abort.abort(); break; } // stopped at the first message: nothing it answers is used (the prompt itself may already have been sent)
            }
            if (m.type === "assistant" && m.error) assistantError = String(m.error);
            if (m.type === "rate_limit_event" || m.type === "rate_limit") limitInfo = (m as { rate_limit_info?: unknown }).rate_limit_info ?? m;
            if (m.type === "result") result = m;
          }
        } catch (e) { streamError = e; } // the real program delivers a failed result AND THEN throws ("Not logged in", "Invalid API key" ...): what it said first is kept and used below
        if (streamError && !result && !assistantError && !breach.length && !o.timedOut()) throw streamError; // a failure with nothing said before it (a dropped connection ...) is handled by the runner
        if (breach.length) return { type: "breach", problems: breach };
        if (o.timedOut() && !result) return { type: "timeout" };
        let usage: { inTokens: number; outTokens: number; costUsd: number } | null = null;
        if (result) {
          const u = Object.values(result.modelUsage ?? {}) as any[], sum = (k: string) => u.reduce((a, x) => a + (Number(x?.[k]) || 0), 0);
          usage = { inTokens: sum("inputTokens") + sum("cacheReadInputTokens") + sum("cacheCreationInputTokens"), outTokens: sum("outputTokens"), costUsd: Number(result.total_cost_usd) || 0 };
        }
        if (!result || result.is_error || !result.structured_output) {
          const msg = `${call.role} failed: ${result?.subtype ?? "no result"} ${(result?.errors ?? []).map((e: string) => redact(e, 200)).join("; ")}`;
          const type = assistantError ?? result?.error, text = redact(String(result?.result ?? msg), 200);
          return { type: "finished", usage, answer: null, failure: { msg, type, status: result?.api_error_status ?? null, text, apiKeySource: source, resetsAt: parseResetsAt(limitInfo) } };
        }
        return { type: "finished", usage, answer: result.structured_output };
      } finally { await rm(cwd, { recursive: true, force: true }); }
    },
  };
}
