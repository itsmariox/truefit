// Fetches a job link the user sends and extracts the ad text. Plain code on the Mac, no AI (SPEC 2.7).
// Safety: http/https only; the host must resolve to a public address (no localhost, no home network, no cloud
// metadata); every redirect is checked the same way; size, time and type limits; no cookies, no login.
import { lookup as dnsLookup } from "node:dns";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { isIP } from "node:net";

const MAX_BYTES = 3_000_000, MAX_REDIRECTS = 4, TIMEOUT_MS = 15_000;

// Expands an IPv6 text address to its 8 groups (numbers), or null when it is not valid. Handles "::" and a trailing dotted IPv4 part.
function groupsOfV6(ip: string): number[] | null {
  let v = ip.toLowerCase().split("%")[0]; if (isIP(v) !== 6) return null;
  const dotted = v.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) { const [a, b, c, d] = dotted[1].split(".").map(Number); v = v.slice(0, -dotted[1].length) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16); }
  const [head, tail] = v.split("::"); const h = head ? head.split(":") : [], t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const fill = tail === undefined ? [] : Array(8 - h.length - t.length).fill("0");
  const all = [...h, ...fill, ...t].map((x) => parseInt(x || "0", 16)); return all.length === 8 && all.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? all : null;
}
const v4of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
      || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  }
  const g = groupsOfV6(ip); if (!g) return true; // anything that is not a clean address is refused
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return g.slice(0, 7).every((x) => x === 0) && g[7] <= 1 ? true : isPrivateAddress(v4of(g[6], g[7])); // ::, ::1, ::ffff:a.b.c.d and the old IPv4-compatible form
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateAddress(v4of(g[6], g[7])); // NAT64: the address inside
  if (g[0] === 0x2002) return isPrivateAddress(v4of(g[1], g[2])); // 6to4: the address inside
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation range
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xff00) === 0xff00;
}

export async function checkUrl(raw: string, resolve = lookup): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("that is not a valid link"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("only http and https links can be opened");
  if (u.username || u.password) throw new Error("links with a login in them are not opened");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error("that link points at this computer or a local network");
  const addrs = isIP(host) ? [{ address: host }] : await resolve(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("that link points at a private network address");
  return u;
}

// The default way a link is fetched. The address is checked AT THE MOMENT THE CONNECTION IS MADE, by the same lookup the connection uses, so a name that answers with a public address for the check
// and a private one for the fetch (DNS rebinding) cannot get through: there is no second lookup. Redirects are not followed here (the caller checks each one).
export function pinnedFetch(url: URL | string, init: { signal?: AbortSignal; headers?: Record<string, string> } = {}, o: { isPrivate?: (ip: string) => boolean } = {}): Promise<Response> {
  const u = typeof url === "string" ? new URL(url) : url, isPrivate = o.isPrivate ?? isPrivateAddress, mod = u.protocol === "https:" ? https : http;
  const safeLookup = ((host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
    dnsLookup(host, { all: true }, (err, addrs) => {
      if (err) return cb(err); if (!addrs.length || addrs.some((a) => isPrivate(a.address))) return cb(new Error("that link points at a private network address"));
      if (opts?.all) return cb(null, addrs); cb(null, addrs[0].address, addrs[0].family);
    });
  }) as never;
  const literal = u.hostname.replace(/^\[|\]$/g, ""); if (isIP(literal) && isPrivate(literal)) return Promise.reject(new Error("that link points at a private network address")); // an address typed as numbers is never looked up, so it is checked here
  return new Promise((resolve, reject) => {
    const req = mod.request(u, { method: "GET", headers: { ...init.headers, "Accept-Encoding": "identity" }, lookup: safeLookup, signal: init.signal }, (res) => {
      const headers = new Headers(); for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
      const status = res.statusCode ?? 0, nullBody = status < 200 || status === 204 || status === 205 || (status >= 300 && status < 400);
      if (nullBody) { res.resume(); resolve(new Response(null, { status: status < 200 ? 502 : status, headers })); return; }
      resolve(new Response(Readable.toWeb(res) as unknown as ReadableStream, { status, headers }));
    });
    req.on("error", reject); req.end();
  });
}

const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
export function htmlToText(html: string): string {
  return decode(html
    .replace(/<(script|style|noscript|svg|template|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|div|h[1-6]|li|ul|ol|section|article|tr)>/gi, "\n").replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Many careers pages carry the job as structured data (schema.org JobPosting): the cleanest source when present.
export function jobPostingFromHtml(html: string): { title?: string; company?: string; location?: string; text: string } | null {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: any;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const list = Array.isArray(data) ? data : data?.["@graph"] ?? [data];
    const jp = list.find((x: any) => x && (x["@type"] === "JobPosting" || (Array.isArray(x["@type"]) && x["@type"].includes("JobPosting"))));
    if (!jp?.description) continue;
    const loc = [jp.jobLocation].flat().map((l: any) => [l?.address?.addressLocality, l?.address?.addressCountry?.name ?? l?.address?.addressCountry].filter(Boolean).join(", ")).filter(Boolean).join("; ");
    return { title: jp.title, company: jp.hiringOrganization?.name, location: loc || (jp.jobLocationType === "TELECOMMUTE" ? "Remote" : undefined), text: htmlToText(decode(String(jp.description))) };
  }
  return null;
}

// Reads at most `max` bytes of a response and then stops downloading, so a huge page cannot fill the memory.
async function readCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.length;
    if (size >= max) { await reader.cancel().catch(() => {}); break; }
  }
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, max));
}

export async function fetchJobAd(raw: string, deps: { fetch?: typeof fetch; resolve?: typeof lookup } = {}): Promise<{ url: string; text: string }> {
  const f: typeof fetch = deps.fetch ?? (((u: URL | string, init?: RequestInit) => pinnedFetch(u, { signal: init?.signal ?? undefined, headers: init?.headers as Record<string, string> })) as unknown as typeof fetch);
  let url = await checkUrl(raw, deps.resolve);
  let res: Response | null = null;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    res = await f(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": "Mozilla/5.0 (Macintosh) personal-cv-bot", Accept: "text/html,application/xhtml+xml" } });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) { url = await checkUrl(new URL(res.headers.get("location")!, url).toString(), deps.resolve); continue; }
    break;
  }
  if (!res || !res.ok) throw new Error(`the page answered ${res?.status ?? "nothing"}`);
  const type = res.headers.get("content-type") ?? "";
  if (!/text\/html|application\/xhtml|text\/plain/i.test(type)) throw new Error(`that link is not a web page (${type.split(";")[0] || "unknown type"})`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("that page is too large");
  const html = await readCapped(res, MAX_BYTES);
  const jp = jobPostingFromHtml(html);
  const text = jp ? [jp.title && `# ${jp.title}`, jp.company && `Company: ${jp.company}`, jp.location && `Location: ${jp.location}`, "", jp.text].filter((x) => x !== undefined && x !== "").join("\n") : htmlToText(html);
  if (/sign in|log in|join now|authwall/i.test(text.slice(0, 600)) && text.length < 3000) throw new Error("that page needs a login (LinkedIn and Indeed usually do)");
  if (text.length < 400) throw new Error("I couldn't find a job description on that page (it may be built by JavaScript)");
  return { url: url.toString(), text: `Source: ${url.toString()}\n\n${text}` };
}
