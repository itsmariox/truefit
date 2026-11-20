// Phase 4e: the start-up host and the access handlers, on the REAL core (real files, real engine), fakes only for Claude, the login status, the clock and the Keychain.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startApp } from "../src/main/core/app-core.ts";
import { createHost } from "../src/main/core/host.ts";
import { createCoreHandlers } from "../src/main/handlers.ts";
import type { AccessView, SignInProgress } from "../src/shared/contract.ts";
import { DB_FILE } from "../../engine/src/store/open.ts";
import { rig, priya } from "./core-rig.ts";
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-handlers-")); mkdirSync(path.join(root, "tmp"));
const KEY = "sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE-FAKE";
try {
  const R = rig(root); const ready: string[] = [];
  const host = createHost({ start: () => startApp(R.deps()), onReady: () => ready.push("ready") });
  const pushed: { signin: SignInProgress[]; changed: AccessView[]; copied: string[] } = { signin: [], changed: [], copied: [] };
  const h = createCoreHandlers({ host, now: R.clock, push: { signin: (p) => pushed.signin.push(p), changed: (v) => pushed.changed.push(v) }, copy: (t) => pushed.copied.push(t) });
  const thrown = async (f: () => unknown) => { try { await f(); return false; } catch { return true; } };

  ok("1. before start-up finishes, the status is 'starting' and every access request is refused (nothing runs without a core)", host.status().phase === "starting" && await thrown(() => h["access:get"](undefined)) && await thrown(() => h["access:signIn"](undefined)));
  await host.start();
  ok("2. after start-up the status is 'ready' and the core was handed over once", host.status().phase === "ready" && ready.length === 1);

  let v = await h["access:get"](undefined);
  ok("3. a fresh app: 'choose how to connect', two buttons with their approved labels, not connected, and the notice text is there", v.kind === "not_chosen" && v.message.tone === "info" && v.message.actions.map((a) => a.label).join() === "Use my Claude subscription,Use an API key" && !v.connected && v.mode === null && v.notice.points.length === 3 && /I understand/.test(v.notice.checkbox));
  v = await h["access:chooseMode"]({ mode: "subscription" });
  ok("4. choosing the subscription asks for the notice to be read; the change is pushed to the page", v.kind === "notice_needed" && !v.noticeAccepted && v.mode === "subscription" && pushed.changed.at(-1)?.kind === "notice_needed");
  v = await h["access:acceptNotice"](undefined);
  ok("5. ticking the notice is remembered, and with Claude's program reporting a signed-in Pro plan the state is 'connected' with a Test connection button", v.kind === "connected" && v.connected && v.noticeAccepted && /Pro plan/.test(v.message.body) && v.message.actions.map((a) => a.label).join() === "Test connection");

  const t = await h["access:test"](undefined);
  ok("6. 'Test connection' runs one tiny call and answers in the approved words", t.message?.id === "test.ok" && t.message.tone === "ok" && R.script.calls === 1);

  const si = await h["access:signIn"](undefined); await new Promise((r) => setTimeout(r, 50));
  ok("7. a sign-in that cannot start (no Claude program in this test) ends with the plain 'program couldn't start' message and the page is told it is no longer running", si.started === true && pushed.signin.at(-1)?.running === false && pushed.signin.at(-1)?.message.id === "signin.not_runnable" && (await h["access:signIn"](undefined)).started === true);
  ok("8. cancelling and pasting a code with nothing running do nothing harmful", (await h["access:cancelSignIn"](undefined)).cancelled === true && (await h["access:submitCode"]({ code: "abc" })).accepted === false);

  await h["access:chooseMode"]({ mode: "apiKey" });
  const sk = await h["access:saveKey"]({ key: "not a key" });
  ok("9. something that is not a key is refused with the 'doesn't look like an API key' message and nothing is saved", sk.message?.id === "key.malformed" && !sk.view.connected);
  const calls0 = R.script.calls; const good = await h["access:saveKey"]({ key: KEY });
  ok("10. a key that looks right is checked with one tiny call and saved; the answer is the approved 'working and saved' message", good.message?.id === "key.saved" && good.view.connected === true && good.view.kind === "key_saved" && R.script.calls === calls0 + 1 && (await R.secrets.get("claude-api-key")) === KEY);
  const everything = JSON.stringify([v, sk, good, t, pushed]);
  ok("11. the key is never sent back to the page, in any message, detail or event", !everything.includes(KEY) && !everything.includes("FAKEFAKE"));
  ok("12. copying diagnostics goes through the copy function, once", (await h["app:copy"]({ text: "x" })).copied === true && pushed.copied.join() === "x");
  await host.core()!.shutdown(); // a normal quit: writes the last backup

  // start-up problems
  writeFileSync(path.join(root, "data", DB_FILE), "this is not a database".repeat(60));
  const R2 = rig(root, R.secrets); const host2 = createHost({ start: () => startApp(R2.deps()), onReady: () => undefined }); const h2 = createCoreHandlers({ host: host2, push: { signin: () => undefined, changed: () => undefined }, copy: () => undefined });
  await host2.start(); const st = await h2["app:status"](undefined);
  ok("13. a damaged database: the status says so and lists only the usable backups (file, date, reason)", st.phase === "damaged" && st.backups.length >= 1 && st.backups.every((b) => /^b[0-9a-f]{12}$/.test(b.id) && b.createdAt !== null) && !JSON.stringify(st).includes(root) && !JSON.stringify(st).includes("Application Support") && !("file" in st.backups[0]));
  ok("14. while damaged, no access request works (the core does not exist)", await thrown(() => h2["access:get"](undefined)));
  ok("15. restoring a file that was NOT listed is refused (a path from the page is never trusted)", await thrown(() => h2["app:recover"]({ id: "/etc/passwd" })) && host2.status().phase === "damaged");
  ok("16. starting fresh without the confirmation does nothing", (await h2["app:startFresh"]({ confirmed: false })).phase === "damaged");
  const rec = await h2["app:recover"]({ id: st.backups[0].id });
  ok("17. restoring a listed backup brings the app to 'ready' and the core works again", rec.phase === "ready" && (await h2["access:get"](undefined)).kind !== undefined);
  await host2.core()!.shutdown({ finalBackup: false });

  writeFileSync(path.join(root, "data", DB_FILE), "garbage".repeat(100));
  const R3 = rig(root, R.secrets); const host3 = createHost({ start: () => startApp(R3.deps()), onReady: () => undefined }); await host3.start();
  const fr = await host3.startFresh(true);
  ok("18. starting fresh (confirmed) gives an empty, working app", fr.phase === "ready" && host3.core()!.profile.get() === null); await host3.core()!.shutdown({ finalBackup: false });
  const hostBad = createHost({ start: async () => { throw new Error("/Users/someone/secret"); }, onReady: () => undefined, log: () => undefined }); await hostBad.start();
  ok("19. a start-up that throws becomes the plain phase 'failed' (never an exception, never the error text)", hostBad.status().phase === "failed" && JSON.stringify(hostBad.status()) === '{"phase":"failed","backups":[]}');
  void priya;
} finally { rmSync(root, { recursive: true, force: true }); }
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); } else console.log("\nALL PASS");
