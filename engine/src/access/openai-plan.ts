// The ChatGPT-plan sign-in record and its access token (phase 3 of the OpenAI option). One record, kept ONLY in the secret store (encrypted, key in the Keychain), never in the database,
// a backup, an export or a log. It holds what OpenAI's docs say to keep (https://developers.openai.com/siwc/token-sharing-open-source/sign-in, read 2026-11-19): the issued client id,
// the verified account subject, the ID, access and refresh tokens, the granted scopes and the expiry. The e-mail address is NOT kept as a field (the app never shows or uses it).
//
// Refresh: access tokens last one hour, the refresh token ROTATES (each refresh returns a replacement and the old one stops working; a reused one is `refresh_token_reused`). With
// several jobs running at once, two refreshes would race and lose the account, so every refresh goes through ONE shared promise, and the new record is written (atomically, by the
// store) before any caller gets the new token.
import { SECRET_NAMES, type SecretStore } from "../store/secrets.ts";
import { OpenAIAuthError } from "../agents/openai-provider.ts";

export const PLAN_SCOPE = "chatgpt.tokens.use.direct";
export const OPENAI_RESOURCE = "https://api.openai.com/v1";
export const OPENAI_AUTH_BASE = "https://auth.openai.com";
export const tokenEndpoint = (authBase: string) => `${authBase}/api/accounts/oauth/token`;

export type PlanRecord = {
  version: 1; issuer: string; clientId: string; subject: string; idToken: string; accessToken: string; refreshToken: string;
  scopes: string[]; expiresAt: string; savedAt: string;              // expiresAt: ISO time the access token stops working
};
const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
export function parsePlanRecord(text: string | null): PlanRecord | null {
  if (!text) return null;
  let j: any; try { j = JSON.parse(text); } catch { return null; }
  if (!j || j.version !== 1 || !str(j.clientId) || !str(j.subject) || !str(j.accessToken) || !str(j.refreshToken) || !str(j.idToken) || !str(j.issuer) || !Array.isArray(j.scopes) || !Number.isFinite(Date.parse(j.expiresAt))) return null;
  return { version: 1, issuer: j.issuer, clientId: j.clientId, subject: j.subject, idToken: j.idToken, accessToken: j.accessToken, refreshToken: j.refreshToken, scopes: j.scopes.filter((s: unknown) => typeof s === "string"), expiresAt: new Date(j.expiresAt).toISOString(), savedAt: str(j.savedAt) ?? new Date(0).toISOString() };
}
export const planEnabled = (r: PlanRecord) => r.scopes.includes(PLAN_SCOPE);

// The REGISTRATION is what OpenAI created when this Mac first connected: the issued client id and which ChatGPT account it belongs to. OpenAI says to KEEP it when the user signs out or a
// refresh token dies ("Signing out ... does not create a new client"; "repeat OAuth with the saved issued client ID"), so it is stored apart from the tokens: signing out and a dead token
// remove the tokens only. Only "Use a different ChatGPT account" and "Delete everything" remove it.
export type Registration = { issuer: string; clientId: string; subject: string };
export function parseRegistration(text: string | null): Registration | null {
  if (!text) return null; let j: any; try { j = JSON.parse(text); } catch { return null; }
  return str(j?.issuer) && str(j?.clientId) && str(j?.subject) ? { issuer: j.issuer, clientId: j.clientId, subject: j.subject } : null;
}
export function createPlanStore(secrets: SecretStore) {
  return {
    // null = no tokens saved. THROWS when a saved record cannot be read (a Keychain that will not open is not "signed out").
    async get(): Promise<PlanRecord | null> { const t = await secrets.get(SECRET_NAMES.openaiPlan); if (t === null) return null; const r = parsePlanRecord(t); if (!r) throw new Error("the saved ChatGPT sign-in could not be read"); return r; },
    async set(r: PlanRecord): Promise<void> { await secrets.set(SECRET_NAMES.openaiRegistration, JSON.stringify({ issuer: r.issuer, clientId: r.clientId, subject: r.subject })); await secrets.set(SECRET_NAMES.openaiPlan, JSON.stringify(r)); },
    // Removes the TOKENS only. The registration stays, so the next connect reuses the same client instead of registering a new app on the user's account.
    async clear(): Promise<boolean> { return secrets.delete(SECRET_NAMES.openaiPlan); },
    async getRegistration(): Promise<Registration | null> { const t = await secrets.get(SECRET_NAMES.openaiRegistration); if (t === null) return null; const r = parseRegistration(t); if (!r) throw new Error("the saved ChatGPT registration could not be read"); return r; },
    // "Use a different ChatGPT account": tokens AND registration.
    async forget(): Promise<boolean> { const a = await secrets.delete(SECRET_NAMES.openaiPlan), b = await secrets.delete(SECRET_NAMES.openaiRegistration); return a || b; },
  };
}
export type PlanStore = ReturnType<typeof createPlanStore>;

// Errors that mean the refresh token can never work again: sign in again (OpenAI: "Clear unusable tokens and repeat OAuth").
const DEAD = new Set(["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"]);
export type PlanAuthDeps = { store: PlanStore; fetch?: typeof fetch; now?: () => Date; authBase?: string; skewMs?: number; onSignedOut?: () => void };

export function createPlanAuth(d: PlanAuthDeps) {
  const doFetch = d.fetch ?? fetch, now = () => d.now?.() ?? new Date(), base = d.authBase ?? OPENAI_AUTH_BASE, skew = d.skewMs ?? 120_000;
  let inflight: Promise<PlanRecord> | null = null;
  const stale = (r: PlanRecord) => Date.parse(r.expiresAt) - now().getTime() <= skew;

  async function refresh(r: PlanRecord): Promise<PlanRecord> {
    const body = new URLSearchParams({ grant_type: "refresh_token", client_id: r.clientId, refresh_token: r.refreshToken, resource: OPENAI_RESOURCE }); // no `scope`: the grant is kept as it is
    let res: Response;
    try { res = await doFetch(tokenEndpoint(base), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: body.toString() }); }
    catch { throw new Error("could not reach the sign-in service to renew the ChatGPT sign-in"); } // a network failure: NOT a reason to erase anything (a plain error, so the runner pauses as "unavailable")
    let j: any = null; try { j = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      const code = String(j?.error?.code ?? j?.error ?? "");
      if (DEAD.has(code) || ((res.status === 400 || res.status === 401) && !code)) { await d.store.clear().catch(() => undefined); d.onSignedOut?.(); throw new OpenAIAuthError("your ChatGPT sign-in has ended: connect ChatGPT again"); }
      if (code === "invalid_client") throw new OpenAIAuthError("the ChatGPT sign-in is no longer accepted for this app: connect ChatGPT again");
      throw new Error(`the sign-in service could not renew the ChatGPT sign-in (HTTP ${res.status})`); // 5xx and the like: keep the record, try again later
    }
    const access = str(j?.access_token), refreshTok = str(j?.refresh_token), expiresIn = Number(j?.expires_in);
    if (!access || !refreshTok || !Number.isFinite(expiresIn) || expiresIn <= 0) throw new OpenAIAuthError("the sign-in service sent an unreadable renewal: connect ChatGPT again");
    const scopes = typeof j.scope === "string" ? j.scope.split(/\s+/).filter(Boolean) : r.scopes;
    const next: PlanRecord = { ...r, accessToken: access, refreshToken: refreshTok, idToken: str(j.id_token) ?? r.idToken, scopes, expiresAt: new Date(now().getTime() + expiresIn * 1000).toISOString(), savedAt: now().toISOString() };
    // If the user signed out or connected again while this refresh was in flight, the record is no longer the one we started from: never overwrite it with an older session's tokens.
    const cur = await d.store.get().catch(() => null);
    if (!cur || cur.refreshToken !== r.refreshToken) { if (cur) return cur; throw new OpenAIAuthError("ChatGPT was disconnected: connect ChatGPT again"); }
    await d.store.set(next); // the replacement refresh token is saved BEFORE anyone is handed the new access token
    return next;
  }
  return {
    // The access token to use for one call. Reads the record every time (a sign-in or a sign-out elsewhere in the app is seen at once).
    async getAccessToken(): Promise<string> {
      let r: PlanRecord | null;
      try { r = await d.store.get(); } catch { throw new OpenAIAuthError("the saved ChatGPT sign-in could not be read"); }
      if (!r) throw new OpenAIAuthError("ChatGPT is not connected");
      if (!planEnabled(r)) throw new OpenAIAuthError("ChatGPT plan use is not enabled for this app: connect ChatGPT again and allow it");
      if (!stale(r)) return r.accessToken;
      if (!inflight) inflight = (async () => { try { const cur = await d.store.get().catch(() => null) ?? r!; return stale(cur) ? await refresh(cur) : cur; } finally { inflight = null; } })(); // re-read inside the lock: another call may have renewed it
      return (await inflight).accessToken;
    },
  };
}

// What the access service needs to know about the ChatGPT sign-in, in the same shape as the Claude login status check (no model call, no network).
import type { StatusResult } from "./status.ts";
export async function planStatus(store: PlanStore): Promise<StatusResult> {
  let r: PlanRecord | null; try { r = await store.get(); } catch { return { ok: false, reason: "unreadable" }; }
  // Signed in but plan use not allowed counts as NOT connected: nothing can be sent until the user connects again and allows it. The renewable token means there is no "expires soon" to show.
  return { ok: true, status: { loggedIn: !!r && planEnabled(r), method: r ? "chatgpt" : null, plan: null, expiresAt: null } };
}
