const { radar, radarMessage } = await import("../src/radar.ts");
// Offline tests for the gap radar. (Moved out of core.test.ts at the step 7b cutover.)
let failures = 0;
const ok = (name: string, cond: boolean) => { if (!cond) failures++; console.log((cond ? "PASS " : "FAIL ") + name); };
const throws = async (fn: () => Promise<unknown>, re: RegExp) => { try { await fn(); return false; } catch (e) { return re.test((e as Error).message); } };

const mk = (gaps: string[], status: string, verdict = "long_shot", fit = 50, created = "2026-11-10T10:00:00Z") => ({ state: { created, status } as never, analysis: { gaps: gaps.map((g) => ({ gap: g })), verdict, fit_percent: fit, unverified_needed: ["Docker"] } });
const r = radar([mk(["Kubernetes", "SQL tuning"], "built"), mk(["kubernetes"], "skipped", "skip", 20), mk(["Kubernetes"], "analysed", "apply", 80), mk(["Old"], "built", "apply", 90, "2026-09-01T00:00:00Z")], new Date("2026-11-13T00:00:00Z"));
ok("radar: counts each gap once per job, case-insensitive, last 30 days only", r.n === 3 && r.topGaps[0].label === "Kubernetes" && r.topGaps[0].n === 3 && !r.topGaps.some((g) => g.label === "Old") && r.avgFit === 50 && r.built === 1 && r.skipped === 1);
ok("radar: unverified facts that keep being asked for are listed", r.unverified[0].label === "Docker" && r.unverified[0].count === 3 && radarMessage(r).includes("Kubernetes: 3 of 3"));


console.log(failures === 0 ? "\nall radar tests passed" : `\n${failures} radar test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
