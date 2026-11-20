// The free login status check (phase 3c). `claude auth status` makes no model call. Its JSON also carries the user's e-mail address, organisation and settings-folder
// path: the parser keeps ONLY what the app needs and drops everything else at once, so account details can never be stored, logged or shown by accident.
import { spawn } from "node:child_process";

export type LoginStatus = { loggedIn: boolean; method: string | null; plan: string | null; expiresAt: string | null };
export type StatusResult = { ok: true; status: LoginStatus } | { ok: false; reason: "not_runnable" | "timeout" | "unreadable" };
export type RunResult = { code: number | null; stdout: string; timedOut: boolean; failedToStart: boolean };
export type StatusRunner = (args: string[], env: Record<string, string>) => Promise<RunResult>;

export function parseStatus(stdout: string): LoginStatus | null {
  let j: any;
  try { j = JSON.parse(stdout); } catch { return null; }
  if (!j || typeof j !== "object" || typeof j.loggedIn !== "boolean") return null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const exp = str(j.loginExpiresAt), ms = exp ? Date.parse(exp) : NaN;
  return { loggedIn: j.loggedIn, method: str(j.authMethod) === "none" ? null : str(j.authMethod), plan: str(j.subscriptionType) ?? str(j.planTier), expiresAt: Number.isFinite(ms) ? new Date(ms).toISOString() : null };
}

export async function checkLoginStatus(run: StatusRunner, env: Record<string, string>): Promise<StatusResult> {
  const r = await run(["auth", "status", "--json"], env).catch(() => ({ code: null, stdout: "", timedOut: false, failedToStart: true }) as RunResult);
  if (r.failedToStart) return { ok: false, reason: "not_runnable" };
  if (r.timedOut) return { ok: false, reason: "timeout" };
  const s = parseStatus(r.stdout);
  return s ? { ok: true, status: s } : { ok: false, reason: "unreadable" };
}

// Runs the bundled Claude program (a file path) with a timeout and an output cap. No shell, no inherited environment.
export function spawnRunner(binary: string, o: { timeoutMs?: number; maxBytes?: number } = {}): StatusRunner {
  const timeoutMs = o.timeoutMs ?? 10_000, maxBytes = o.maxBytes ?? 200_000;
  return (args, env) => new Promise<RunResult>((resolve) => {
    let out = "", done = false, timedOut = false;
    const finish = (r: Omit<RunResult, "timedOut" | "stdout"> & { stdout?: string }) => { if (!done) { done = true; clearTimeout(timer); resolve({ stdout: out, timedOut, ...r }); } };
    let child: ReturnType<typeof spawn>;
    try { child = spawn(binary, args, { env, stdio: ["ignore", "pipe", "ignore"] }); } catch { return resolve({ code: null, stdout: "", timedOut: false, failedToStart: true }); }
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); finish({ code: null, failedToStart: false }); }, timeoutMs);
    child.stdout!.on("data", (d: Buffer) => { out += d.toString("utf8"); if (out.length > maxBytes) { out = out.slice(0, maxBytes); child.kill("SIGKILL"); } });
    child.on("error", () => finish({ code: null, failedToStart: true }));
    child.on("close", (code) => finish({ code, failedToStart: false }));
  });
}
