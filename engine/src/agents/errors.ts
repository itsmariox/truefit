// What went wrong in a Claude call, in terms the pipeline understands (phase 1 step 7a). Exit codes keep the old AgentRunner contract
// (0 ok, 2 setup, 3 login, 4 limit) and add the new cases. The SDK names its error types (authentication_failed, rate_limit, ...); a message
// pattern is only the fallback.
import { classifyError } from "../checks.ts";

export const EXIT = { ok: 0, other: 1, setup: 2, auth: 3, rate_limit: 4, unavailable: 5, account: 6, isolation: 7, timeout: 8, cap: 9 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
// Pausable: the job should pause with its finished steps kept, and offer Resume (PRD 10). The others fail or need a fix first.
export const PAUSABLE: ExitCode[] = [EXIT.auth, EXIT.rate_limit, EXIT.unavailable, EXIT.account, EXIT.timeout, EXIT.cap]; // cap: the user's own monthly spend cap (API-key mode) was reached: pause, raise the cap or wait for next month, Resume

const BY_TYPE: Record<string, ExitCode> = {
  authentication_failed: EXIT.auth, oauth_org_not_allowed: EXIT.auth, verification_required: EXIT.auth,
  account_on_hold: EXIT.account, billing_error: EXIT.account,
  rate_limit: EXIT.rate_limit, overloaded: EXIT.unavailable, server_error: EXIT.unavailable,
  model_not_found: EXIT.setup, cloud_credential_error: EXIT.setup, invalid_request: EXIT.other, max_output_tokens: EXIT.other, unknown: EXIT.other,
};
export function exitCodeFor(sdkErrorType: string | undefined, message: string): ExitCode {
  if (sdkErrorType && BY_TYPE[sdkErrorType] !== undefined) return BY_TYPE[sdkErrorType];
  const c = classifyError(message);
  if (c === "auth") return EXIT.auth;
  if (c === "rate_limit") return EXIT.rate_limit;
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|network|socket hang up|offline/i.test(message)) return EXIT.unavailable;
  return EXIT.other;
}
