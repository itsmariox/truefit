// The SDK options for ONE agent call, built so that the model can do nothing but answer (phase 1 step 7a). The old setup was safe because it ran
// inside a locked Docker container; without Docker the Claude program runs on the user's own Mac, so every door is closed here explicitly:
//   no tools (the company brief alone gets web search), no MCP servers (and no other source of them), no plugins, agents, hooks or skills,
//   no settings files (so no user memory, CLAUDE.md or hooks), no session saved to disk, a throwaway working folder, and an explicit minimal
//   environment (the SDK replaces the child's environment entirely when `env` is set, so an inherited API key or Claude Code variable can never
//   silently change the login mode or behaviour).
import type { SchemaName } from "./schemas.ts";
import os from "node:os";
import { SCHEMAS } from "./schemas.ts";

export type ClaudeCall = { role: string; model: string; system: string; prompt: string; schema: SchemaName; web: boolean; timeoutSeconds: number };

// Every built-in tool we know of; the ones not explicitly allowed are also named in `disallowedTools` as belt and braces on top of `tools`.
export const BUILTIN_TOOLS = ["Bash", "BashOutput", "KillShell", "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Glob", "Grep", "WebFetch", "WebSearch", "Task", "Agent", "TodoWrite", "Skill", "SlashCommand", "ExitPlanMode", "EnterPlanMode", "AskUserQuestion", "ToolSearch", "Monitor", "CronCreate", "CronDelete", "CronList", "SendMessage", "TaskStop"];
// Environment variables the Claude program may keep: where to find the user's login and settings home, locale and temp folder, and network
// plumbing (proxies, certificates). Everything else, notably every ANTHROPIC_* and CLAUDE_CODE_* variable, is dropped.
const KEEP = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "no_proxy", "all_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR"];
// THE one environment function for everything that starts the Claude program: the free status check, the sign-in and every call (so the status can never say
// "connected" while a call says "not logged in"). Step 3a found that the login lookup needs `USER` (the exact macOS user name, the Keychain account) and nothing else;
// an app started from Finder may not have it, so it is ALWAYS set from the operating system, never inherited. `configDir` (CLAUDE_CONFIG_DIR) gives a fully separate
// login, used by tests and live checks so the user's own login is never touched.
export function minimalEnv(src: Record<string, string | undefined> = process.env, o: { apiKey?: string; userName?: string; configDir?: string } = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const k of KEEP) if (src[k] !== undefined) env[k] = src[k]!;
  env.USER = o.userName ?? os.userInfo().username;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "cv-app"; // identifies the app in the User-Agent, nothing personal
  if (o.configDir) env.CLAUDE_CONFIG_DIR = o.configDir;
  if (o.apiKey) env.ANTHROPIC_API_KEY = o.apiKey; // only in API-key mode, and only the key the user gave the app
  return env;
}
export const claudeEnv = minimalEnv;

export function isolatedOptions(call: ClaudeCall, cwd: string, env: Record<string, string>, abortController: AbortController, stderr?: (line: string) => void) {
  const allowed = call.web ? ["WebSearch"] : [];
  return {
    model: call.model, systemPrompt: call.system,
    tools: allowed, allowedTools: allowed, disallowedTools: BUILTIN_TOOLS.filter((t) => !allowed.includes(t)),
    canUseTool: async (name: string, input: Record<string, unknown>) => (allowed.includes(name) ? { behavior: "allow" as const, updatedInput: input } : { behavior: "deny" as const, message: "not allowed" }),
    permissionMode: "default" as const, maxTurns: call.web ? 12 : 4, maxBudgetUsd: call.web ? 1.5 : 1,
    settingSources: [] as never[], persistSession: false, cwd, additionalDirectories: [] as string[],
    mcpServers: {}, strictMcpConfig: true, plugins: [] as never[], agents: {}, hooks: {}, skills: [] as string[],
    env, outputFormat: { type: "json_schema" as const, schema: SCHEMAS[call.schema] as unknown as Record<string, unknown> }, abortController,
    ...(stderr ? { stderr } : {}),
  };
}

// The SDK's first message of every session says what the session really contains. We check it on EVERY call, not only in a test: if anything beyond
// what we asked for is present, the call is stopped at that first message and nothing it says is used. (Correction after the phase 3 review: the program has usually ALREADY sent the prompt to Anthropic by then, so this check limits what happens next, it does not keep the prompt from being sent.)
export type InitMessage = { tools?: string[]; mcp_servers?: unknown[]; plugins?: { name?: string; path?: string }[]; skills?: string[]; cwd?: string; permissionMode?: string };
export function isolationProblems(init: InitMessage, allowedTools: string[], expectedCwd: string, realpath: (p: string) => string): string[] {
  const p: string[] = [];
  // StructuredOutput is our own answer-schema tool, always present. The bundled Claude program also lists ITS OWN built-in plugins and skills (path "builtin")
  // whatever we pass (seen live in step 8); they are inert here because the model has no Skill tool and no other tool. Anything not built in is a breach.
  const extra = (init.tools ?? []).filter((t) => t !== "StructuredOutput" && !allowedTools.includes(t));
  if (extra.length) p.push(`unexpected tools: ${extra.join(", ")}`);
  if ((init.mcp_servers ?? []).length) p.push(`MCP servers present: ${(init.mcp_servers as { name?: string }[]).map((m) => m?.name ?? "?").join(", ")}`);
  const foreign = (init.plugins ?? []).filter((x) => x?.path !== "builtin");
  if (foreign.length) p.push(`plugins present: ${foreign.map((x) => x?.name ?? "?").join(", ")}`);
  if ((init.skills ?? []).length && (init.tools ?? []).includes("Skill")) p.push("skills present and callable");
  if (init.permissionMode && init.permissionMode !== "default") p.push(`permission mode is "${init.permissionMode}"`);
  if (!init.cwd || realpath(init.cwd) !== realpath(expectedCwd)) p.push("the working folder is not the throwaway folder");
  return p;
}
