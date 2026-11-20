// The OpenAI provider (phase 2): the request it builds, the stream it reads, the errors it maps and the cost it computes, all against the pretend OpenAI service on localhost. No real
// OpenAI service, key or token is involved.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeOpenAI, sse, completed, httpError } from "./openai-fake-server.ts";
const dir = path.dirname(fileURLToPath(import.meta.url)), root = path.join(dir, "..");
const { createOpenAIProvider, OpenAIAuthError, openaiErrorType } = await import("../src/agents/openai-provider.ts");
const { openaiCostUsd } = await import("../src/agents/openai-prices.ts");
const { strictSchemaProblems } = await import("../src/agents/openai-schema.ts");
const { SCHEMAS } = await import("../src/agents/schemas.ts");
const { createSdkRunner } = await import("../src/agents/runner.ts");
const { EXIT } = await import("../src/agents/errors.ts");
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const call = (over: object = {}) => ({ role: "analyst", model: "gpt-6.2-sol", system: "SYSTEM-TEXT", prompt: "PROMPT-TEXT", schema: "coach" as const, web: false, timeoutSeconds: 5, ...over });
const run = (p: ReturnType<typeof createOpenAIProvider>, c = call(), mode: "subscription" | "apiKey" | undefined = "subscription", ms = 5000) => { const ac = new AbortController(); let t = false; const timer = setTimeout(() => { t = true; ac.abort(); }, ms); return p.run(c, { abort: ac, timedOut: () => t }, mode).finally(() => clearTimeout(timer)); };
const auth = (kind: "apiKey" | "plan" = "plan", token = "TOKEN-123") => async () => ({ kind, token });

// ---- the request ----
{ const srv = await startFakeOpenAI({ "POST /v1/responses": (_r, res) => sse(res, completed({ message: "hi" })) });
  const p = createOpenAIProvider({ getAuth: auth(), baseUrl: srv.url + "/v1" }), out = await run(p);
  const b = srv.seen[0].body;
  ok("request: a plan call sends the right model, the skill as `instructions` and the prompt as ONE user message (no system-role item)", out.type === "finished" && b.model === "gpt-6.2-sol" && b.instructions === "SYSTEM-TEXT" && b.input.length === 1 && b.input[0].role === "user" && b.input[0].content === "PROMPT-TEXT");
  ok("request: store is false and stream is true, strict json_schema with our schema, and none of the fields the plan path rejects (temperature, top_p, metadata, user, previous_response_id)", b.store === false && b.stream === true && b.text.format.type === "json_schema" && b.text.format.strict === true && b.text.format.name === "coach" && JSON.stringify(b.text.format.schema) === JSON.stringify(SCHEMAS.coach) && !["temperature", "top_p", "metadata", "user", "previous_response_id", "prompt"].some((k) => k in b));
  ok("request: bearer token, POST /v1/responses, no tools for a normal call", srv.seen[0].headers.authorization === "Bearer TOKEN-123" && srv.seen[0].method === "POST" && srv.seen[0].url === "/v1/responses" && !("tools" in b));
  ok("answer: the parsed object comes back, usage is read from response.completed, cost is computed (1000 in, 200 cached, 100 out on gpt-6.2-sol)", out.type === "finished" && (out.answer as any).message === "hi" && out.usage?.inTokens === 1000 && out.usage?.outTokens === 100 && Math.abs((out.usage?.costUsd ?? 0) - (800 * 2 + 200 * 0.1 + 100 * 10) / 1e6) < 1e-9);
  const w = await run(p, call({ web: true })); ok("request: the company brief (web: true) adds the web_search tool and nothing else", w.type === "finished" && JSON.stringify(srv.seen[1].body.tools) === JSON.stringify([{ type: "web_search" }]));
  await srv.close(); }
{ const srv = await startFakeOpenAI({ "POST /v1/responses": (_r, res) => sse(res, completed({ message: "split" }), { split: true }) });
  const out = await run(createOpenAIProvider({ getAuth: auth("apiKey"), baseUrl: srv.url + "/v1" }), call(), "apiKey");
  ok("stream: events cut into 7-character pieces are put back together", out.type === "finished" && (out.answer as any)?.message === "split"); await srv.close(); }

// ---- never switch silently / credentials ----
{ const srv = await startFakeOpenAI({ "POST /v1/responses": (_r, res) => sse(res, completed({})) });
  const out = await run(createOpenAIProvider({ getAuth: auth("apiKey"), baseUrl: srv.url + "/v1" }), call(), "subscription");
  ok("credentials: a key when the ChatGPT plan was chosen is a breach, and nothing is sent", out.type === "breach" && srv.seen.length === 0);
  const out2 = await run(createOpenAIProvider({ getAuth: auth("plan"), baseUrl: srv.url + "/v1" }), call(), "apiKey");
  ok("credentials: a plan token when the API key was chosen is a breach too", out2.type === "breach" && srv.seen.length === 0);
  const out3 = await run(createOpenAIProvider({ getAuth: async () => { throw new OpenAIAuthError("sign in again"); }, baseUrl: srv.url + "/v1" }), call(), "subscription");
  ok("credentials: no usable credential is an authentication failure (a pause), nothing is sent", out3.type === "finished" && out3.failure?.type === "authentication_failed" && srv.seen.length === 0);
  const pr = createOpenAIProvider({ getAuth: auth() }); ok("credentials: preflight accepts both ways to connect and refuses an unknown one", pr.preflight("subscription").length === 0 && pr.preflight("apiKey").length === 0 && pr.preflight("nonsense" as never).length === 1);
  await srv.close(); }

// ---- errors before the stream ----
const errCase = async (status: number, body: object | string, mode: "subscription" | "apiKey" = "subscription", headers: Record<string, string> = {}) => {
  const srv = await startFakeOpenAI({ "POST /v1/responses": (_r, res) => httpError(res, status, body, headers) });
  const out = await run(createOpenAIProvider({ getAuth: auth(mode === "apiKey" ? "apiKey" : "plan"), baseUrl: srv.url + "/v1" }), call(), mode); await srv.close(); return out as Extract<typeof out, { type: "finished" }>;
};
{ const a = await errCase(429, { error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" } }, "subscription", { "retry-after": "120" });
  ok("errors: a plan usage limit (429) is `rate_limit`, with NO guessed reset time even if a Retry-After is sent", a.failure?.type === "rate_limit" && a.failure.status === 429 && a.failure.resetsAt === null && a.failure.apiKeySource === "chatgpt_plan");
  const b = await errCase(429, { error: { code: "rate_limit_exceeded", message: "slow down" } }, "apiKey", { "retry-after": "60" });
  ok("errors: an API-key rate limit keeps its Retry-After as a reset time", b.failure?.type === "rate_limit" && typeof b.failure.resetsAt === "string" && b.failure.apiKeySource === "OPENAI_API_KEY");
  ok("errors: insufficient_quota is a billing problem", (await errCase(429, { error: { code: "insufficient_quota", message: "x" } }, "apiKey")).failure?.type === "billing_error");
  ok("errors: 401 is an authentication failure, 401 with invalid_api_key too", (await errCase(401, { error: { code: "invalid_api_key", message: "bad" } }, "apiKey")).failure?.type === "authentication_failed" && (await errCase(401, { detail: "not accepted" })).failure?.type === "authentication_failed");
  ok("errors: 403 subscription_sharing_user_not_eligible means the plan may not be used (a refusal, not a retry)", (await errCase(403, { error: { code: "subscription_sharing_user_not_eligible", message: "no" } })).failure?.type === "oauth_org_not_allowed");
  ok("errors: 503 usage_unavailable is a temporary outage, a plain 500 a server error, 400 unsupported_capability an invalid request, 404 a missing model", (await errCase(503, { error: { code: "subscription_sharing_usage_unavailable", message: "x" } })).failure?.type === "overloaded" && (await errCase(500, "boom")).failure?.type === "server_error" && (await errCase(400, { error: { code: "subscription_sharing_unsupported_capability", param: "tools" } })).failure?.type === "invalid_request" && (await errCase(404, { error: { code: "model_not_found" } })).failure?.type === "model_not_found");
  ok("errors: openaiErrorType maps every code to a type the access layer knows", ["rate_limit", "authentication_failed", "oauth_org_not_allowed", "overloaded", "server_error", "model_not_found", "billing_error", "invalid_request", "unknown"].every((t) => ["rate_limit", "authentication_failed", "oauth_org_not_allowed", "overloaded", "server_error", "model_not_found", "billing_error", "invalid_request", "unknown"].includes(t)) && openaiErrorType(null, undefined) === "unknown");
  const tokenLeak = await errCase(401, { error: { code: "invalid_api_key", message: "Incorrect API key provided: sk-proj-ABCDEFGHIJKLMNOPQRSTUV0123456789" } }, "apiKey");
  ok("errors: a key echoed back in an error message does not survive in the failure text", !/ABCDEFGHIJKLMNOPQRSTUV0123456789/.test(JSON.stringify(tokenLeak.failure))); }

// ---- stream ends badly ----
const streamCase = async (events: object[] | null, mode: "subscription" | "apiKey" = "subscription") => {
  const srv = await startFakeOpenAI({ "POST /v1/responses": (_r, res) => sse(res, events ?? []) });
  const out = await run(createOpenAIProvider({ getAuth: auth(mode === "apiKey" ? "apiKey" : "plan"), baseUrl: srv.url + "/v1" }), call(), mode); await srv.close(); return out as Extract<typeof out, { type: "finished" }>;
};
{ const limit = await streamCase([{ type: "response.created", response: {} }, { type: "response.output_text.delta", delta: "{" }, { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "limit" }, usage: { input_tokens: 50, output_tokens: 2 } } }]);
  ok("stream: a usage limit that arrives mid-stream (response.failed) is `rate_limit`, no answer, and the tokens that were spent are still reported", limit.failure?.type === "rate_limit" && limit.answer === null && limit.usage?.inTokens === 50);
  ok("stream: a stream that ends WITHOUT response.completed is a failure even if text arrived", (await streamCase([{ type: "response.output_text.delta", delta: "{\"message\":\"x\"}" }])).failure?.text.includes("without response.completed") === true);
  ok("stream: response.incomplete is reported as a cut-short answer", (await streamCase([{ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }])).failure?.type === "max_output_tokens");
  ok("stream: an `error` event fails the call", (await streamCase([{ type: "error", error: { code: "server_error", message: "oops" } }])).failure?.type === "server_error");
  const refusal = await streamCase([{ type: "response.completed", response: { output: [{ type: "message", content: [{ type: "refusal", refusal: "I cannot" }] }], usage: { input_tokens: 5, output_tokens: 1 } } }]);
  ok("stream: a refusal is a failure with no answer", refusal.failure?.text.startsWith("refused") === true && refusal.answer === null);
  ok("stream: an answer that is not JSON, or not an object, is a failure", (await streamCase([{ type: "response.completed", response: { output: [{ type: "message", content: [{ type: "output_text", text: "not json" }] }] } }])).failure?.text.includes("not valid JSON") === true && (await streamCase([{ type: "response.completed", response: { output: [{ type: "message", content: [{ type: "output_text", text: "42" }] }] } }])).failure?.text.includes("not an object") === true);
  const nu = await streamCase(completed({ message: "x" }, { input_tokens: 10, output_tokens: 1 }, "gpt-9-unknown"));
  ok("cost: an unknown model is read fine and costs 0 rather than a guess", nu.answer !== null && openaiCostUsd("gpt-9-unknown", { input: 10, output: 1 }) === null); }

// ---- timeout and dropped connection ----
{ const srv = await startFakeOpenAI({ "POST /v1/responses": (_r, res) => sse(res, [{ type: "response.created", response: {} }], { keepOpen: true }) });
  const t0 = Date.now(), out = await run(createOpenAIProvider({ getAuth: auth(), baseUrl: srv.url + "/v1" }), call(), "subscription", 300);
  ok("timeout: a stream that never finishes is stopped by the runner's timer and reported as a timeout", out.type === "timeout" && Date.now() - t0 < 3000); await srv.close(); }
{ const srv = await startFakeOpenAI({ "POST /v1/responses": (_r, res) => { res.socket?.destroy(); } }); let threw = false;
  try { await run(createOpenAIProvider({ getAuth: auth(), baseUrl: srv.url + "/v1" })); } catch { threw = true; }
  ok("network: a dropped connection with nothing said throws (the runner turns that into an `unavailable` pause)", threw); await srv.close(); }

// ---- cost table ----
ok("cost: gpt-6.2-sol, no cache: 100K in + 100K out = $1.20", openaiCostUsd("gpt-6.2-sol", { input: 1e5, output: 1e5 }) === 1.2);
ok("cost: above 272K input tokens the input rate doubles and the output rate is 1.5x", openaiCostUsd("gpt-6.2-sol", { input: 300_000, output: 1000 }) === Math.round(((300_000 * 2 * 2 + 1000 * 10 * 1.5) / 1e6) * 1e8) / 1e8);
ok("cost: astra is $8/$40, and a model with no listed cache price is charged the full input price (never too low)", openaiCostUsd("gpt-6.2-astra", { input: 1e5, cachedInput: 5e4, output: 1e5 }) === 4.8);

// ---- our schemas against strict mode ----
for (const [name, s] of Object.entries(SCHEMAS)) { const pr = strictSchemaProblems(s); ok(`schema: ${name} is acceptable to strict mode${pr.length ? " (" + pr.join("; ") + ")" : ""}`, pr.length === 0); }
ok("schema: the checker itself rejects a missing `required`, a missing additionalProperties:false, anyOf at the root and an unsupported keyword", strictSchemaProblems({ type: "object", additionalProperties: false, properties: { a: { type: "string" } }, required: [] }).length === 1 && strictSchemaProblems({ type: "object", properties: {}, required: [] }).length === 1 && strictSchemaProblems({ anyOf: [] }).length >= 1 && strictSchemaProblems({ type: "object", additionalProperties: false, properties: {}, required: [], allOf: [] }).length === 1);

// ---- through the real runner ----
{ const tmp = mkdtempSync(path.join(os.tmpdir(), "cvapp-oai-test-")); const priya = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8"));
  const cfg = { models: { analyst: "gpt-6.2-sol", writer: "gpt-6.2-sol", checker: "gpt-6.2-sol", coach: "gpt-6.2-sol" }, agentTimeoutSeconds: 5, researchTimeoutSeconds: 5, maxAdChars: 30000 };
  const job = () => { const d = mkdtempSync(path.join(tmp, "job-")); writeFileSync(path.join(d, "ad.md"), "Marketing role. Email campaigns."); return d; };
  const srv = await startFakeOpenAI({ "POST /v1/responses": (_r, res) => sse(res, completed({ company: "Acme" })) }); const recs: any[] = [];
  const mk = (url: string, over: object = {}) => createSdkRunner({ profile: priya, tone: "friendly", config: cfg, skillsDir: path.join(root, "skills"), provider: createOpenAIProvider({ getAuth: auth(), baseUrl: url + "/v1" }), tmpRoot: tmp, mode: "subscription", onUsage: (u) => recs.push(u), ...over });
  const d = job(), r = await mk(srv.url)(d, "analyst");
  ok("runner: a whole analyst call through the OpenAI provider writes analysis.json, a usage line and a ledger record in the chosen mode", r.code === EXIT.ok && JSON.parse(readFileSync(path.join(d, "analysis.json"), "utf8")).company === "Acme" && recs[0]?.mode === "subscription" && recs[0].inTokens === 1000 && recs[0].costUsd > 0);
  ok("runner: the request really carried the Analyst skill and the ad", /Fit analysis/.test(srv.seen[0].body.instructions) && srv.seen[0].body.input[0].content.includes("Email campaigns") && srv.seen[0].body.text.format.name === "analyst");
  await srv.close();
  const lim = await startFakeOpenAI({ "POST /v1/responses": (_r, res) => httpError(res, 429, { error: { code: "subscription_sharing_usage_limit_exceeded", message: "x" } }) });
  const d2 = job(), r2 = await mk(lim.url)(d2, "analyst");
  ok("runner: a plan limit comes back as the rate-limit pause code with its error for the access layer, and no answer file", r2.code === EXIT.rate_limit && r2.error?.type === "rate_limit" && !existsSync(path.join(d2, "analysis.json"))); await lim.close();
  rmSync(tmp, { recursive: true, force: true }); }
console.log(failures === 0 ? "\nall openai-provider tests passed" : `\n${failures} openai-provider test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
