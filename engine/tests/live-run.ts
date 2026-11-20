// ONE REAL JOB through the whole engine with real Claude, on the fictional profile (phase 1 step 8). Opt-in, never part of npm test:
//   CVAPP_LIVE=1 node tests/live-run.ts <output-folder>
// Costs about 5 Claude calls (Analyst, Writer, Checker, Coach x2). Writes everything it makes into the folder so it can be read afterwards.
// CVAPP_PROVIDER=openai (with OPENAI_API_KEY set) runs the same job through the OpenAI provider and the config's OpenAI models instead: real, billed calls, never part of `npm test`.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
if (process.env.CVAPP_LIVE !== "1") { console.log("set CVAPP_LIVE=1 (this makes real Claude calls)"); process.exit(0); }
const out = process.argv[2]; if (!out) { console.error("give an output folder"); process.exit(2); }
const dir = path.dirname(fileURLToPath(import.meta.url)), root = path.join(dir, "..");
const { query } = await import("@anthropic-ai/claude-agent-sdk");
const PL = await import("../src/pipeline.ts");
const { createSdkRunner } = await import("../src/agents/runner.ts");
const { minimalEnv } = await import("../src/agents/options.ts");
const { loadConfig } = await import("../src/config.ts");
const { ChromeCliRenderer, loadFonts } = await import("../src/cv/render.ts");
const profile = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8"));
let cfg = await loadConfig();
let provider: import("../src/agents/provider.ts").ModelProvider | undefined;
if (process.env.CVAPP_PROVIDER === "openai") {
  const key = process.env.OPENAI_API_KEY; if (!key) { console.error("set OPENAI_API_KEY"); process.exit(2); }
  const { createOpenAIProvider } = await import("../src/agents/openai-provider.ts");
  provider = createOpenAIProvider({ getAuth: async () => ({ kind: "apiKey", token: key }) }); cfg = { ...cfg, models: cfg.openaiModels ?? cfg.models };
}
const AD = `Marketing Executive, Brightwell Home (fictional company)
Location: Manchester (hybrid, 3 days in the office). Salary: £32,000 to £36,000.
Brightwell Home sells kitchenware online and through 12 shops. We are looking for a Marketing Executive to run our email and social channels and to report on what works.
You will: plan and send weekly email campaigns to our customer list; write and schedule social posts for Instagram and Facebook; build a weekly performance report for the store managers using Google Analytics; work with the shops on local promotions; keep our product pages up to date.
You have: 2 or more years in a marketing role; experience of email and social media campaigns; confident with Google Analytics and spreadsheets; clear writing; you enjoy working with numbers.
Nice to have: Mailchimp, Canva, paid social experience.
To apply, send your CV.`;
const pl = PL.createPipeline({ jobsDir: path.join(out, "jobs"), profile, renderer: new ChromeCliRenderer(), fonts: await loadFonts(),
  config: { accent: cfg.accent, showRightToWork: cfg.showRightToWork, resumeProfile: cfg.resumeProfile, writerMode: cfg.writerMode },
  runnerFor: (p) => createSdkRunner({ profile: p, tone: cfg.tone, config: cfg, skillsDir: path.join(root, "skills"), query: provider ? undefined : (query as never), ...(provider ? { provider } : {}), env: minimalEnv(process.env), tmpRoot: os.tmpdir(), writerMode: cfg.writerMode }) });
const t0 = Date.now(), lap = (s: string) => console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${s}`);
const existing = process.env.CVAPP_CONTINUE ? (await pl.listJobs())[0] : undefined; // CVAPP_CONTINUE=1: reuse the job already in the folder (keeps its finished steps)
let job = existing ?? await pl.createJob(AD, "text");
if (!existing) { const a = await pl.analyse(job); job = a.job; lap(`analysed: status ${job.status}, verdict ${job.verdict}, fit ${job.fit}`); console.log("MESSAGE:\n" + a.message); }
if (job.status === "analysed" || job.status === "needs_input") { const b = await pl.build(job, process.env.CVAPP_CONTINUE ? { ignoreQuestions: true } : {}); job = b.job; lap(`build: ${b.status}`); console.log("MESSAGE:\n" + b.message); }
console.log("JOB FOLDER:", job.dir, "STATUS:", job.status, job.note ?? "");
