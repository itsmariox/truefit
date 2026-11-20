// Phase 4d: the real secret store with a FAKE safeStorage that behaves like the real one (output is not the plain text; a changed blob fails to decrypt).
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SafeStorageSecretStore, keychainKeyRemover, type SafeStorageLike } from "../src/main/core/secret-store.ts";
import { SECRET_NAMES } from "../../engine/src/store/secrets.ts";
let failures = 0;
const check = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };

// "Encryption": reversed bytes xor 0x5a with a check tail; any change to the blob makes decrypt throw, like the real thing.
function fake(o: { available?: boolean; reEncrypt?: boolean } = {}): SafeStorageLike & { encrypted: number } {
  const f = { encrypted: 0,
    async isAsyncEncryptionAvailable() { return o.available !== false; },
    async encryptStringAsync(p: string) { f.encrypted++; const b = Buffer.from(p, "utf8").map((x) => x ^ 0x5a); return Buffer.concat([Buffer.from("v10"), b, Buffer.from([b.reduce((a, x) => (a + x) & 255, 0)])]); },
    async decryptStringAsync(e: Buffer) {
      if (e.length < 4 || e.subarray(0, 3).toString() !== "v10") throw new Error("bad");
      const b = e.subarray(3, e.length - 1); if (b.reduce((a, x) => (a + x) & 255, 0) !== e[e.length - 1]) throw new Error("bad");
      return { shouldReEncrypt: o.reEncrypt === true, result: Buffer.from(b.map((x) => x ^ 0x5a)).toString("utf8") };
    } };
  return f;
}
const dir = await mkdtemp(path.join(tmpdir(), "cvapp-secret-")); const sdir = path.join(dir, "secrets");
try {
  const s = new SafeStorageSecretStore(sdir, fake()); const NAME = SECRET_NAMES.claudeApiKey ?? Object.values(SECRET_NAMES)[0];
  check("nothing saved yet: get returns null (not an error)", (await s.get(NAME)) === null);
  await s.set(NAME, "sk-ant-FAKE-test-key-123");
  check("round trip: what was saved comes back", (await s.get(NAME)) === "sk-ant-FAKE-test-key-123");
  const file = path.join(sdir, `${NAME}.bin`), raw = await readFile(file);
  check("the file on disk does not contain the key in plain text", !raw.toString("latin1").includes("FAKE-test-key") && !raw.toString("utf8").includes("sk-ant"));
  check("the file is private to the user (0600) and the folder too (0700)", ((await stat(file)).mode & 0o777) === 0o600 && ((await stat(sdir)).mode & 0o777) === 0o700);
  check("no half-written temp file is left behind", (await readdir(sdir)).every((n) => !n.endsWith(".tmp")));
  const damaged = Buffer.from(raw); damaged[5] ^= 1; await writeFile(file, damaged);
  let msg = ""; try { await s.get(NAME); } catch (e) { msg = (e as Error).message; }
  check("a damaged file THROWS 'could not be read' (never 'no key', never the secret)", msg === "the saved secret could not be read");
  await s.set(NAME, "second-key"); check("saving again replaces it", (await s.get(NAME)) === "second-key");
  check("delete removes it and says so; deleting again says false", (await s.delete(NAME)) === true && (await s.delete(NAME)) === false && (await s.get(NAME)) === null);
  let bad = 0; for (const n of ["../evil", "claude-api-key/../x", "", "other"]) { try { await s.set(n, "x"); } catch { bad++; } try { await s.get(n); } catch { bad++; } }
  check("a name that is not one of ours is refused everywhere (no path built from caller text)", bad === 8 && (await readdir(dir)).join() === "secrets");
  let e2 = 0; for (const v of ["", "x".repeat(2001)]) { try { await s.set(NAME, v); } catch { e2++; } }
  check("an empty or huge value is refused", e2 === 2);
  { const big = "x".repeat(6000); let okBig = false, refusedHuge = false, refusedOther = false;
    try { await s.set("openai-plan-signin", big); okBig = (await s.get("openai-plan-signin")) === big; } catch { /* checked below */ }
    try { await s.set("openai-plan-signin", "x".repeat(24_001)); } catch { refusedHuge = true; }
    try { await s.set("openai-api-key", "x".repeat(2001)); } catch { refusedOther = true; }
    check("the ChatGPT sign-in record may be long (up to 24,000 characters); every other secret keeps the 2,000 limit", okBig && refusedHuge && refusedOther); }
  const off = new SafeStorageSecretStore(path.join(dir, "s2"), fake({ available: false })); let m2 = ""; try { await off.set(NAME, "k"); } catch (e) { m2 = (e as Error).message; }
  check("when secure storage is unavailable, saving fails plainly and writes nothing", m2.includes("not available") && (await off.available()) === false && !(await readdir(dir)).includes("s2"));
  const f3 = fake({ reEncrypt: true }); const rot = new SafeStorageSecretStore(path.join(dir, "s3"), f3); await rot.set(NAME, "k1"); const before = f3.encrypted; await rot.get(NAME);
  check("when the key was rotated, reading re-saves the secret under the new key", f3.encrypted === before + 1 && (await rot.get(NAME)) === "k1");
} finally { await rm(dir, { recursive: true, force: true }); }

{
  const calls: string[][] = []; const mk = (code: number | Error) => keychainKeyRemover({ appName: "Truefit", execFile: async (f, a) => { calls.push([f, ...a]); if (code instanceof Error) throw code; return { code }; } });
  check("Keychain removal runs the system tool with the exact service name", (await mk(0).remove()) === null && calls[0].join("|") === "/usr/bin/security|delete-generic-password|-s|Truefit Safe Storage");
  check("'item not found' (44) counts as already gone", (await mk(44).remove()) === null);
  check("any other failure gives a plain warning (no codes)", /Keychain Access/.test((await mk(1).remove()) ?? "") && /Keychain Access/.test((await mk(new Error("boom")).remove()) ?? ""));
  const n = calls.length; const odd = keychainKeyRemover({ appName: 'x"; rm -rf ~', execFile: async () => { calls.push(["ran"]); return { code: 0 }; } });
  check("an app name with odd characters is refused and nothing is run", (await odd.remove()) !== null && calls.length === n);
}
if (failures) { console.log(`\n${failures} FAILED`); process.exit(1); } else console.log("\nALL PASS");
