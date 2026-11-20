// Step 8, Test 1: does light rewording add ad keywords over choose-and-order? One Analyst call per ad (shared), then the Writer `reps` times in each mode.
// No Checker, no Coach (Test 2 covers the Checker). Pass bar (agreed with the owner): reworded CVs average at least +5 percentage points of keyword coverage over
// choose-and-order, and are lower on no more than 1 ad. Usage (real calls, about 30): CVAPP_LIVE=1 node evals/reword-keywords.ts <output-folder> [reps]
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { QueryFn, AgentConfig } from "../src/agents/runner.ts";
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, "..");
const { createSdkRunner } = await import("../src/agents/runner.ts");
const { profileToPersona, cleanText } = await import("../src/profile.ts");
const { validateCvSelection } = await import("../src/cv/selection.ts");
const { makeCv } = await import("../src/cv/fit.ts");
const { adKeywords, coverage, gain } = await import("../src/eval/keywords.ts");
type Mode = "choose-and-order" | "reword";
export type Run = { mode: Mode; rep: number; ok: boolean; retried: boolean; problems: string[]; pages?: number; text?: string; percent?: number; named?: number; words?: number; rewrites?: { id: string; original: string; reworded: string }[]; added?: string[]; lost?: string[] };
export type Deps = { query?: QueryFn; provider?: import("../src/agents/provider.ts").ModelProvider; renderer: any; fonts: any; profile: any; config: AgentConfig; outDir: string; adsDir?: string; reps?: number; now?: Date; log?: (s: string) => void };

export async function runTest1(d: Deps) {
  const log = d.log ?? console.log, reps = d.reps ?? 2, now = d.now ?? new Date("2026-11-16T12:00:00Z");
  const ctx = profileToPersona(d.profile, now), adsDir = d.adsDir ?? path.join(here, "ads");
  const ads = (await readdir(adsDir)).filter((f) => f.endsWith(".md")).sort();
  const runnerFor = (mode: Mode) => createSdkRunner({ profile: d.profile, tone: "friendly", config: d.config, skillsDir: path.join(root, "skills"), query: d.query, ...(d.provider ? { provider: d.provider } : {}), tmpRoot: os.tmpdir(), now: () => now, writerMode: mode, env: process.env });
  const results: { ad: string; analystOk: boolean; keywords?: { named: string[]; words: string[] }; runs: Run[] }[] = [];
  for (const ad of ads) {
    const dir = path.join(d.outDir, ad.replace(/\.md$/, "")); await mkdir(dir, { recursive: true });
    const adText = await readFile(path.join(adsDir, ad), "utf8"); await writeFile(path.join(dir, "ad.md"), adText);
    const rec = { ad, analystOk: false, runs: [] as Run[], keywords: undefined as undefined | { named: string[]; words: string[] } };
    results.push(rec);
    const a = await runnerFor("choose-and-order")(dir, "analyst");
    if (a.code !== 0) { log(`${ad}: Analyst failed (${a.log})`); if (results.every((r) => !r.analystOk)) throw new Error(`stopping: the first Analyst call failed (${a.log}); nothing else would work either`); continue; }
    rec.analystOk = true; const kw = adKeywords(adText, ctx.skills.allowed); rec.keywords = kw;
    const analysis = JSON.parse(await readFile(path.join(dir, "analysis.json"), "utf8"));
    const focusOf = (f: unknown) => (typeof f === "number" && ctx.archetypes.some((x) => x.id === f) ? f : ctx.archetypes[0]?.id ?? null);
    for (const mode of ["choose-and-order", "reword"] as Mode[]) for (let rep = 1; rep <= reps; rep++) {
      const wd = path.join(dir, `${mode}-${rep}`); await mkdir(wd, { recursive: true });
      for (const f of ["ad.md", "analysis.json"]) await copyFile(path.join(dir, f), path.join(wd, f));
      const run: Run = { mode, rep, ok: false, retried: false, problems: [] }; rec.runs.push(run);
      const w = runnerFor(mode);
      let sel = null as null | ReturnType<typeof validateCvSelection>["selection"], focus = focusOf(analysis.focus_id);
      for (let turn = 1; turn <= 2 && !sel; turn++) {
        const r = await w(wd, "writer");
        if (r.code !== 0) { run.problems.push(`writer call failed: ${r.log}`); break; }
        const raw = JSON.parse(await readFile(path.join(wd, "selection-raw.json"), "utf8")), v = validateCvSelection(raw, ctx, { mode });
        if (v.selection) { sel = v.selection; break; }
        run.problems = v.errors; run.retried = true; focus = focusOf(raw?.focus_id) ?? focus;
        await writeFile(path.join(wd, "writer-problems.json"), JSON.stringify({ source: "code rules", problems: v.errors }));
        await writeFile(path.join(wd, "writer-focus.json"), JSON.stringify({ focus }));
      }
      if (!sel) { log(`${ad} ${mode} #${rep}: no valid selection (${run.problems[0] ?? "?"})`); continue; }
      const made = await makeCv(d.profile, sel, { renderer: d.renderer, fonts: d.fonts, accent: "oxford", showRightToWork: true });
      run.pages = made.fit.pages; run.text = made.text; run.ok = made.fit.ok && made.report.ok;
      const orig = new Map(ctx.bullets.map((b) => [b.id, b.text]));
      run.rewrites = (made.fit.selection.rewrites ?? []).map((x) => ({ id: x.id, original: orig.get(x.id) ?? "", reworded: cleanText(x.text) }));
      if (!run.ok) { log(`${ad} ${mode} #${rep}: CV built but failed the page or ATS checks`); continue; }
      const c = coverage(made.text, kw); run.percent = c.percent; run.named = c.namedHit.length; run.words = c.wordsHit.length;
      (run as any)._cov = c;
      log(`${ad} ${mode} #${rep}: coverage ${c.percent}% (${c.hit}/${c.total}), ${run.rewrites.length} rewrites${run.retried ? ", needed a retry" : ""}`);
    }
    // gains for this ad: each reworded run against the choose-and-order runs (best case for the baseline: its highest coverage)
    const base = rec.runs.filter((r) => r.mode === "choose-and-order" && (r as any)._cov).sort((x, y) => (y.percent ?? 0) - (x.percent ?? 0))[0];
    for (const r of rec.runs.filter((x) => x.mode === "reword" && (x as any)._cov)) if (base) { const g = gain((base as any)._cov, (r as any)._cov); r.added = g.added; r.lost = g.lost; }
  }
  for (const r of results) for (const x of r.runs) delete (x as any)._cov;
  const summary = summarise(results);
  await writeFile(path.join(d.outDir, "results.json"), JSON.stringify({ results, summary }, null, 2));
  await writeFile(path.join(d.outDir, "report.md"), report(results, summary));
  return { results, summary };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export function summarise(results: { ad: string; runs: Run[] }[]) {
  const rows = results.map((r) => {
    const m = (mode: Mode) => avg(r.runs.filter((x) => x.mode === mode && x.ok && x.percent !== undefined).map((x) => x.percent!));
    const base = m("choose-and-order"), rew = m("reword");
    return { ad: r.ad, base, reword: rew, diff: rew - base, failedReword: r.runs.filter((x) => x.mode === "reword" && !x.ok).length, failedBase: r.runs.filter((x) => x.mode === "choose-and-order" && !x.ok).length };
  });
  const usable = rows.filter((r) => !Number.isNaN(r.diff)), meanGain = avg(usable.map((r) => r.diff)), lower = usable.filter((r) => r.diff < 0).length;
  const failed = rows.reduce((s, r) => s + r.failedReword, 0);
  return { rows, usableAds: usable.length, meanGain, lowerOnAds: lower, rewordRunsFailed: failed, passes: usable.length >= 5 && meanGain >= 5 && lower <= 1 };
}
function report(results: { ad: string; runs: Run[] }[], s: ReturnType<typeof summarise>) {
  const f = (n: number) => (Number.isNaN(n) ? "n/a" : n.toFixed(1));
  const L = ["# Test 1: keyword coverage, reworded vs choose-and-order", "", "| Ad | choose-and-order % | reword % | difference | reword runs failed |", "|---|---|---|---|---|", ...s.rows.map((r) => `| ${r.ad} | ${f(r.base)} | ${f(r.reword)} | ${f(r.diff)} | ${r.failedReword} |`), "",
    `Ads usable: ${s.usableAds}. Mean gain: ${f(s.meanGain)} points (bar: at least 5). Ads where rewording is lower: ${s.lowerOnAds} (bar: at most 1). Reword runs that failed validation or checks: ${s.rewordRunsFailed}.`, `**Result against the bar: ${s.passes ? "PASS" : "FAIL"}** (needs at least 5 usable ads).`, "", "## Rewordings (read these: a gain from awkward phrasing is not a gain)"];
  for (const r of results) for (const x of r.runs.filter((y) => y.mode === "reword" && y.rewrites?.length)) { L.push(`### ${r.ad} #${x.rep}`, `Keywords added: ${x.added?.join(", ") || "none"}; lost: ${x.lost?.join(", ") || "none"}`); for (const w of x.rewrites!) L.push(`- ORIGINAL: ${w.original}`, `  REWORDED: ${w.reworded}`); }
  return L.join("\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.CVAPP_LIVE !== "1") { console.log("set CVAPP_LIVE=1 (about 30 real Claude calls)"); process.exit(0); }
  const out = process.argv[2]; if (!out) { console.error("give an output folder"); process.exit(2); }
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const { loadConfig } = await import("../src/config.ts");
  const { ChromeCliRenderer, loadFonts } = await import("../src/cv/render.ts");
  const profile = JSON.parse(await readFile(path.join(root, "tests", "fixtures", "profile-priya.json"), "utf8"));
  // CVAPP_PROVIDER=openai (with OPENAI_API_KEY in the environment) runs the same test through the OpenAI provider and the config's OpenAI models: the like-for-like run in docs/EVAL-OPENAI-LOGIN.md section 4.
  // Never run by the test suite; it makes real, billed calls.
  let provider: Deps["provider"], config = await loadConfig();
  if (process.env.CVAPP_PROVIDER === "openai") {
    const key = process.env.OPENAI_API_KEY; if (!key) { console.error("set OPENAI_API_KEY"); process.exit(2); }
    const { createOpenAIProvider } = await import("../src/agents/openai-provider.ts");
    provider = createOpenAIProvider({ getAuth: async () => ({ kind: "apiKey", token: key }) }); config = { ...config, models: config.openaiModels ?? config.models };
  }
  const { summary } = await runTest1({ query: provider ? undefined : (query as never), provider, renderer: new ChromeCliRenderer(), fonts: await loadFonts(), profile, config, outDir: out, reps: Number(process.argv[3] ?? 2) });
  console.log(JSON.stringify(summary, null, 1)); console.log("report:", path.join(out, "report.md"));
}
