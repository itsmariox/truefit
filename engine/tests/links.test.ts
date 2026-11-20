import * as F from "../src/fetchlink.ts";
// Offline tests for link fetching safety: private addresses, redirects, login walls, readable text. (Moved out of core.test.ts at the step 7b cutover.)
let failures = 0;
const ok = (name: string, cond: boolean) => { if (!cond) failures++; console.log((cond ? "PASS " : "FAIL ") + name); };
const throws = async (fn: () => Promise<unknown>, re: RegExp) => { try { await fn(); return false; } catch (e) { return re.test((e as Error).message); } };

const pub = async () => [{ address: "93.184.216.34", family: 4 }];
ok("links: private and local addresses are refused", F.isPrivateAddress("127.0.0.1") && F.isPrivateAddress("10.0.0.5") && F.isPrivateAddress("192.168.1.1") && F.isPrivateAddress("169.254.169.254") && F.isPrivateAddress("::1") && F.isPrivateAddress("::ffff:10.0.0.1") && !F.isPrivateAddress("93.184.216.34"));
ok("links: only http(s), no logins in the link, no local names", await throws(() => F.checkUrl("file:///etc/passwd", pub as never), /http/) && await throws(() => F.checkUrl("https://a:b@x.com", pub as never), /login/) && await throws(() => F.checkUrl("http://localhost:8080", pub as never), /this computer/) && await throws(() => F.checkUrl("https://evil.example", (async () => [{ address: "10.1.1.1" }]) as never), /private/));
const page = (body: string, headers: Record<string, string> = { "content-type": "text/html" }, status = 200) => (async () => new Response(body, { status, headers })) as unknown as typeof fetch;
const jd = `<html><head><script type="application/ld+json">{"@type":"JobPosting","title":"AI Ops Specialist","hiringOrganization":{"name":"Acme"},"jobLocation":{"address":{"addressLocality":"Leeds","addressCountry":"GB"}},"description":"&lt;p&gt;${"Build automations with n8n and Python. ".repeat(20)}&lt;/p&gt;"}</script></head><body>nav</body></html>`;
const got = await F.fetchJobAd("https://jobs.acme.com/1", { fetch: page(jd), resolve: pub as never });
ok("links: a careers page's structured job data is used when present", got.text.includes("# AI Ops Specialist") && got.text.includes("Company: Acme") && got.text.includes("Location: Leeds, GB") && got.text.includes("Build automations"));
ok("links: a redirect to a private address is refused", await throws(() => F.fetchJobAd("https://jobs.acme.com/1", { fetch: page("", { location: "http://169.254.169.254/latest" }, 302), resolve: (async (h: string) => [{ address: h.startsWith("169") ? h : "93.184.216.34" }]) as never }), /private/));
ok("links: a login wall or an empty page gives a clear message", await throws(() => F.fetchJobAd("https://www.linkedin.com/jobs/1", { fetch: page("<p>Sign in to see this job. Join now</p>"), resolve: pub as never }), /login|couldn't find/) && await throws(() => F.fetchJobAd("https://x.com/f.pdf", { fetch: page("%PDF", { "content-type": "application/pdf" }), resolve: pub as never }), /not a web page/));
ok("links: plain HTML is turned into readable text without scripts", F.htmlToText("<script>evil()</script><h1>Role</h1><p>Do things &amp; more</p><ul><li>a</li></ul>") === "Role\nDo things & more\n- a");


{ // found by the independent review (2026-11-18): the URL parser rewrites ::ffff:127.0.0.1 to hex, which used to slip past the guard
  const bad = ["::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:c0a8:1", "0:0:0:0:0:ffff:7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::", "fe80::1", "fd00::1", "2001:db8::1", "198.18.0.1", "192.0.2.5", "::"];
  ok("links: IPv4 hidden inside IPv6 (mapped, hex, NAT64, 6to4) and the reserved ranges are refused", bad.every((a) => F.isPrivateAddress(a)));
  ok("links: public IPv6 and IPv4-mapped public addresses are still allowed", !F.isPrivateAddress("2606:4700:4700::1111") && !F.isPrivateAddress("::ffff:8.8.8.8") && !F.isPrivateAddress("8.8.8.8"));
  let refused = 0; for (const u of ["http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]:8080/admin", "http://[::ffff:a9fe:a9fe]/latest"]) { try { await F.checkUrl(u); } catch { refused++; } }
  ok("links: pasted links that point at this Mac through an IPv6 form are refused by checkUrl", refused === 3);
}

{ // DNS rebinding (review P2, fixed 2026-11-19): the check happens inside the connection's own lookup, so there is no second lookup to trick
  const { createServer } = await import("node:http"); const srv = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end("<html><body>hello pinned</body></html>"); }); await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r())); const port = (srv.address() as { port: number }).port;
  try {
    ok("pinned fetch: a name that resolves to this computer (localhost) is refused at connection time, before anything is sent", await throws(() => F.pinnedFetch(new URL(`http://localhost:${port}/`)), /private network/));
    ok("pinned fetch: an address that is private is refused even when written as a number", await throws(() => F.pinnedFetch(new URL(`http://127.0.0.1:${port}/`)), /private network/));
    const r = await F.pinnedFetch(new URL(`http://localhost:${port}/`), {}, { isPrivate: () => false }); const t = await r.text();
    ok("pinned fetch: with the check switched off for this test only, the page comes back as a normal Response (status, headers, body)", r.status === 200 && /text\/html/.test(r.headers.get("content-type") ?? "") && t.includes("hello pinned"));
  } finally { srv.close(); }
}
console.log(failures === 0 ? "\nall links tests passed" : `\n${failures} links test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
