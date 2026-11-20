// "Connect ChatGPT" (phase 4 of the OpenAI option): the sign-in flow that lets the user's ChatGPT plan pay for Truefit's requests. Written from OpenAI's published Sign in with ChatGPT
// docs (https://developers.openai.com/siwc/token-sharing-open-source/sign-in and .../profiles-and-sessions, read 2026-11-19); never run against the real service.
// What it does: starts a listener on 127.0.0.1, opens the system browser at OpenAI's authorize page (OAuth code flow with PKCE S256, a fresh state and nonce), takes the one callback,
// exchanges the code, VERIFIES the ID token (signature against OpenAI's published keys, issuer, audience, expiry, nonce), checks that the plan permission was granted, and only then
// saves the record. Nothing it handles (code, tokens, the link with its hints) is ever logged, and the link shown to the user never carries the retained ID token.
import http from "node:http";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import { SECRET_NAMES, type SecretStore } from "../store/secrets.ts";
import { OPENAI_AUTH_BASE, OPENAI_RESOURCE, PLAN_SCOPE, tokenEndpoint, type PlanRecord, type PlanStore, type Registration } from "./openai-plan.ts";

export type OpenAISignInEvent = { type: "starting" } | { type: "link"; url: string } | { type: "waiting_for_browser" } | { type: "confirming" };
export type OpenAISignInResult =
  | { ok: true }
  | { ok: false; reason: "cancelled" | "timeout" | "failed" | "denied" | "plan_not_enabled" | "registration_incomplete" | "invalid_identity" | "not_runnable" | "already_running" };
export type OpenAISignInHandle = { done: Promise<OpenAISignInResult>; cancel(): void };

const b64url = (b: Buffer) => b.toString("base64url");
const SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const CALLBACK_PATH = "/auth/callback", DEFAULT_PORT = 1455;
const PAGE = (msg: string) => `<!doctype html><meta charset="utf-8"><title>Truefit</title><body style="font:16px system-ui;margin:3rem"><p>${msg}</p>`; // no script, no remote content

// Links the app may open in the user's browser on the OpenAI side: the sign-in host and ChatGPT's own pages (for example Settings > Usage). Same rules as the Claude allow-list: https only,
// no port, no user name, and the host is read from the PARSED link ("https://chatgpt.com@evil.example" is refused).
const OPENAI_LINK_HOSTS = ["chatgpt.com", "openai.com"];
export function allowedOpenAILink(raw: string): string | null {
  let u: URL; try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const h = u.hostname.toLowerCase();
  return OPENAI_LINK_HOSTS.some((a) => h === a || h.endsWith("." + a)) ? u.toString() : null;
}

// ---- the ID token ----
export type Jwks = { keys: (Record<string, unknown> & { kid?: string; kty?: string })[] };
export type IdClaims = { sub: string; iss: string; aud: string | string[]; exp: number; nonce?: string };
export function verifyIdToken(jwt: string, jwks: Jwks, expect: { issuer: string; audience: string; nonce: string; now: Date; skewSec?: number }): { ok: true; claims: IdClaims } | { ok: false; why: string } {
  const parts = jwt.split("."); if (parts.length !== 3) return { ok: false, why: "not a JWT" };
  let header: any, claims: any; try { header = JSON.parse(Buffer.from(parts[0], "base64url").toString()); claims = JSON.parse(Buffer.from(parts[1], "base64url").toString()); } catch { return { ok: false, why: "unreadable" }; }
  if (header?.alg !== "RS256" && header?.alg !== "ES256") return { ok: false, why: `signature algorithm "${String(header?.alg)}" is not accepted` }; // never "none", never HS*
  const cands = jwks.keys.filter((k) => (header.kid ? k.kid === header.kid : true) && (header.alg === "RS256" ? k.kty === "RSA" : k.kty === "EC"));
  if (cands.length !== 1) return { ok: false, why: "no single matching signing key" };
  let okSig = false;
  try {
    const key = crypto.createPublicKey({ key: cands[0] as never, format: "jwk" }), data = Buffer.from(`${parts[0]}.${parts[1]}`), sig = Buffer.from(parts[2], "base64url");
    okSig = header.alg === "RS256" ? crypto.verify("sha256", data, key, sig) : crypto.verify("sha256", data, { key, dsaEncoding: "ieee-p1363" }, sig);
  } catch { okSig = false; }
  if (!okSig) return { ok: false, why: "bad signature" };
  const skew = (expect.skewSec ?? 60) * 1000, nowMs = expect.now.getTime();
  if (claims.iss !== expect.issuer) return { ok: false, why: "wrong issuer" };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]; if (!aud.includes(expect.audience)) return { ok: false, why: "wrong audience" };
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 + skew < nowMs) return { ok: false, why: "expired" };
  if (typeof claims.nbf === "number" && claims.nbf * 1000 - skew > nowMs) return { ok: false, why: "not valid yet" };
  if (typeof claims.nonce !== "string" || !safeEqual(claims.nonce, expect.nonce)) return { ok: false, why: "wrong nonce" };
  if (typeof claims.sub !== "string" || !claims.sub) return { ok: false, why: "no subject" };
  return { ok: true, claims: claims as IdClaims };
}
const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export type OpenAISignInDeps = {
  store: PlanStore; secrets: SecretStore; appName: string;
  openUrl: (url: string) => Promise<void>;          // the app passes a function that opens ONLY addresses on the OpenAI sign-in host in the system browser
  fetch?: typeof fetch; authBase?: string; now?: () => Date; timeoutMs?: number; preferredPort?: number; onSignedIn?: () => void;
};

export function createOpenAISignIn(d: OpenAISignInDeps) {
  const doFetch = d.fetch ?? fetch, base = d.authBase ?? OPENAI_AUTH_BASE, now = () => d.now?.() ?? new Date();
  let active = false;
  const discovery = async () => {
    const r = await doFetch(`${base}/.well-known/openid-configuration`, { headers: { Accept: "application/json" } }); if (!r.ok) throw new Error("discovery failed");
    const j: any = await r.json(); if (j?.issuer !== base || typeof j?.jwks_uri !== "string") throw new Error("unexpected sign-in service"); // the issuer must be exactly the sign-in host we meant to talk to
    return { issuer: String(j.issuer), jwksUri: String(j.jwks_uri), revocation: typeof j.revocation_endpoint === "string" ? String(j.revocation_endpoint) : null };
  };
  // A host id: opaque, stable for this Mac, NOT a credential and NOT user-identifying. Kept as a secret so it is never exported or put in a backup that could be restored on another Mac.
  async function hostId(): Promise<string> { const have = await d.secrets.get(SECRET_NAMES.openaiHostId); if (have) return have; const id = `urn:uuid:${crypto.randomUUID()}`; await d.secrets.set(SECRET_NAMES.openaiHostId, id); return id; }

  return {
    isActive: () => active,
    start(onEvent: (e: OpenAISignInEvent) => void = () => undefined): OpenAISignInHandle {
      if (active) return { done: Promise.resolve({ ok: false, reason: "already_running" }), cancel() {} };
      active = true;
      const emit = (e: OpenAISignInEvent) => { try { onEvent(e); } catch { /* a UI handler must never break the flow */ } };
      let server: http.Server | null = null, finished = false, cancelled = false, timedOut = false, wake: (() => void) | null = null;
      let resolve!: (r: OpenAISignInResult) => void; const done = new Promise<OpenAISignInResult>((r) => (resolve = r));
      const timer = setTimeout(() => { timedOut = true; wake?.(); }, d.timeoutMs ?? 300_000);
      const finish = (r: OpenAISignInResult) => { if (finished) return; finished = true; active = false; clearTimeout(timer); try { server?.closeAllConnections?.(); server?.close(); } catch { /* ignore */ } if (r.ok) { try { d.onSignedIn?.(); } catch { /* ignore */ } } resolve(r); };
      void (async () => {
        try {
          emit({ type: "starting" });
          // `existing` = tokens saved; `reg` = the registration OpenAI made for this Mac (kept after a sign-out or a dead token). An unreadable record is never overwritten behind the user's back.
          let existing: PlanRecord | null = null, reg: Registration | null = null; try { existing = await d.store.get(); reg = await d.store.getRegistration(); } catch { return finish({ ok: false, reason: "failed" }); }
          const savedClient = existing?.clientId ?? reg?.clientId ?? null, savedSubject = existing?.subject ?? reg?.subject ?? null;
          const host = await hostId(), disc = await discovery();
          const state = b64url(crypto.randomBytes(24)), nonce = b64url(crypto.randomBytes(24)), verifier = b64url(crypto.randomBytes(48)), challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
          type Cb = { code?: string; error?: string; clientId?: string };
          let gotCb: ((c: Cb | null) => void) | null = null; const cbPromise = new Promise<Cb | null>((r) => (gotCb = r));
          let port = 0;
          server = http.createServer((req, res) => {
            const u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
            if (req.method !== "GET" || u.pathname !== CALLBACK_PATH || req.headers.host !== `127.0.0.1:${port}`) { res.statusCode = 404; res.end(); return; } // only OUR callback, only by its exact address (a rebinding page cannot use it)
            const q = u.searchParams, st = q.get("state") ?? "";
            if (!safeEqual(st, state)) { res.statusCode = 400; res.setHeader("Content-Type", "text/html"); res.end(PAGE("This sign-in link is not valid. Go back to Truefit and try again.")); return; } // a stray or forged request does not end the attempt
            res.statusCode = 200; res.setHeader("Content-Type", "text/html"); res.setHeader("Cache-Control", "no-store"); res.end(PAGE(q.get("error") ? "Sign-in was not completed. You can close this window and return to Truefit." : "Done. You can close this window and return to Truefit."));
            gotCb?.({ code: q.get("code") ?? undefined, error: q.get("error") ?? undefined, clientId: q.get("client_id") ?? undefined }); gotCb = null;
          });
          const listen = (p: number) => new Promise<void>((ok, bad) => { server!.once("error", bad); server!.listen(p, "127.0.0.1", () => { server!.off("error", bad); ok(); }); });
          try { await listen(d.preferredPort ?? DEFAULT_PORT); } catch { await listen(0); } // OpenAI's example port first, any free port otherwise (only the port may vary)
          port = (server.address() as AddressInfo).port;
          const redirect = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
          const q = new URLSearchParams({ response_type: "code", client_id: savedClient ?? "dynamic_agent_client", redirect_uri: redirect, scope: SCOPES, resource: OPENAI_RESOURCE, state, nonce, code_challenge_method: "S256", code_challenge: challenge, ext_agent_host_id: host });
          if (!savedClient) q.set("agent_name_hint", d.appName); // only on first registration
          const plain = `${base}/api/accounts/authorize?${q}`;                       // the link we SHOW: never carries the retained ID token
          if (existing) q.set("id_token_hint", existing.idToken); // only while tokens are kept: OpenAI says to omit it after signing out
          const full = `${base}/api/accounts/authorize?${q}`;
          emit({ type: "link", url: plain });
          try { await d.openUrl(full); } catch { /* the link above still works by hand */ }
          emit({ type: "waiting_for_browser" });
          const cb = await Promise.race([cbPromise, new Promise<null>((r) => { wake = () => r(null); if (cancelled || timedOut) r(null); })]);
          if (cancelled) return finish({ ok: false, reason: "cancelled" });
          if (!cb) return finish({ ok: false, reason: timedOut ? "timeout" : "cancelled" });
          if (cb.error) return finish({ ok: false, reason: cb.error === "access_denied" ? "denied" : "failed" });
          if (!cb.code) return finish({ ok: false, reason: "failed" });
          let clientId: string;
          if (savedClient) { if (cb.clientId && cb.clientId !== savedClient) return finish({ ok: false, reason: "failed" }); clientId = savedClient; } // a different client id is rejected, never swapped in
          else { if (!cb.clientId || cb.clientId === "dynamic_agent_client") return finish({ ok: false, reason: "registration_incomplete" }); clientId = cb.clientId; }
          emit({ type: "confirming" });
          const tr = await doFetch(tokenEndpoint(base), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code: cb.code, code_verifier: verifier, redirect_uri: redirect, resource: OPENAI_RESOURCE }).toString() });
          const tj: any = await tr.json().catch(() => null);
          if (!tr.ok || !tj?.access_token || !tj?.refresh_token || !tj?.id_token || !Number.isFinite(Number(tj?.expires_in))) return finish({ ok: false, reason: "failed" });
          const jr = await doFetch(disc.jwksUri, { headers: { Accept: "application/json" } }); const jwks = (await jr.json().catch(() => null)) as Jwks | null;
          if (!jr.ok || !Array.isArray(jwks?.keys)) return finish({ ok: false, reason: "failed" });
          const v = verifyIdToken(String(tj.id_token), jwks!, { issuer: disc.issuer, audience: clientId, nonce, now: now() });
          if (!v.ok) return finish({ ok: false, reason: "invalid_identity" });
          if (savedSubject && savedSubject !== v.claims.sub) return finish({ ok: false, reason: "invalid_identity" }); // the same ChatGPT account only (use "a different account" to start over): a client id is never paired with another account's tokens
          const scopes = String(tj.scope ?? "").split(/\s+/).filter(Boolean);
          await d.store.set({ version: 1, issuer: disc.issuer, clientId, subject: v.claims.sub, idToken: String(tj.id_token), accessToken: String(tj.access_token), refreshToken: String(tj.refresh_token), scopes, expiresAt: new Date(now().getTime() + Number(tj.expires_in) * 1000).toISOString(), savedAt: now().toISOString() });
          finish(scopes.includes(PLAN_SCOPE) ? { ok: true } : { ok: false, reason: "plan_not_enabled" }); // kept signed in, but the plan is not usable until the user allows it
        } catch { finish({ ok: false, reason: cancelled ? "cancelled" : "not_runnable" }); }
      })();
      return { done, cancel() { if (finished) return; cancelled = true; wake?.(); if (!wake) setTimeout(() => finish({ ok: false, reason: "cancelled" }), 0); } };
    },
    // Sign out: end the renewable session at OpenAI (best effort), then ALWAYS clear the saved tokens. The registration is KEPT (OpenAI: signing out does not create a new client), so the next
    // connect reuses it. `forget: true` ("use a different ChatGPT account") removes the registration too. `revoked` is false when OpenAI could not be told; `hadSession` says there was something to end.
    async signOut(o: { forget?: boolean } = {}): Promise<{ cleared: boolean; revoked: boolean; hadSession: boolean }> {
      let rec: PlanRecord | null = null; try { rec = await d.store.get(); } catch { /* unreadable: just clear */ }
      let revoked = false;
      if (rec) { try { const disc = await discovery(); if (disc.revocation) { const r = await doFetch(disc.revocation, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: rec.refreshToken, token_type_hint: "refresh_token", client_id: rec.clientId }).toString() }); revoked = r.status === 200; } } catch { revoked = false; } }
      const cleared = await (o.forget ? d.store.forget() : d.store.clear()).catch(() => false);
      return { cleared, revoked, hadSession: !!rec };
    },
  };
}
