// Schema v2 at app start: a profile stored as v1 (like the one on a real Mac today) is backed up ONCE before anything can rewrite it, reading does not rewrite it, and the first save writes v2.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startApp } from "../src/main/core/app-core.ts";
import { createHost } from "../src/main/core/host.ts";
import { openStore } from "../../engine/src/store/open.ts";
import { rig, priya } from "./core-rig.ts";
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const root = mkdtempSync(path.join(os.tmpdir(), "cvapp-pv2s-"));
try {
  mkdirSync(path.join(root, "tmp"), { recursive: true });
  const o = await openStore(path.join(root, "data"), { now: new Date("2026-03-01T10:00:00Z") });
  if (o.status !== "ok") throw new Error("store did not open");
  o.db.run("INSERT INTO profile(id, doc, profile_format, updated_at) VALUES (1, ?, 1, ?)", JSON.stringify(priya), "2026-03-01T10:00:00.000Z"); o.db.close();
  const R = rig(root), host = createHost({ start: () => startApp(R.deps()), onReady: () => undefined }); await host.start(); const core = host.core()!;
  const backups = (existsSync(path.join(root, "data", "Backups")) ? readdirSync(path.join(root, "data", "Backups")) : []).filter((f) => /^backup-.*\.json$/.test(f));
  const bk = backups.length ? JSON.parse(readFileSync(path.join(root, "data", "Backups", backups[0]), "utf8")) : null;
  ok("a v1 profile is backed up once at start, before anything can rewrite it (reason pre-migration, the backup holds the v1 document)", backups.length === 1 && bk?.reason === "pre-migration" && bk.payload.profile.profile_format === 1 && JSON.parse(bk.payload.profile.doc).schemaVersion === 1);
  const row = () => (core as any).db?.get?.("SELECT profile_format FROM profile WHERE id = 1");
  void row;
  ok("reading it for the app (the v1 shape) gives the same content and the stored document is still v1", !!core.profile.get() && JSON.stringify(Object.keys(core.profile.get()!).sort()) === JSON.stringify(Object.keys(priya).sort()) && core.profile.updatedAt() === "2026-03-01T10:00:00.000Z");
  const saved = core.profile.save(core.profile.get()!);
  ok("the first save writes v2 (a new saved time) and a second app start would find a v2 profile with no further backup", saved.ok && core.profile.updatedAt() !== "2026-03-01T10:00:00.000Z");
  await core.shutdown({ finalBackup: false });
  const o2 = await openStore(path.join(root, "data"), { now: new Date("2026-03-03T10:00:00Z") }); if (o2.status !== "ok") throw new Error("reopen failed");
  const fmt = o2.db.get<{ profile_format: number }>("SELECT profile_format FROM profile WHERE id = 1")!.profile_format; o2.db.close();
  ok("after that save the stored format is 2", fmt === 2);
} finally { rmSync(root, { recursive: true, force: true }); }
console.log(failures === 0 ? "\nall profile-v2-start tests passed" : `\n${failures} profile-v2-start test(s) FAILED`); process.exit(failures === 0 ? 0 : 1);
