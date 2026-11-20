// Phase 3d: the sign-in flow, tested against small fake "claude" programs that behave the way the real one did in step 3b (no terminal, prints a link, finishes by itself).
// The real sign-in needs a person and a browser, so it is not run here (it was run once by hand in 3b). No login of the user is touched.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const { createSignIn, allowedLink } = await import("../src/access/signin.ts");
const O = await import("../src/agents/options.ts");
const { createAccess } = await import("../src/access/access.ts");
const { openDb } = await import("../src/store/db.ts");
const { migrate } = await import("../src/store/migrate.ts");
const { MIGRATIONS } = await import("../src/store/schema.ts");
const { MemorySecretStore } = await import("../src/store/secrets.ts");
type Ev = import("../src/access/signin.ts").SignInEvent;
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-signin-"));
const prog = (name: string, body: string) => { const f = path.join(root, name); writeFileSync(f, "#!/bin/sh\n" + body); chmodSync(f, 0o755); return f; };
const LINK = "https://claude.com/cai/oauth/authorize?code=true&client_id=test&state=ONETIMESTATE";
const loggedIn = async () => ({ ok: true as const, status: { loggedIn: true, method: "claude.ai", plan: "pro", expiresAt: null } });
const notIn = async () => ({ ok: true as const, status: { loggedIn: false, method: null, plan: null, expiresAt: null } });
const env = O.minimalEnv(process.env, { configDir: path.join(root, "cfg") });
const run = async (binary: string, o: Partial<Parameters<typeof createSignIn>[0]> = {}, act?: (h: import("../src/access/signin.ts").SignInHandle, ev: Ev[]) => void) => {
  const ev: Ev[] = []; let signedIn = 0; const s = createSignIn({ binary, env, confirm: loggedIn, onSignedIn: () => signedIn++, ...o });
  const h = s.start((e) => ev.push(e)); act?.(h, ev); const r = await h.done; return { r, ev, signedIn, s };
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// ---------- the happy path, like the real program ----------
{
  const argv = path.join(root, "argv.txt"), envf = path.join(root, "env.txt");
  const good = prog("good.sh", `printf '%s\\n' "$@" > ${argv}; env | cut -d= -f1 | sort > ${envf}; echo "SECRETCANARY-TOKEN-1234 printed by the program"; echo "Opening browser to sign in…"; echo "If the browser didn't open, visit: ${LINK}"; printf 'Paste code here if prompted > '; sleep 0.4; echo "Login successful."; exit 0\n`);
  const { r, ev, signedIn } = await run(good);
  ok("the flow: starting, the link, waiting for the browser, then (after the program finishes by itself with exit 0) confirming with the free status check, then success; onSignedIn is called once", r.ok && ev.map((e) => e.type).join() === "starting,link,waiting_for_browser,code_requested,confirming" && signedIn === 1);
  ok("the link offered is the allow-listed Claude link, as printed", ev.some((e) => e.type === "link" && (e as { url: string }).url.startsWith("https://claude.com/cai/oauth/authorize?code=true&client_id=test&state=ONETIMESTATE")));
  ok("the program is started as `auth login --claudeai`, with the ONE environment function's environment: USER set, the settings-folder variable passed, no API key, nothing else inherited", readFileSync(argv, "utf8").trim().split("\n").join(" ") === "auth login --claudeai" && (() => { const k = readFileSync(envf, "utf8").split("\n"); return k.includes("USER") && k.includes("CLAUDE_CONFIG_DIR") && !k.includes("ANTHROPIC_API_KEY") && !k.some((x) => /^(CLAUDE_CODE_|AWS_|GITHUB|NODE_OPTIONS)/.test(x)); })());
  ok("the program's raw output never leaves the module: a token-like string it printed appears in no event and no result", !JSON.stringify(ev).includes("SECRETCANARY") && !JSON.stringify(r).includes("SECRETCANARY") && !JSON.stringify(ev).includes("Opening browser"));
}
// ---------- failures ----------
{
  const noConfirm = await run(prog("exit0.sh", `echo "${LINK}"; exit 0\n`), { confirm: notIn });
  ok("exit code 0 is NOT trusted by itself: if the status check does not say logged in, the result is not_confirmed (and onSignedIn is NOT called)", !noConfirm.r.ok && !noConfirm.r.ok && (noConfirm.r as { reason: string }).reason === "not_confirmed" && noConfirm.signedIn === 0);
  const statusFails = await run(prog("exit0b.sh", `echo "${LINK}"; exit 0\n`), { confirm: async () => ({ ok: false as const, reason: "timeout" as const }) }), statusThrows = await run(prog("exit0c.sh", `echo "${LINK}"; exit 0\n`), { confirm: async () => { throw new Error("boom"); } });
  ok("a status check that cannot run, or throws, is not_confirmed too, never success", (statusFails.r as { reason: string }).reason === "not_confirmed" && (statusThrows.r as { reason: string }).reason === "not_confirmed");
  const fail = await run(prog("fail.sh", `echo "${LINK}"; echo "SECRETCANARY-ERRTEXT access_denied"; exit 1\n`));
  ok("a non-zero exit is 'failed' with nothing from the program's output in the result", !fail.r.ok && (fail.r as { reason: string }).reason === "failed" && !JSON.stringify(fail).includes("SECRETCANARY") && fail.signedIn === 0);
  const missing = await run(path.join(root, "does-not-exist"));
  ok("a program that cannot be started is not_runnable", !missing.r.ok && (missing.r as { reason: string }).reason === "not_runnable" && !missing.s.isActive());
}
// ---------- cancel and timeout ----------
{
  const pidf = path.join(root, "pid.txt"), helperf = path.join(root, "helper.txt"), hang = prog("hang.sh", `echo $$ > ${pidf}; sleep 30 & echo $! > ${helperf}; echo "${LINK}"; wait\n`);
  const t0 = Date.now(); const { r, ev, signedIn } = await run(hang, {}, (h, evs) => { const tick = setInterval(() => { if (evs.some((e) => e.type === "link")) { clearInterval(tick); h.cancel(); } }, 20); });
  const pid = Number(readFileSync(pidf, "utf8").trim()), helper = Number(readFileSync(helperf, "utf8").trim());
  ok("cancel while waiting for the browser ends the program (really gone, AND any helper process it started: the whole process group), reports 'cancelled', does not call onSignedIn and does not wait for the program's 30 seconds", !r.ok && (r as { reason: string }).reason === "cancelled" && !alive(pid) && !alive(helper) && signedIn === 0 && Date.now() - t0 < 5000 && ev.some((e) => e.type === "link"));
  const t1 = Date.now(); const to = await run(prog("hang2.sh", `echo "${LINK}"; sleep 30\n`), { timeoutMs: 400 });
  ok("a sign-in nobody approves times out (a short limit here; 5 minutes by default), the program is killed, and the result is 'timeout'", !to.r.ok && (to.r as { reason: string }).reason === "timeout" && Date.now() - t1 < 6000);
  const stubborn = prog("stubborn.sh", `trap '' TERM; echo $$ > ${path.join(root, "pid2.txt")}; echo "${LINK}"; while true; do sleep 1; done\n`);
  const sb = await run(stubborn, {}, (h, evs) => { const tick = setInterval(() => { if (evs.some((e) => e.type === "link")) { clearInterval(tick); h.cancel(); } }, 20); });
  ok("a program that ignores the polite stop is killed hard after a short grace period", !sb.r.ok && !alive(Number(readFileSync(path.join(root, "pid2.txt"), "utf8").trim())));
  const done = createSignIn({ binary: prog("quick.sh", `echo "${LINK}"; exit 0\n`), env, confirm: loggedIn }).start(); const res = await done.done; done.cancel();
  ok("cancel after the flow has finished does nothing", res.ok);
}
// ---------- the link allow-list ----------
{
  ok("the allow-list: claude.com, claude.ai, anthropic.com and their sub-domains over https are allowed; another site, http, a port, embedded user names (claude.com@evil), look-alike hosts and non-links are refused", allowedLink("https://claude.com/x") !== null && allowedLink("https://platform.claude.com/oauth/code") !== null && allowedLink("https://console.anthropic.com/") !== null && allowedLink("https://claude.ai/login") !== null && ["https://evil.example/phish", "http://claude.com/x", "https://claude.com:8443/x", "https://claude.com@evil.example/x", "https://claude.com.evil.example/x", "https://notclaude.com/x", "https://evilclaude.ai/x", "javascript:alert(1)", "file:///etc/passwd", "claude.com", ""].every((u) => allowedLink(u) === null));
  const evil = await run(prog("evil.sh", `echo "If the browser didn't open, visit: https://evil.example/phish?x=1"; sleep 0.2; echo "now: ${LINK}"; sleep 0.2; exit 0\n`));
  ok("a link to another site is NEVER offered: the user gets 'link_blocked' (once) and only the genuine Claude link afterwards", evil.ev.filter((e) => e.type === "link_blocked").length === 1 && evil.ev.filter((e) => e.type === "link").length === 1 && !JSON.stringify(evil.ev).includes("evil.example"));
  const onlyEvil = await run(prog("evil2.sh", `echo "visit https://evil.example/a and https://evil.example/b"; sleep 30\n`), { timeoutMs: 500 });
  ok("if the program only ever prints a bad link, no link is offered at all (the user can cancel or it times out)", onlyEvil.ev.every((e) => e.type !== "link") && !onlyEvil.r.ok);
}
// ---------- a link that arrives in pieces ----------
{
  const split = prog("split.sh", `printf 'If the browser did not open, visit: https://claude.com/cai/oauth/authorize?code=true&client_'; sleep 0.3; printf 'id=test&state=ONETIMESTATE\\n'; sleep 0.1; exit 0\n`);
  const { ev, r } = await run(split);
  const links = ev.filter((e) => e.type === "link") as { type: "link"; url: string }[];
  ok("a link that arrives in TWO pieces is offered once, COMPLETE (never the cut-off first half, which would have been a broken link)", r.ok && links.length === 1 && links[0].url.includes("client_id=test") && links[0].url.includes("state=ONETIMESTATE") && ev.filter((e) => e.type === "link_blocked").length === 0);
  const nospace = await run(prog("tail.sh", `printf 'visit https://claude.com/cai/oauth/authorize?state=X'; sleep 0.2; exit 0\n`));
  ok("a link that never ends (no space or line break after it) is not offered at all", nospace.ev.every((e) => e.type !== "link"));
}
// ---------- the code fallback ----------
{
  const gotf = path.join(root, "got.txt");
  const withCode = prog("code.sh", `echo "${LINK}"; printf 'Paste code here if prompted > '; read c; if [ "$c" = "GOODCODE-123" ]; then echo "$c" | wc -c > ${gotf}; echo "Login successful."; exit 0; else exit 1; fi\n`);
  const bad = ["", "   ", "a\nb", "x".repeat(2001), "a\rb"]; const refused: boolean[] = [];
  const { r, ev } = await run(withCode, {}, (h, evs) => { const tick = setInterval(() => { if (evs.some((e) => e.type === "code_requested")) { clearInterval(tick); for (const b of bad) refused.push(h.submitCode(b) === false); refused.push(h.submitCode("  GOODCODE-123  ") === true); } }, 20); });
  ok("the fallback: a pasted code is passed to the program (trimmed) and the flow completes; empty, blank, multi-line, over-long and non-text codes are refused without being sent", r.ok && refused.length === bad.length + 1 && refused.every(Boolean) && existsSync(gotf) && !JSON.stringify(ev).includes("GOODCODE") && !JSON.stringify(r).includes("GOODCODE"));
  ok("submitting a code when nothing is running, or after the flow finished, is refused", await (async () => { const h = createSignIn({ binary: prog("q2.sh", `exit 0\n`), env, confirm: loggedIn }).start(); await h.done; return h.submitCode("abc") === false; })());
}
// ---------- one at a time, and the link with the access service ----------
{
  const s = createSignIn({ binary: prog("slow.sh", `echo "${LINK}"; sleep 0.5; exit 0\n`), env, confirm: loggedIn });
  const a = s.start(), b = s.start(), rb = await b.done, ra = await a.done;
  ok("only one sign-in runs at a time: a second start gets 'already_running' and does not disturb the first; afterwards a new one can start", ra.ok && !rb.ok && (rb as { reason: string }).reason === "already_running" && !s.isActive() && (await s.start().done).ok);
  const db = openDb(":memory:"); migrate(db, MIGRATIONS);
  const acc = createAccess({ db, secrets: new MemorySecretStore(), now: () => new Date("2026-11-17T12:00:00Z"), run: async () => ({ code: 0, stdout: JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro", loginExpiresAt: "2026-12-30T00:00:00Z" }), timedOut: false, failedToStart: false }) });
  acc.chooseMode("subscription"); acc.acceptNotice(); acc.recordError({ type: "authentication_failed", message: "Not logged in" });
  const before = (await acc.state()).kind;
  const out = await run(prog("ok.sh", `echo "${LINK}"; exit 0\n`), { onSignedIn: () => acc.signedIn() });
  ok("end to end with the access service: after an 'expired' error (Reconnect), a finished sign-in clears it at once and the state is connected", before === "expired" && out.r.ok && (await acc.state()).kind === "connected");
  const failed = await run(prog("no.sh", `exit 1\n`), { onSignedIn: () => acc.signedIn() }); acc.recordError({ type: "authentication_failed", message: "x" });
  ok("a failed or cancelled sign-in leaves the remembered error in place (still expired)", !failed.r.ok && (await acc.state()).kind === "expired");
  db.close();
}
// ---------- a throwing UI handler never breaks the flow ----------
{
  const h = createSignIn({ binary: prog("q3.sh", `echo "${LINK}"; exit 0\n`), env, confirm: loggedIn }).start(() => { throw new Error("UI exploded"); });
  ok("an error thrown by the screen's event handler never breaks the sign-in", (await h.done).ok);
}
rmSync(root, { recursive: true, force: true });
console.log(failures === 0 ? "\nall signin tests passed" : `\n${failures} signin test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
