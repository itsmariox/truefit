const { toTelegramHtml, chunks } = await import("../src/telegram.ts");
// Offline tests for Telegram formatting. (Moved out of core.test.ts at the step 7b cutover.)
let failures = 0;
const ok = (name: string, cond: boolean) => { if (!cond) failures++; console.log((cond ? "PASS " : "FAIL ") + name); };
const throws = async (fn: () => Promise<unknown>, re: RegExp) => { try { await fn(); return false; } catch (e) { return re.test((e as Error).message); } };

ok("telegram: ad text cannot inject HTML; only **bold** becomes <b>", toTelegramHtml("**Long shot** <script>x</script> & co\n- item") === "<b>Long shot</b> &lt;script&gt;x&lt;/script&gt; &amp; co\n• item");
ok("telegram: long messages are split under the limit, on line breaks", (() => { const c = chunks(("line of text\n").repeat(600)); return c.length === 3 && c.every((x) => x.length <= 3800 && x.endsWith("text")); })());


console.log(failures === 0 ? "\nall telegram tests passed" : `\n${failures} telegram test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
