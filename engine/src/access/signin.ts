// The sign-in flow (phase 3d). Built on what step 3b showed with the real program: `claude auth login --claudeai` needs NO terminal. It prints "Opening browser to sign in…",
// then a link, then "Paste code here if prompted >", and finishes BY ITSELF (exit code 0, "Login successful.") once the user approves in the browser. The paste prompt is only
// a fallback. The app starts it, shows the link, waits, and then CONFIRMS with the free status check (an exit code alone is not trusted).
// Safety: the program's raw output is never stored, logged or passed on (it can hold a link with one-time values or a token); only the allow-listed link and a few plain
// events leave this module. A code the user pastes goes straight to the program and is never kept.
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import type { StatusResult } from "./status.ts";

export type SignInEvent =
  | { type: "starting" }
  | { type: "link"; url: string }          // show it, copy it, or open it: it is on the allow-list
  | { type: "link_blocked" }               // the program printed a link to a site that is not Claude's: it is NOT offered
  | { type: "waiting_for_browser" }
  | { type: "code_requested" }             // the fallback: the user may paste the code the browser page shows
  | { type: "confirming" };                // the program finished; the status check is confirming the login
export type SignInResult =
  | { ok: true }
  | { ok: false; reason: "cancelled" | "timeout" | "failed" | "not_confirmed" | "not_runnable" | "already_running" };
export type SignInHandle = { done: Promise<SignInResult>; cancel(): void; submitCode(code: string): boolean };

// Only these sites may be offered to the user or opened (the host is read from the parsed link, so "https://claude.com@evil.example" is refused).
const ALLOWED_HOSTS = ["claude.com", "claude.ai", "anthropic.com"];
export function allowedLink(raw: string): string | null {
  let u: URL; try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const h = u.hostname.toLowerCase();
  return ALLOWED_HOSTS.some((a) => h === a || h.endsWith("." + a)) ? u.toString() : null;
}

export type SignInDeps = {
  binary: string;
  env: Record<string, string>;                            // from the ONE environment function
  confirm: () => Promise<StatusResult>;                   // the free status check
  onSignedIn?: () => void;                                // clears the remembered access error (access.signedIn)
  timeoutMs?: number;                                     // default 5 minutes
  spawnFn?: typeof nodeSpawn;
};
const MAX_BUFFER = 20_000, KILL_GRACE_MS = 2_000;

export function createSignIn(d: SignInDeps) {
  let active = false;
  return {
    isActive: () => active,
    start(onEvent: (e: SignInEvent) => void = () => undefined): SignInHandle {
      if (active) return { done: Promise.resolve({ ok: false, reason: "already_running" }), cancel() {}, submitCode: () => false };
      active = true;
      let child: ChildProcess | null = null, finished = false, cancelled = false, timedOut = false, buf = "", linkSent = false, codeAsked = false, blockedSent = false;
      const emit = (e: SignInEvent) => { try { onEvent(e); } catch { /* a UI handler must never break the flow */ } };
      let resolve!: (r: SignInResult) => void;
      const done = new Promise<SignInResult>((r) => (resolve = r));
      const finish = (r: SignInResult) => { if (finished) return; finished = true; active = false; clearTimeout(timer); if (r.ok) { try { d.onSignedIn?.(); } catch { /* ignore */ } } resolve(r); };
      // The program is started as the leader of its own process group, so a stop reaches any helper it started too (a shell script, a browser opener).
      const signal = (sig: NodeJS.Signals) => { if (!child?.pid) return; try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* already gone */ } } };
      const kill = () => { if (!child || child.exitCode !== null || child.signalCode !== null) return; signal("SIGTERM"); const t = setTimeout(() => { if (child && child.exitCode === null && child.signalCode === null) signal("SIGKILL"); }, KILL_GRACE_MS); t.unref(); };
      const timer = setTimeout(() => { timedOut = true; kill(); }, d.timeoutMs ?? 300_000);
      emit({ type: "starting" });
      try {
        child = (d.spawnFn ?? nodeSpawn)(d.binary, ["auth", "login", "--claudeai"], { env: d.env, stdio: ["pipe", "pipe", "ignore"], detached: true }); // stderr is never read
      } catch { finish({ ok: false, reason: "not_runnable" }); return { done, cancel() {}, submitCode: () => false }; }
      child.stdin?.on("error", () => undefined);
      child.on("error", () => finish({ ok: false, reason: "not_runnable" }));
      child.stdout?.on("data", (chunk: Buffer) => {
        buf = (buf + chunk.toString("utf8")).slice(-MAX_BUFFER);
        if (!linkSent) {
          const m = buf.match(/https?:\/\/[^\s"'<>\\]+(?=\s)/); // a link counts only once it is COMPLETE (followed by a space or line break): a link cut off at a chunk boundary must not be offered
          if (m) { const ok = allowedLink(m[0]); if (ok) { linkSent = true; emit({ type: "link", url: ok }); emit({ type: "waiting_for_browser" }); } else { if (!blockedSent) { blockedSent = true; emit({ type: "link_blocked" }); } buf = buf.replace(m[0], ""); } }
        }
        if (!codeAsked && /paste code here/i.test(buf)) { codeAsked = true; emit({ type: "code_requested" }); }
      });
      // "exit", not "close": a helper process that keeps the output open must not hold the result back.
      child.on("exit", async (code) => {
        if (finished) return;
        child?.stdout?.destroy(); child?.stdin?.destroy();
        if (cancelled) return finish({ ok: false, reason: "cancelled" });
        if (timedOut) return finish({ ok: false, reason: "timeout" });
        if (code !== 0) return finish({ ok: false, reason: "failed" });
        emit({ type: "confirming" });
        const s = await d.confirm().catch(() => null);
        finish(s && s.ok && s.status.loggedIn ? { ok: true } : { ok: false, reason: "not_confirmed" });
      });
      return {
        done,
        cancel() { if (finished) return; cancelled = true; kill(); },
        submitCode(code: string) { // the fallback: the code the browser page shows. Never logged, never kept.
          if (finished || !child?.stdin?.writable || typeof code !== "string") return false;
          const c = code.trim();
          if (!c || c.length > 2000 || /[\r\n\0]/.test(c)) return false;
          child.stdin.write(c + "\n"); return true;
        },
      };
    },
  };
}
