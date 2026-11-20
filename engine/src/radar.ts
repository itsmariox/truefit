// Gap radar: plain code over the analyses already saved in jobs/. It counts which gaps keep coming up and which
// unverified facts keep being needed, so the user can confirm, learn or reframe them. No AI, no quota.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { oneLine } from "./checks.ts";
import type { JobState } from "./pipeline.ts";

export type RadarInput = { state: JobState; analysis: any };
const key = (s: string) => oneLine(s, 60).toLowerCase().replace(/[^a-z0-9+#./ ]/g, "").replace(/\s+/g, " ").trim();

export function radar(items: RadarInput[], now = new Date(), days = 30) {
  const since = now.getTime() - days * 86_400_000;
  const recent = items.filter((i) => Date.parse(i.state.created) >= since && i.analysis);
  const gaps = new Map<string, { label: string; n: number }>();
  const unverified = new Map<string, number>();
  const verdicts: Record<string, number> = { apply: 0, long_shot: 0, skip: 0 };
  let fitSum = 0, built = 0, skipped = 0;
  for (const { state, analysis: a } of recent) {
    verdicts[a.verdict] = (verdicts[a.verdict] ?? 0) + 1;
    fitSum += Number(a.fit_percent) || 0;
    if (state.status === "built") built++;
    if (state.status === "skipped") skipped++;
    const seen = new Set<string>();
    for (const g of a.gaps ?? []) { const k = key(g.gap); if (!k || seen.has(k)) continue; seen.add(k); const e = gaps.get(k) ?? { label: oneLine(g.gap, 40), n: 0 }; e.n++; gaps.set(k, e); }
    for (const u of new Set((a.unverified_needed ?? []).map((x: string) => oneLine(x, 40)))) unverified.set(u as string, (unverified.get(u as string) ?? 0) + 1);
  }
  const n = recent.length;
  return {
    n, days, avgFit: n ? Math.round(fitSum / n) : 0, verdicts, built, skipped,
    topGaps: [...gaps.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).slice(0, 6),
    unverified: [...unverified.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, count]) => ({ label, count })),
  };
}

export function radarMessage(r: ReturnType<typeof radar>): string {
  if (!r.n) return `📡 Gap radar: no jobs analysed in the last ${r.days} days yet.`;
  const lines = [
    `📡 Gap radar, last ${r.days} days`,
    `${r.n} job${r.n === 1 ? "" : "s"} analysed · average fit ${r.avgFit}% · ${r.built} CV${r.built === 1 ? "" : "s"} built · ${r.skipped} skipped`,
    `Verdicts: ${r.verdicts.apply ?? 0} apply, ${r.verdicts.long_shot ?? 0} long shot, ${r.verdicts.skip ?? 0} skip`,
  ];
  const repeated = r.topGaps.filter((g) => g.n >= 2);
  if (repeated.length) lines.push("", "Gaps that keep coming up:", ...repeated.map((g) => `⚠️ ${g.label}: ${g.n} of ${r.n} jobs`));
  else if (r.topGaps.length) lines.push("", "No gap has repeated across jobs yet.");
  if (r.unverified.length) lines.push("", "Asked for in ads but not in your profile (add them if you have them):", ...r.unverified.map((u) => `• ${u.label}: ${u.count}×`));
  return lines.join("\n");
}

export async function radarFromJobs(jobs: JobState[], now = new Date()) {
  const items: RadarInput[] = [];
  for (const s of jobs) { try { items.push({ state: s, analysis: JSON.parse(await readFile(path.join(s.dir, "analysis.json"), "utf8")) }); } catch { /* not analysed */ } }
  return radar(items, now);
}
