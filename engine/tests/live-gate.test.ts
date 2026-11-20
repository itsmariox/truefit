// THE LIVE ISOLATION GATE (phase 1 step 7a). Skipped unless CVAPP_LIVE=1: it makes ONE tiny real Claude call, so it needs the user's OK and spends a
// little quota. It becomes the project's first live call in step 8. It builds the call EXACTLY like the product does (same options builder) and
// reads the SDK's init message: the session must contain no tools, no MCP servers (computer-use, Chrome and the like), no plugins, no skills, and run
// in the throwaway folder. Run it before any other live call: CVAPP_LIVE=1 node tests/live-gate.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
if (process.env.CVAPP_LIVE !== "1") { console.log("SKIP live gate: set CVAPP_LIVE=1 to make the one real call\n\nall live-gate tests passed (SKIPPED: no call was made)"); process.exit(0); }
const { query } = await import("@anthropic-ai/claude-agent-sdk");
const O = await import("../src/agents/options.ts");
let failures = 0;
const ok = (name: string, cond: boolean) => { if (!cond) failures++; console.log((cond ? "PASS " : "FAIL ") + name); };
const cwd = mkdtempSync(path.join(os.tmpdir(), "cvapp-live-gate-"));
const call = { role: "gate", model: process.env.CVAPP_MODEL ?? "claude-sonnet-5-5", system: "Reply with the single word ok.", prompt: "ok?", schema: "coach" as const, web: false, timeoutSeconds: 60 };
const ac = new AbortController();
let init: any = null, result: any = null;
try {
  for await (const m of query({ prompt: call.prompt, options: O.isolatedOptions(call, cwd, O.minimalEnv(process.env), ac) as never }) as AsyncIterable<any>) {
    if (m.type === "system" && m.subtype === "init") init = m;
    if (m.type === "result") result = m;
  }
} catch (e) { console.log("FAIL the call threw: " + String(e).slice(0, 300)); failures++; }
console.log("info: init message:", JSON.stringify({ tools: init?.tools, mcp_servers: init?.mcp_servers, plugins: init?.plugins, skills: init?.skills, agents: init?.agents, slash_commands: (init?.slash_commands ?? []).length + " commands", permissionMode: init?.permissionMode, apiKeySource: init?.apiKeySource, cwd: init?.cwd, claude_code_version: init?.claude_code_version }));
ok("the session started and answered", !!init && !!result && !result.is_error);
rmSync(cwd, { recursive: true, force: true });
const problems = init ? O.isolationProblems(init, [], cwd, (p) => p.replace(/^\/private(?=\/var\/)/, "")) : ["no init message"];
ok(`the session is isolated: ${problems.length ? problems.join("; ") : "only our answer tool, no MCP servers, only the bundled program's own built-in plugins and skills (inert: no Skill tool), default permissions, throwaway working folder"}`, problems.length === 0);
ok("no MCP server of the user's (computer-use, Chrome, ...) and no tool but our answer tool is visible to the model", (init?.mcp_servers ?? []).length === 0 && (init?.tools ?? []).every((t: string) => t === "StructuredOutput"));
console.log(failures === 0 ? "\nall live-gate tests passed" : `\n${failures} live-gate test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
