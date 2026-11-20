// Schema v2, step A: the database side. A v1 document (like the one on a real Mac today) is READ as v2 without being written; the first save writes v2; saves from the v1-shaped page keep
// provenance; backups of both formats restore; a newer format is still refused.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { openDb } = await import("../src/store/db.ts");
const { migrate } = await import("../src/store/migrate.ts");
const { MIGRATIONS } = await import("../src/store/schema.ts");
const S = await import("../src/store/profile-store.ts");
const B = await import("../src/store/backup.ts");
const V = await import("../src/profile-v2.ts");
type Prof = import("../src/profile.ts").Profile;
let failures = 0; const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const canon = (x: unknown): string => JSON.stringify(x, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
const priya: Prof = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8"));
const T0 = new Date("2026-03-01T10:00:00Z"), T1 = new Date("2026-03-02T10:00:00Z"), tmp = mkdtempSync(path.join(os.tmpdir(), "cvapp-pv2-"));
const fresh = () => { const db = openDb(":memory:"); migrate(db, MIGRATIONS); return db; };
const row = (db: ReturnType<typeof openDb>) => db.get<{ doc: string; profile_format: number; updated_at: string }>("SELECT doc, profile_format, updated_at FROM profile WHERE id = 1")!;

{ // a v1 document exactly as the current app stores it
  const db = fresh(); db.run("INSERT INTO profile(id, doc, profile_format, updated_at) VALUES (1, ?, 1, ?)", JSON.stringify(priya), T0.toISOString());
  const before = row(db), l1 = S.loadProfile(db), l2 = S.loadProfileV2(db), after = row(db);
  ok("v1 data: reading it as the v1 shape gives the same content (what every reader sees is unchanged)", l1.status === "ok" && canon(l1.profile) === canon(priya));
  ok("v1 data: reading it as v2 converts in memory (storedFormat 1, legacy provenance) and WRITES NOTHING (document, format and time unchanged)", l2.status === "ok" && l2.storedFormat === 1 && l2.profile.facts.roles[0].bullets[0].meta.origin === "legacy" && before.doc === after.doc && after.profile_format === 1 && before.updated_at === after.updated_at);
  const save = S.saveProfile(db, priya, T1); const r = row(db);
  ok("v1 data: the first save (from the v1-shaped page) writes v2 (profile_format 2) and the v1 view of it is unchanged", save.ok && r.profile_format === 2 && JSON.parse(r.doc).schemaVersion === 2 && canon((S.loadProfile(db) as { profile: Prof }).profile) === canon(priya));
}
{ // provenance survives a save from the v1-shaped page
  const db = fresh(), p2 = V.migrateV1ToV2(priya, T0.toISOString());
  p2.sources = [{ id: "s1", kind: "cv", label: "CV", addedAt: T0.toISOString(), textHash: "h", text: "masked" }]; p2.facts.roles[0].bullets[0].meta = { origin: "cv", trust: "trusted", addedAt: T0.toISOString(), sourceId: "s1", quote: "q" };
  p2.facts.languages = [{ id: "l1", name: "English", level: "native", meta: { origin: "cv", trust: "trusted", addedAt: T0.toISOString(), sourceId: "s1" } }]; p2.locked.work.visaNote = "citizen";
  ok("provenance: the v2 profile saves", S.saveProfileV2(db, p2, T0).ok);
  const view = (S.loadProfile(db) as { profile: Prof }).profile; view.identity.city = "Leeds";
  ok("provenance: a v1-shaped save (an edit of the city) keeps the source, the quote, the language and the visa note", S.saveProfile(db, view, T1).ok && (() => { const q = S.loadProfileV2(db) as { profile: import("../src/profile-v2.ts").Profile2 }; return q.profile.locked.identity.city === "Leeds" && q.profile.facts.roles[0].bullets[0].meta.sourceId === "s1" && q.profile.facts.roles[0].bullets[0].meta.quote === "q" && q.profile.facts.languages.length === 1 && q.profile.locked.work.visaNote === "citizen" && q.profile.sources[0].text === "masked"; })());
}
{ // backups of both formats restore
  const dbOld = fresh(); dbOld.run("INSERT INTO profile(id, doc, profile_format, updated_at) VALUES (1, ?, 1, ?)", JSON.stringify(priya), T0.toISOString());
  const dOld = path.join(tmp, "old"), bo = await B.createBackup(dbOld, dOld, { reason: "change", now: T0 }), lo = await B.listBackups(dOld);
  const dbNew = fresh(); S.saveProfileV2(dbNew, V.migrateV1ToV2(priya, T0.toISOString()), T0); const dNew = path.join(tmp, "new"), bn = await B.createBackup(dbNew, dNew, { reason: "change", now: T1 }), ln = await B.listBackups(dNew);
  ok("backup: a backup of a v1 profile and a backup of a v2 profile are both written and valid", bo.ok && bn.ok && lo[0]?.valid === true && ln[0]?.valid === true);
  const t1 = fresh(), r1 = await B.restoreBackup(t1, dOld, lo[0].file), t2 = fresh(), r2 = await B.restoreBackup(t2, dNew, ln[0].file);
  ok("backup: restoring the v1 backup gives a v1 document (read as v2); restoring the v2 backup gives a v2 document; both read back identical in the v1 shape", r1.ok && r2.ok && row(t1).profile_format === 1 && row(t2).profile_format === 2 && canon((S.loadProfile(t1) as { profile: Prof }).profile) === canon(priya) && canon((S.loadProfile(t2) as { profile: Prof }).profile) === canon(priya));
}
{ // a newer format is refused, damaged v2 is reported
  const db = fresh(); db.run("INSERT INTO profile(id, doc, profile_format, updated_at) VALUES (1, ?, 3, ?)", JSON.stringify(priya), T0.toISOString());
  const l = S.loadProfileV2(db), s = S.saveProfile(db, priya, T1);
  ok("newer format: format 3 is reported too-new (found 3, known 2) and is never overwritten", l.status === "too-new" && l.found === 3 && l.known === 2 && !s.ok && row(db).profile_format === 3);
  const d2 = fresh(); const broken = V.migrateV1ToV2(priya, T0.toISOString()); delete (broken.facts.roles[0] as any).meta; d2.run("INSERT INTO profile(id, doc, profile_format, updated_at) VALUES (1, ?, 2, ?)", JSON.stringify(broken), T0.toISOString());
  ok("damaged v2: a v2 document with missing provenance is reported damaged, not loaded and not handed to any reader", S.loadProfileV2(d2).status === "damaged" && S.loadProfile(d2).status === "damaged");
}
rmSync(tmp, { recursive: true, force: true }); void assert;
console.log(failures === 0 ? "\nall profile-store-v2 tests passed" : `\n${failures} profile-store-v2 test(s) FAILED`); process.exit(failures === 0 ? 0 : 1);
