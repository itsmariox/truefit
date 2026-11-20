// Phase 4f: the job handlers on the REAL core (real files, real pipeline and runner), fakes only for Claude, the clock, the login status and the link fetch.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startApp } from "../src/main/core/app-core.ts";
import { createHost } from "../src/main/core/host.ts";
import { createJobsHandlers, eventChangesLists, toVerdict } from "../src/main/jobs-handlers.ts";
import type { UiJobRow } from "../src/shared/contract.ts";
import { rig, priya } from "./core-rig.ts";
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const settle = async (c: () => { queue: { snapshot(): { entries: { state: string }[]; blocked: boolean } } }) => { for (let t = 0; t < 500; t++) { const q = c().queue.snapshot(); if (!q.entries.some((e) => e.state === "running" || (e.state === "queued" && !q.blocked))) break; await new Promise((r) => setTimeout(r, 10)); } await new Promise((r) => setTimeout(r, 120)); };
const AD = (n: string) => `A marketing role at ${n}, working with the team on campaigns and reporting. `.repeat(6);
const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-jobsh-")); mkdirSync(path.join(root, "tmp"));
try {
  const R = rig(root); const host = createHost({ start: () => startApp(R.deps()), onReady: () => undefined }); await host.start();
  const pushes: UiJobRow[][] = []; const fetched: string[] = []; let linkOk = true;
  const h = createJobsHandlers({ host, push: (r) => pushes.push(r), fetchAd: async (u) => { fetched.push(u); if (!linkOk) throw new Error("login wall at /Users/x"); return { url: u, text: AD("Linked Co") }; } });
  const core = host.core()!, thrown = async (f: () => unknown) => { try { await f(); return false; } catch { return true; } };
  core.access.chooseMode("subscription"); core.access.acceptNotice();

  const early = await h["jobs:create"]({ text: AD("Acme"), force: undefined });
  ok("1. with no profile a job is refused with the plain reason 'no_profile' and nothing is written", early.outcome === "refused" && early.reason === "no_profile" && (await h["jobs:list"](undefined)).length === 0);
  core.profile.save(priya);
  const emp = await h["jobs:create"]({ text: "  ", force: undefined }), big = await h["jobs:create"]({ text: "x".repeat(30001), force: undefined });
  ok("2. an empty or over-long ad is refused with a reason", emp.outcome === "refused" && emp.reason === "empty" && big.outcome === "refused" && big.reason === "too_long");
  const c1 = await h["jobs:create"]({ text: AD("Acme Retail"), force: undefined }); if (c1.outcome !== "created") throw new Error("create failed");
  ok("3. a pasted ad becomes a job (titled 'New job' until it is read) and NO Claude call was made", c1.job.title === "New job");
  ok("3b. no analysis call yet; the only call made was the one small \"is this a job ad?\" check", R.script.calls === 0 && R.script.gateCalls === 1);
  const GATE_JUNK = "What is the weather going to be like in Leeds this weekend, and should I bring a coat or an umbrella when we meet by the river for lunch on Saturday afternoon? ".repeat(3);
  const g0 = R.script.gateCalls, n0 = (await h["jobs:list"](undefined)).length;
  const shortJ = await h["jobs:create"]({ text: "hi", force: undefined });
  ok("3c. 'hi' is refused as 'too_short' with NO call at all, and nothing is made", shortJ.outcome === "refused" && shortJ.reason === "too_short" && R.script.gateCalls === g0 && (await h["jobs:list"](undefined)).length === n0);
  const notJ = await h["jobs:create"]({ text: GATE_JUNK, force: undefined });
  ok("3d. a long text that is not a job ad is refused as 'not_a_job' after ONE small check call, and nothing is made (no analysis call either)", notJ.outcome === "refused" && notJ.reason === "not_a_job" && R.script.gateCalls === g0 + 1 && R.script.calls === 0 && (await h["jobs:list"](undefined)).length === n0);
  R.script.next = "auth"; const g1 = R.script.gateCalls, wasDown = await h["jobs:create"]({ text: GATE_JUNK, force: undefined }); R.script.next = "ok";
  ok("3e. if the check itself cannot run (signed out), it fails OPEN: the check was tried, found no answer, and the job went through (the analysis will pause with the sign-in words)", wasDown.outcome === "created" && R.script.gateCalls === g1 + 1);
  const forcedJ = await h["jobs:create"]({ text: GATE_JUNK + " Thanks so much!", force: true });
  ok("3f. 'Try anyway' skips the check entirely", forcedJ.outcome === "created" && R.script.gateCalls === g0 + 2); // (the check ran once for 3d and once for 3e; none for the forced job)
  for (const j of [wasDown, forcedJ]) if (j.outcome === "created") await h["jobs:skip"]({ id: j.job.id });
  const a = await h["jobs:analyse"]({ id: c1.job.id }); await settle(() => core);
  const d1 = await h["jobs:get"]({ id: c1.job.id });
  ok("4. analysing runs through the queue; the job now shows its title, an 'apply' verdict with fit, the checked rules and Claude's plain message", a.queued && d1?.status === "analysed" && d1.title === "Acme Retail, Marketing Executive" && d1.verdict?.verdict === "apply" && d1.verdict.fit === 70 && Array.isArray(d1.verdict.rules) && typeof d1.coach === "string" && d1.coach.includes("70%") && d1.pause === null && d1.queue === null);
  ok("5. the page was told about the change (a 'jobs:changed' push with the job's new title)", pushes.length > 0 && pushes.some((r) => r.some((x) => x.id === c1.job.id && x.title.startsWith("Acme Retail"))));
  const dup = await h["jobs:create"]({ text: AD("Acme Retail").toUpperCase(), force: undefined });
  ok("6. the same ad again is a 'duplicate' pointing at the existing job (open it, or Analyse again)", dup.outcome === "duplicate" && dup.existing.id === c1.job.id);
  const again = await h["jobs:analyse"]({ id: c1.job.id }); await settle(() => core);
  ok("7. 'Analyse again' queues a new analysis of the same job", again.queued === true && R.script.calls >= 4 && (await h["jobs:get"]({ id: c1.job.id }))?.status === "analysed");

  const lk = await h["jobs:create"]({ text: "https://jobs.example.com/ad/123", force: undefined });
  ok("8. one link on its own is read by the main process and becomes a 'link' job with its address kept", lk.outcome === "created" && fetched.join() === "https://jobs.example.com/ad/123" && (await h["jobs:get"]({ id: lk.job.id }))?.source === "link" && (await h["jobs:get"]({ id: lk.job.id }))?.url === "https://jobs.example.com/ad/123");
  linkOk = false; const before = (await h["jobs:list"](undefined)).length; const bad = await h["jobs:create"]({ text: "https://wall.example.com/x", force: undefined });
  ok("9. a link that cannot be read gives the plain reason 'link_failed' (no error text), and no job is made", bad.outcome === "refused" && bad.reason === "link_failed" && !JSON.stringify(bad).includes("/Users") && (await h["jobs:list"](undefined)).length === before);
  const withText = await h["jobs:create"]({ text: "See https://jobs.example.com/ad/9 for " + AD("Textlink"), force: undefined });
  ok("10. text that merely CONTAINS a link is treated as text (the link is not fetched)", withText.outcome === "created" && fetched.length === 2);

  R.script.next = "auth"; R.script.company = "Larkfield";
  const c3 = await h["jobs:create"]({ text: AD("Larkfield"), force: undefined }); if (c3.outcome !== "created") throw new Error("c3");
  await h["jobs:analyse"]({ id: c3.job.id }); await settle(() => core);
  const p = await h["jobs:get"]({ id: c3.job.id });
  ok("11. Claude not signed in PAUSES the job; the detail carries the approved pause message with a Resume button, and the row 'needs you'", p?.status === "paused" && p.pause?.title === "Claude needs you to sign in again" && p.pause.actions.some((x) => x.label === "Resume") && (await h["jobs:list"](undefined)).find((r) => r.id === c3.job.id)?.needsYou === true);
  R.script.next = "ok"; const callsAt = R.script.calls; await new Promise((r) => setTimeout(r, 100));
  ok("12. nothing resumes by itself", R.script.calls === callsAt && (await h["jobs:get"]({ id: c3.job.id }))?.status === "paused");
  const rs = await h["jobs:resume"]({ id: c3.job.id }); await settle(() => core);
  ok("13. the user's Resume finishes it", rs.queued && (await h["jobs:get"]({ id: c3.job.id }))?.status === "analysed");
  const c4 = await h["jobs:create"]({ text: AD("Skippy"), force: undefined }); if (c4.outcome !== "created") throw new Error("c4");
  await h["jobs:skip"]({ id: c4.job.id });
  ok("14. Skip marks the job as skipped", (await h["jobs:get"]({ id: c4.job.id }))?.status === "skipped");
  ok("15. an unknown job id is refused (no crash, no path built from it)", await thrown(() => h["jobs:analyse"]({ id: "../../etc" })) && await thrown(() => h["jobs:skip"]({ id: "nope" })) && (await h["jobs:get"]({ id: "nope" })) === null);
  ok("16. the verdict card is built defensively: garbage or missing analysis gives no card, long text is cut, odd rule statuses are dropped", toVerdict(null) === null && toVerdict({ verdict: "maybe", fit_percent: 50 }) === null && (toVerdict({ verdict: "skip", fit_percent: 250, fit_note: "x".repeat(5000), constraint_checks: [{ rule: "salary", status: "fail", note: "n" }, { rule: "a", status: "weird", note: "" }, null], strengths: [{ text: "s" }, {}], gaps: [{ gap: "g", handle: "h" }, {}] })?.fit === 100) && toVerdict({ verdict: "skip", fit_percent: 20, fit_note: "x".repeat(5000), constraint_checks: [{ rule: "salary", status: "fail", note: "n" }, { rule: "a", status: "weird", note: "" }, null] })!.rules.length === 1 && toVerdict({ verdict: "skip", fit_percent: 20, fit_note: "x".repeat(5000) })!.fitNote.length === 600);
  { // review 2026-11-18: a failure note that quotes a file path must not carry it to the page; step events must not trigger list rescans
    const jd = path.join(root, "data", "jobs"); for (const f of readdirSync(jd)) { const sj = path.join(jd, f, "status.json"); try { const st = JSON.parse(readFileSync(sj, "utf8")); if (st.id === c1.job.id) { st.note = "could not read /Users/someone/Library/Application Support/Truefit/data/jobs/ab12/analysis.json (disk)"; writeFileSync(sj, JSON.stringify(st)); } } catch { /* not a job folder */ } }
    const dn: any = await h["jobs:get"]({ id: c1.job.id });
    ok("16b. a failure note that quotes a file path reaches the page with the path replaced, and the rest of the sentence kept", dn && typeof dn.note === "string" && dn.note.includes("[path]") && !dn.note.includes("/Users") && dn.note.includes("could not read") && dn.note.includes("(disk)"));
    ok("16c. a step starting or ending, or a recovery signal, does not make the page re-read the lists; a job or queue change does", !eventChangesLists({ type: "step" }) && !eventChangesLists({ type: "recovery" }) && eventChangesLists({ type: "job" }) && eventChangesLists({ type: "queue" }));
  }
  ok("17. the job's folder path never reaches the page", !JSON.stringify([d1, p, pushes]).includes(root) && readdirSync(path.join(root, "data", "jobs")).length >= 3);
  // a job paused BEFORE a restart still shows its real pause message afterwards (the kind is read back from the job's note)
  R.script.next = "auth"; const c5 = await h["jobs:create"]({ text: AD("Restarted Co"), force: undefined }); if (c5.outcome !== "created") throw new Error("c5");
  await h["jobs:analyse"]({ id: c5.job.id }); await settle(() => core); await core.shutdown({ finalBackup: false });
  const host2 = createHost({ start: () => startApp(R.deps()), onReady: () => undefined }); await host2.start();
  const h2 = createJobsHandlers({ host: host2, push: () => undefined, fetchAd: async () => { throw new Error("no"); } });
  const after = await h2["jobs:get"]({ id: c5.job.id });
  ok("18. after a restart a paused job still shows its real pause message (sign-in), not a generic one, with Resume", after?.status === "paused" && after.pause?.title === "Claude needs you to sign in again" && after.pause.actions.some((x) => x.label === "Resume"));
  await host2.core()!.shutdown({ finalBackup: false });
} finally { rmSync(root, { recursive: true, force: true }); }
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); } else console.log("\nALL PASS");
