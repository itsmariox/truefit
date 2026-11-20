// Phase 4c: the main-process side of the bridge, with a fake ipcMain.
import { CHANNEL_NAMES } from "../src/shared/contract.ts";
import { registerIpc, type Handlers } from "../src/main/ipc.ts";
let failures = 0;
const check = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const calls: string[] = [];
const stub = Object.fromEntries(CHANNEL_NAMES.map((c) => [c, () => ({})])); // every other channel answers with an empty object here
const handlers = { ...stub, "app:info": () => ({ name: "Truefit", version: "1", platform: "darwin", packaged: false }), "app:openLink": ({ url }: { url: string }) => { calls.push("open " + url); return { opened: true }; }, "app:ready": () => ({ shown: true }) } as unknown as Handlers;
const registry = new Map<string, (e: any, p: unknown) => Promise<any>>(); const logs: string[] = [];
let trusted = true;
registerIpc({ ipcMain: { handle: (c, l) => registry.set(c, l as never) }, handlers, isTrusted: () => trusted, log: (l) => logs.push(l) });
const call = (c: string, p?: unknown) => registry.get(c)!({}, p);
check("a handler is registered for EVERY channel of the contract and for nothing else", [...registry.keys()].sort().join() === [...CHANNEL_NAMES].sort().join());
check("a valid call returns the handler's answer in the ok shape", JSON.stringify(await call("app:info")) === '{"ok":true,"data":{"name":"Truefit","version":"1","platform":"darwin","packaged":false}}');
check("a valid call with a payload reaches the handler with the CHECKED request", (await call("app:openLink", { url: "https://claude.com/x" })).ok === true && calls.join() === "open https://claude.com/x");
const bad = await call("app:openLink", { url: "https://claude.com/x", admin: true });
check("an invalid request (an unknown field) is refused with a plain message and the handler is NOT called", !bad.ok && bad.error.code === "invalid_request" && calls.length === 1 && !JSON.stringify(bad).includes("admin"));
trusted = false; const nt = await call("app:info"); trusted = true;
check("a sender that is not our page is refused before anything else (even a valid request), and the handler is not called", !nt.ok && nt.error.code === "forbidden" && logs.some((l) => /untrusted/.test(l)));
const throwing: Handlers = { ...handlers, "app:info": () => { throw Object.assign(new Error("/Users/someone/secret/path and SECRET AD TEXT"), { stack: "at /Users/someone/x.ts:1" }); } };
const reg2 = new Map<string, (e: any, p: unknown) => Promise<any>>(), logs2: string[] = [];
registerIpc({ ipcMain: { handle: (c, l) => reg2.set(c, l as never) }, handlers: throwing, isTrusted: () => true, log: (l) => logs2.push(l) });
const boom = await reg2.get("app:info")!({}, undefined);
check("a handler that throws gives a short plain failure: the page never sees the message, a path, a stack or text from an ad, and the log line holds only the error NAME", !boom.ok && boom.error.code === "failed" && !JSON.stringify(boom).match(/Users|SECRET|stack|at /) && logs2.length === 1 && !/Users|SECRET/.test(logs2[0]));
check("a channel without a handler stops the app at start-up (a programming error is caught at once)", (() => { try { registerIpc({ ipcMain: { handle: () => undefined }, handlers: { ...handlers, "app:ready": undefined as never }, isTrusted: () => true }); return false; } catch (e) { return /app:ready/.test((e as Error).message); } })());
console.log(failures === 0 ? "\nall ipc tests passed" : `\n${failures} ipc test(s) FAILED`); process.exit(failures === 0 ? 0 : 1);
