// The provider seam (phase 1 of the OpenAI option): the runner works with ANY provider that follows provider.ts, with no Claude query involved. A fake provider stands in for a
// second AI service. No network, no model, no key.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url)), root = path.join(dir, "..");
const { createSdkRunner } = await import("../src/agents/runner.ts");
const { EXIT } = await import("../src/agents/errors.ts");
type Provider = import("../src/agents/provider.ts").ModelProvider;
type Outcome = import("../src/agents/provider.ts").ProviderOutcome;
let failures = 0;
const ok = (name: string, cond: boolean) => { if (!cond) failures++; console.log((cond ? "PASS " : "FAIL ") + name); };
const priya = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8"));
const cfg = { models: { analyst: "fake-a", writer: "fake-w", checker: "fake-c", coach: "fake-o" }, agentTimeoutSeconds: 5, researchTimeoutSeconds: 5, maxAdChars: 30000 };
const tmp = mkdtempSync(path.join(os.tmpdir(), "cvapp-provider-test-"));
const job = () => { const d = mkdtempSync(path.join(tmp, "job-")); writeFileSync(path.join(d, "ad.md"), "Marketing role. Email campaigns and reporting."); return d; };

type Seen = { role: string; model: string; system: string; prompt: string; schema: string; web: boolean; mode: string | undefined };
const fake = (outcome: Outcome | (() => Promise<Outcome>), o: { preflight?: string[] } = {}) => {
  const seen: Seen[] = [], pre: (string | undefined)[] = [];
  const provider: Provider = {
    id: "fake",
    preflight: (m) => { pre.push(m); return o.preflight ?? []; },
    async run(call, _run, mode) { seen.push({ role: call.role, model: call.model, system: call.system, prompt: call.prompt, schema: call.schema, web: call.web, mode }); return typeof outcome === "function" ? outcome() : outcome; },
  };
  return { provider, seen, pre };
};
const make = (p: Provider, over: object = {}) => createSdkRunner({ profile: priya, tone: "friendly", config: cfg, skillsDir: path.join(root, "skills"), provider: p, tmpRoot: tmp, now: () => new Date("2026-11-19T12:00:00Z"), ...over });

{ // a good answer: the runner builds the prompt, calls the provider with the configured model, writes the answer file and the usage line, and reports usage to the ledger
  const f = fake({ type: "finished", usage: { inTokens: 120, outTokens: 30, costUsd: 0.02 }, answer: { company: "Acme" } }), d = job(), recs: any[] = [];
  const r = await make(f.provider, { mode: "apiKey", onUsage: (u: unknown) => recs.push(u) })(d, "analyst");
  ok("provider: a fake provider answers an analyst call: code 0, answer file written, no Claude query given", r.code === EXIT.ok && JSON.parse(readFileSync(path.join(d, "analysis.json"), "utf8")).company === "Acme");
  ok("provider: the call carries the configured model, a skill as the system prompt, the ad in the prompt, the schema name, no web, and the chosen mode", f.seen.length === 1 && f.seen[0].model === "fake-a" && f.seen[0].system.length > 200 && f.seen[0].prompt.includes("Email campaigns") && f.seen[0].schema === "analyst" && !f.seen[0].web && f.seen[0].mode === "apiKey");
  ok("provider: usage.jsonl and the ledger callback get the provider's tokens and cost", JSON.parse(readFileSync(path.join(d, "usage.jsonl"), "utf8").trim()).out === 30 && recs.length === 1 && recs[0].inTokens === 120 && recs[0].costUsd === 0.02 && recs[0].ok === true && recs[0].mode === "apiKey");
}
{ const f = fake({ type: "finished", usage: null, answer: { message: "x" } }), d = job(); writeFileSync(path.join(d, "team.json"), "{}"); const r = await make(f.provider)(d, "coach", "company-brief");
  ok("provider: the company brief is the one call that asks for web search, and it is passed on", r.code === EXIT.ok && f.seen[0].web === true && existsSync(path.join(d, "coach-company-brief.json"))); }
{ // preflight: a provider that refuses stops the call before anything is sent or the cap is asked
  const f = fake({ type: "finished", usage: null, answer: {} }, { preflight: ["no credential for this provider"] }); let gateAsked = false;
  const d = job(), r = await make(f.provider, { mode: "subscription", beforeCall: () => { gateAsked = true; return null; } })(d, "analyst");
  ok("provider: a preflight problem is an isolation failure, nothing is sent, the spend gate is not asked, the preflight saw the chosen mode", r.code === EXIT.isolation && /call not started: no credential/.test(r.log) && f.seen.length === 0 && !gateAsked && f.pre[0] === "subscription"); }
{ let sent = false; const f = fake({ type: "finished", usage: null, answer: {} }), d = job(), recs: any[] = [];
  const r = await make(f.provider, { beforeCall: () => ({ code: EXIT.cap, log: "cap reached" }), onUsage: (u: unknown) => recs.push(u) })(d, "analyst"); sent = f.seen.length > 0;
  ok("provider: the spend-cap gate still comes before the provider and a refused call is not written to the ledger", r.code === EXIT.cap && !sent && recs.length === 0); }
{ const f = fake({ type: "breach", problems: ["unexpected tools: Bash"] }), d = job(), recs: any[] = [];
  const r = await make(f.provider, { onUsage: (u: unknown) => recs.push(u) })(d, "analyst");
  ok("provider: a breach is reported as an isolation failure, no answer file, and the started call is still in the ledger as failed", r.code === EXIT.isolation && /isolation check failed.*Bash/.test(r.log) && !existsSync(path.join(d, "analysis.json")) && recs.length === 1 && recs[0].ok === false); }
{ const f = fake({ type: "timeout" }), d = job(), r = await make(f.provider)(d, "analyst");
  ok("provider: a timeout outcome becomes the timeout code", r.code === EXIT.timeout && /took longer than 5s/.test(r.log)); }
{ const f = fake({ type: "finished", usage: { inTokens: 5, outTokens: 0, costUsd: 0 }, answer: null, failure: { msg: "analyst failed: error 429", type: "rate_limit", status: 429, text: "limit", resetsAt: "2026-11-19T15:00:00Z" } }), d = job(), r = await make(f.provider)(d, "analyst");
  ok("provider: a failure keeps its type, status and reset time for the access layer, and maps to the rate-limit code", r.code === EXIT.rate_limit && r.error?.type === "rate_limit" && r.error?.status === 429 && r.error?.resetsAt === "2026-11-19T15:00:00Z" && !existsSync(path.join(d, "analysis.json"))); }
{ const f = fake(async () => { throw new Error("ECONNRESET while reading"); }), d = job(), r = await make(f.provider)(d, "analyst");
  ok("provider: a provider that throws never throws out of the runner: it is a failure code with a message", r.code === EXIT.unavailable && /ECONNRESET/.test(r.log)); }
{ let threw = false; try { createSdkRunner({ profile: priya, tone: "friendly", config: cfg, skillsDir: path.join(root, "skills"), tmpRoot: tmp }); } catch { threw = true; }
  ok("provider: a runner given neither a provider nor a Claude query refuses to be built", threw); }
rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? "\nall provider tests passed" : `\n${failures} provider test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
