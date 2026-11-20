// A pretend OpenAI service on 127.0.0.1 for tests (never the real one). Written from OpenAI's published docs (Responses streaming, Sign in with ChatGPT), so it can only be as right as
// those docs; the first real run is what proves it (see docs/OPENAI-BUILD-ISSUES.md). Each test gives it a handler for POST /v1/responses.
import http from "node:http";
import type { AddressInfo } from "node:net";

export type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: any; raw: string };
export type Reply = (req: Seen, res: http.ServerResponse) => void | Promise<void>;
export async function startFakeOpenAI(routes: Record<string, Reply>) {
  const seen: Seen[] = [], sockets = new Set<import("node:net").Socket>();
  const server = http.createServer((req, res) => {
    let raw = ""; req.on("data", (c) => (raw += c)); req.on("end", async () => {
      let body: any = raw; try { body = JSON.parse(raw); } catch { /* form bodies stay text */ }
      const s: Seen = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body, raw }; seen.push(s);
      const h = routes[`${s.method} ${s.url.split("?")[0]}`];
      if (!h) { res.statusCode = 404; res.end(JSON.stringify({ error: { code: "route_not_found", message: "no such route" } })); return; }
      try { await h(s, res); } catch (e) { res.statusCode = 500; res.end(String(e)); }
    });
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, port, seen, close: () => new Promise<void>((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }) };
}

// ---- reply helpers ----
export const sse = (res: http.ServerResponse, events: object[], o: { split?: boolean; keepOpen?: boolean } = {}) => {
  res.statusCode = 200; res.setHeader("Content-Type", "text/event-stream");
  const text = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  if (o.split) { for (let i = 0; i < text.length; i += 7) res.write(text.slice(i, i + 7)); } else res.write(text);
  if (!o.keepOpen) res.end();
};
export const completed = (answer: unknown, usage: object = { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 200, cache_write_tokens: 0 } }, model = "gpt-6.2-sol") => [
  { type: "response.created", response: { id: "resp_1", status: "in_progress" } },
  { type: "response.output_text.delta", delta: JSON.stringify(answer).slice(0, 5) },
  { type: "response.completed", response: { id: "resp_1", status: "completed", model, error: null, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: JSON.stringify(answer) }] }], usage } },
];
export const httpError = (res: http.ServerResponse, status: number, body: object | string, headers: Record<string, string> = {}) => {
  res.statusCode = status; res.setHeader("Content-Type", "application/json"); for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};
