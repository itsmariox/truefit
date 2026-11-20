// A pretend OpenAI (sign-in service + Responses API) on localhost for tests of the whole app core. Same documented behaviour as the one inside openai-signin.test.ts: discovery, JWKS, the
// authorize redirect, the token endpoint (code exchange and refresh), revocation, and POST /v1/responses answering with a canned analysis. Never the real service.
import crypto from "node:crypto";
import { startFakeOpenAI, sse, completed, httpError } from "./openai-fake-server.ts";

const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (payload: object) => { const data = `${b64({ alg: "RS256", typ: "JWT", kid: "k1" })}.${b64(payload)}`; return `${data}.${crypto.sign("sha256", Buffer.from(data), rsa.privateKey).toString("base64url")}`; };
export const PLAN = "chatgpt.tokens.use.direct";

export async function startFakeOpenAIWorld(o: { analysis: object; apiFail?: () => { status: number; body: object } | null } = { analysis: {} }) {
  let url = "", issued = 0; const authorize: URLSearchParams[] = [], tokens: URLSearchParams[] = [], revokes: URLSearchParams[] = [], bearers: (string | undefined)[] = [], gateModels: string[] = [], otherModels: string[] = []; let pending: { redirect: string; nonce: string; challenge: string } | null = null;
  const srv = await startFakeOpenAI({
    "GET /.well-known/openid-configuration": (_r, res) => httpError(res, 200, { issuer: url, jwks_uri: `${url}/jwks`, revocation_endpoint: `${url}/revoke`, token_endpoint: `${url}/api/accounts/oauth/token`, authorization_endpoint: `${url}/api/accounts/authorize` }),
    "GET /jwks": (_r, res) => httpError(res, 200, { keys: [{ ...(rsa.publicKey.export({ format: "jwk" }) as object), kid: "k1", use: "sig", alg: "RS256" }] }),
    "GET /api/accounts/authorize": (r, res) => { const q = new URL(r.url, url).searchParams; authorize.push(q); pending = { redirect: q.get("redirect_uri")!, nonce: q.get("nonce")!, challenge: q.get("code_challenge")! };
      const back = new URL(pending.redirect); back.searchParams.set("code", "CODE-1"); back.searchParams.set("state", q.get("state")!); back.searchParams.set("client_id", q.get("client_id") === "dynamic_agent_client" ? `oaiapp_${++issued}` : q.get("client_id")!);
      res.statusCode = 302; res.setHeader("Location", back.toString()); res.end(); },
    "POST /api/accounts/oauth/token": (r, res) => { const f = new URLSearchParams(r.raw); tokens.push(f);
      if (f.get("grant_type") === "refresh_token") return httpError(res, 200, { access_token: "ACCESS-REFRESHED", refresh_token: "REFRESH-2", expires_in: 3600, scope: `${PLAN} openid offline_access` });
      const now = Math.floor(Date.now() / 1000), p = pending!;
      if (crypto.createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url") !== p.challenge) return httpError(res, 400, { error: { code: "invalid_grant" } });
      httpError(res, 200, { access_token: "ACCESS-NEW", refresh_token: "REFRESH-1", id_token: sign({ iss: url, aud: f.get("client_id"), sub: "subject-A", exp: now + 3600, iat: now, nonce: p.nonce }), token_type: "Bearer", expires_in: 3600, scope: `${PLAN} email offline_access openid profile resource.invoke` }); },
    "POST /revoke": (r, res) => { revokes.push(new URLSearchParams(r.raw)); httpError(res, 200, ""); },
    "POST /v1/responses": (r, res) => { bearers.push(r.headers.authorization); const f = o.apiFail?.(); if (f) return httpError(res, f.status, f.body);
      const gate = /# Job ad check/.test(r.body.instructions); (gate ? gateModels : otherModels).push(r.body.model);
      const isAd = /\b(role|job|position|vacancy|responsibilit\w*|requirements?|experience|salary|apply|candidate)\b/i.test(String(r.body.input?.[0]?.content ?? "")); // the pretend gate reads the words, like a careful person
      sse(res, completed(gate ? { is_job_ad: isAd, confidence: "high", kind: isAd ? "job_ad" : "question_or_chat", reason: "pretend" } : /Fit analysis/.test(r.body.instructions) ? o.analysis : { message: "ok" }, { input_tokens: 1500, output_tokens: 200, input_tokens_details: { cached_tokens: 0 } })); },
  });
  url = srv.url;
  return { srv, url, authorize, tokens, revokes, bearers, gateModels, otherModels, close: () => srv.close() };
}
