// The real SecretStore (phase 4d, decided by the owner): each secret is a file in `<data>/secrets/`, encrypted by Electron's safeStorage with a key that lives in the macOS
// Keychain ("<app name> Safe Storage"). Nothing readable is ever on disk. Uses the ASYNCHRONOUS safeStorage calls (the synchronous ones are deprecated in Electron 45).
// Electron is passed in, never imported, so this is tested with a fake. `get` returns null when nothing is saved and THROWS when a saved secret cannot be read (a damaged file, a
// Keychain that will not open): the access layer shows that as "could not read your saved key", never as "no key".
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { SECRET_NAMES, MAX_SECRET_LENGTH, DEFAULT_MAX_SECRET_LENGTH, type SecretStore } from "../../../../engine/src/store/secrets.ts";

export interface SafeStorageLike {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plain: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ shouldReEncrypt: boolean; result: string }>;
}
const KNOWN = new Set<string>(Object.values(SECRET_NAMES));

export class SafeStorageSecretStore implements SecretStore {
  private dir: string; private safe: SafeStorageLike;
  constructor(dir: string, safe: SafeStorageLike) { this.dir = dir; this.safe = safe; }
  private file(name: string): string { if (!KNOWN.has(name)) throw new Error("not a known secret"); return path.join(this.dir, `${name}.bin`); } // only our own two names: never a path made of caller text
  async available(): Promise<boolean> { try { return await this.safe.isAsyncEncryptionAvailable(); } catch { return false; } }
  async get(name: string): Promise<string | null> {
    let blob: Buffer;
    try { blob = await readFile(this.file(name)); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("the saved secret could not be read"); }
    let r: { shouldReEncrypt: boolean; result: string };
    try { r = await this.safe.decryptStringAsync(blob); } catch { throw new Error("the saved secret could not be read"); }
    if (r.shouldReEncrypt) await this.set(name, r.result).catch(() => undefined); // the key was rotated: store it under the new key
    return r.result;
  }
  async set(name: string, value: string): Promise<void> {
    if (typeof value !== "string" || !value || value.length > (MAX_SECRET_LENGTH[name] ?? DEFAULT_MAX_SECRET_LENGTH)) throw new Error("not a usable secret");
    if (!(await this.available())) throw new Error("secure storage is not available on this Mac");
    const f = this.file(name), tmp = f + ".tmp";
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await writeFile(tmp, await this.safe.encryptStringAsync(value), { mode: 0o600 });
    await rename(tmp, f); await chmod(f, 0o600); // the finished file appears all at once, private to the user
  }
  async delete(name: string): Promise<boolean> {
    const f = this.file(name);
    try { await readFile(f); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return false; throw new Error("the saved secret could not be removed"); }
    await rm(f, { force: true });
    return true;
  }
}

// "Delete everything" also removes the Keychain item that held the key of the secret files. The service name is built from the app name; a name with odd characters is refused.
export type ExecFileLike = (file: string, args: string[]) => Promise<{ code: number }>;
export function keychainKeyRemover(o: { appName: string; execFile: ExecFileLike }) {
  return {
    async remove(): Promise<string | null> {
      if (!/^[A-Za-z0-9 ._-]{1,60}$/.test(o.appName)) return "the Keychain item was not removed (unexpected app name)";
      try {
        const r = await o.execFile("/usr/bin/security", ["delete-generic-password", "-s", `${o.appName} Safe Storage`]);
        return r.code === 0 || r.code === 44 /* 44: item not found, already gone */ ? null : "the Keychain item that protected your saved key could not be removed; you can delete it in Keychain Access";
      } catch { return "the Keychain item that protected your saved key could not be removed; you can delete it in Keychain Access"; }
    },
  };
}
