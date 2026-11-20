// Phase 2 review fix: a job's files never contain a folder path of this Mac, so a paused or interrupted job survives a move, a restore or an import on another Mac,
// and an export carries no user name. Runs the REAL pipeline and the REAL runner on a fake Claude, with a real renderer (needs Chrome).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
const dir = path.dirname(fileURLToPath(import.meta.url));
const PL = await import("../src/pipeline.ts");
const { createSdkRunner } = await import("../src/agents/runner.ts");
const { EXIT } = await import("../src/agents/errors.ts");
const { profileToPersona } = await import("../src/profile.ts");
const { ChromeCliRenderer, findChrome, loadFonts } = await import("../src/cv/render.ts");
const { openDb } = await import("../src/store/db.ts");
const { migrate } = await import("../src/store/migrate.ts");
const { MIGRATIONS } = await import("../src/store/schema.ts");
const { exportAll } = await import("../src/store/export.ts");
const { saveProfile } = await import("../src/store/profile-store.ts");
const { buildSelection, SUMMARY } = await import("./helpers.ts");
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
if (!findChrome()) { console.log("SKIP paths: needs a Chromium browser\n\nall paths tests passed (SKIPPED)"); process.exit(process.env.CI || process.env.CVAPP_REQUIRE_RENDER ? 1 : 0); }
const NOW = new Date("2026-11-17T12:00:00Z");
const priya = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8")), ctx = profileToPersona(priya, NOW);
const fonts = await loadFonts(), renderer = new ChromeCliRenderer();
const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-paths-")), cfg = { models: { analyst: "m", writer: "m", checker: "m", coach: "m" }, agentTimeoutSeconds: 30, researchTimeoutSeconds: 30, maxAdChars: 30000 };
const analysis = { company: "Acme Retail", role: "Marketing Executive", location: "Leeds", work_mode: "hybrid", salary_text: null, salary_min_gbp: null, seniority: "mid", years_required: 2, experience: { years: 8, basis: "dated roles" }, requirements: [{ text: "reporting", priority: "must", rating: "strong", evidence_quote: ctx.bullets[1].text.slice(0, 60), note: "" }], constraint_checks: [], focus_id: 1, focus_note: "", fit_percent: 70, fit_note: "", verdict: "apply", strengths: [], gaps: [], unverified_needed: [], injection_suspected: false, summary: "" };
const query = (args: { prompt: string; options: Record<string, any> }) => {
  const system = String(args.options.systemPrompt);
  const label = /# Fit analysis/.test(system) ? "analyst" : /# CV writing/.test(system) ? "writer" : /# Fact check/.test(system) ? "checker" : "coach";
  const answer = label === "analyst" ? analysis : label === "writer" ? buildSelection(ctx, 1, SUMMARY) : label === "checker" ? { claims: [0, 1, 2, 3].map((i) => ({ claim: `c${i}`, evidence_quote: ctx.bullets[i % 2].text.slice(0, 60), supported: true, problem: "" })), rule_breaks: [], verdict: "pass" } : { message: "ok" };
  return (async function* () { yield { type: "system", subtype: "init", tools: ["StructuredOutput"], mcp_servers: [], plugins: [], skills: [], cwd: args.options.cwd, permissionMode: "default" }; yield { type: "result", subtype: "success", is_error: false, structured_output: answer, total_cost_usd: 0, modelUsage: {}, errors: [] }; })();
};
let pauseRole: string | null = null;
const mk = (jobsDir: string) => PL.createPipeline({ jobsDir, profile: priya, renderer, fonts, config: { accent: "oxford", showRightToWork: true, resumeProfile: "snapshot" }, now: () => NOW,
  runnerFor: (p) => { const real = createSdkRunner({ profile: p, tone: "friendly", config: cfg, skillsDir: path.join(dir, "..", "skills"), query: query as never, tmpRoot: root, env: { PATH: "/usr/bin", HOME: os.homedir() }, now: () => NOW }); return async (d, role, mode) => (role === pauseRole ? { code: EXIT.auth, log: "not logged in" } : real(d, role, mode)); } });
const paused = async <T,>(f: () => Promise<T>): Promise<any> => { try { return await f(); } catch (e: any) { if (e.job) return { job: e.job, paused: true }; throw e; } };
// every file of a job, text and binary, searched for a folder path of this Mac
const leaks = (jobDir: string): string[] => readdirSync(jobDir).filter((f) => { const t = readFileSync(path.join(jobDir, f)).toString("latin1"); return t.includes(root) || t.includes(os.tmpdir()) || /\/Users\/|\/private\/var|\/var\/folders/.test(t); });

for (const scenario of [{ name: "analysis paused at the verdict message", pause: "coach", build: false }, { name: "a CV build paused at the Checker, after the CV was drawn", pause: "checker", build: true }]) {
  const A = path.join(root, scenario.name.slice(0, 5), "macA", "jobs"), B = path.join(root, scenario.name.slice(0, 5), "macB", "jobs"); mkdirSync(A, { recursive: true }); mkdirSync(path.dirname(B), { recursive: true });
  pauseRole = scenario.build ? null : scenario.pause;
  const plA = mk(A), job = await plA.createJob("A marketing ad about reporting. ".repeat(10), "text");
  let st = (await paused(() => plA.analyse(job))).job;
  if (scenario.build) { pauseRole = scenario.pause; st = (await paused(() => plA.build(st))).job; }
  ok(`${scenario.name}: the job is really paused, and no file of it (state, saved steps, analysis, CV, snapshot) contains a folder path or the user name`, st.status === "paused" && leaks(st.dir).length === 0 && existsSync(path.join(st.dir, "progress.json")));
  // the whole jobs folder is moved to another place ("another Mac", a restored backup, a renamed user folder) and the job is resumed there
  renameSync(A, B); pauseRole = null;
  const plB = mk(B), moved = (await plB.listJobs())[0];
  const res = await plB.resume(moved);
  const after = res.job ?? res;
  ok(`${scenario.name}: moved to another folder and resumed, the job FINISHES there (${scenario.build ? "built" : "analysed"}) and writes nothing back to the old place`, after.status === (scenario.build ? "built" : "analysed") && path.dirname(after.dir) === B && !existsSync(A) && leaks(after.dir).length === 0);
  if (scenario.build) {
    const db = openDb(":memory:"); migrate(db, MIGRATIONS); saveProfile(db, priya, NOW);
    const zip = path.join(root, "x.zip"), ex = await exportAll(db, B, zip, { now: NOW }); const z = ex.ok ? unzipSync(new Uint8Array(readFileSync(zip))) : {}; db.close();
    ok("the export of that job contains no folder path of this Mac in ANY entry (text or PDF)", ex.ok && Object.entries(z).every(([n, b]) => { const t = Buffer.from(b).toString("latin1"); return !t.includes(root) && !/\/Users\/|\/private\/var|\/var\/folders/.test(t); }));
  }
}
// old jobs made before this fix carry the path in status.json and progress.json: they still load, and a moved one can still be resumed
{
  const A = path.join(root, "old", "macA", "jobs"), B = path.join(root, "old", "macB", "jobs"); mkdirSync(A, { recursive: true }); mkdirSync(path.dirname(B), { recursive: true });
  pauseRole = "coach"; const plA = mk(A), job = await plA.createJob("A marketing ad about reporting. ".repeat(10), "text"); const st = (await paused(() => plA.analyse(job))).job;
  const { readFileSync: rd, writeFileSync: wr } = await import("node:fs");
  for (const f of ["status.json", "progress.json"]) { const p = path.join(st.dir, f), j = JSON.parse(rd(p, "utf8")); if (f === "status.json") j.dir = st.dir; else for (const k of Object.keys(j.steps ?? {})) if (j.steps[k] && typeof j.steps[k] === "object" && "folder" in (j.steps[k].value ?? j.steps[k])) { const v = j.steps[k].value ?? j.steps[k]; v.dir = st.dir; delete v.folder; } wr(p, JSON.stringify(j)); }
  renameSync(A, B); pauseRole = null; const plB = mk(B), moved = (await plB.listJobs())[0], res = await plB.resume(moved);
  ok("a job saved by the OLD version (absolute paths in status.json and in the saved step) still loads, and resumes after being moved", moved.dir.startsWith(B) && (res.job ?? res).status === "analysed" && (res.job ?? res).dir.startsWith(B));
}
rmSync(root, { recursive: true, force: true });
console.log(failures === 0 ? "\nall paths tests passed" : `\n${failures} paths test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
