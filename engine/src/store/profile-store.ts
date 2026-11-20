// The profile in the database (phase 2c). One document, saved whole in one transaction, so it is never half-written. Loading NEVER hands back a profile
// that fails validation or was written by a newer app: it says what is wrong instead (the app then offers the backup, step 2e).
// Schema v2 (design/PROFILE-SCHEMA-v2.md): the document is stored as v2 (profile_format 2). A v1 document is converted ON READ and only rewritten as v2 by the next save.
// `loadProfile` / `saveProfile` keep the v1 SHAPE for every existing reader and writer; `loadProfileV2` / `saveProfileV2` are the v2 API.
import type { Db } from "./db.ts";
import { meetsStartGate, validateProfile, type Profile } from "../profile.ts";
import { PROFILE_V2_VERSION, applyV1Edit, migrateV1ToV2, toV1View, validateProfile2, type Profile2 } from "../profile-v2.ts";
import { unsupportedInProfile } from "../cv/html.ts";

export const PROFILE_FORMAT_LATEST = PROFILE_V2_VERSION;
export type SaveResult =
  | { ok: true; warnings: string[] }
  | { ok: false; errors: string[] };
export type LoadResult =
  | { status: "none" }
  | { status: "ok"; profile: Profile; updatedAt: string }
  | { status: "damaged"; reason: string }
  | { status: "too-new"; found: number; known: number };
export type LoadResult2 =
  | { status: "none" }
  | { status: "ok"; profile: Profile2; updatedAt: string; storedFormat: number }
  | { status: "damaged"; reason: string }
  | { status: "too-new"; found: number; known: number };

// Saving: a profile that is structurally wrong is refused and NOTHING is written (the previous profile stays). Unfinished work (drafts, a profile that does not yet
// meet the start gate, characters the CV font cannot print) is allowed, and reported as warnings so the screen can show them.
// A save in the v1 SHAPE (from the current profile page) is applied onto the stored v2 profile, so provenance, sources, languages and the rest are kept.
export function saveProfile(db: Db, profile: Profile, now: Date, o: { covers?: (cp: number) => boolean } = {}): SaveResult {
  const stored = db.get<{ profile_format: number }>("SELECT profile_format FROM profile WHERE id = 1");
  if (stored && stored.profile_format > PROFILE_FORMAT_LATEST) return { ok: false, errors: ["the saved profile was written by a newer version of the app and is not overwritten: update the app"] };
  const errors = validateProfile(profile, { requireDates: false });
  if (errors.length) return { ok: false, errors };
  const base = loadProfileV2(db), at = now.toISOString();
  const next = base.status === "ok" ? applyV1Edit(base.profile, profile, at) : migrateV1ToV2(profile, at);
  return saveProfileV2(db, next, now, o);
}
export function saveProfileV2(db: Db, profile: Profile2, now: Date, o: { covers?: (cp: number) => boolean } = {}): SaveResult {
  const stored = db.get<{ profile_format: number }>("SELECT profile_format FROM profile WHERE id = 1");
  if (stored && stored.profile_format > PROFILE_FORMAT_LATEST) return { ok: false, errors: ["the saved profile was written by a newer version of the app and is not overwritten: update the app"] };
  const errors = validateProfile2(profile, { requireDates: false });
  if (errors.length) return { ok: false, errors };
  const v1 = toV1View(profile), warnings: string[] = [];
  const gate = meetsStartGate(v1);
  if (!gate.ok) warnings.push(...gate.missing.map((m) => `not ready to build CVs yet: ${m}`));
  if (o.covers) for (const u of unsupportedInProfile(v1, o.covers)) warnings.push(`${u.where}: these characters cannot be printed in the CV font: ${u.chars.join(" ")}`);
  const doc = JSON.stringify(profile);
  db.transaction(() => {
    db.run("INSERT INTO profile(id, doc, profile_format, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, profile_format = excluded.profile_format, updated_at = excluded.updated_at", doc, PROFILE_FORMAT_LATEST, now.toISOString());
  });
  return { ok: true, warnings };
}

// Loading as v2: a v1 document is converted in memory (nothing is written).
export function loadProfileV2(db: Db): LoadResult2 {
  const row = db.get<{ doc: string; profile_format: number; updated_at: string }>("SELECT doc, profile_format, updated_at FROM profile WHERE id = 1");
  if (!row) return { status: "none" };
  if (row.profile_format > PROFILE_FORMAT_LATEST) return { status: "too-new", found: row.profile_format, known: PROFILE_FORMAT_LATEST };
  let doc: unknown;
  try { doc = JSON.parse(row.doc); } catch (e) { return { status: "damaged", reason: `the saved profile cannot be read: ${(e as Error).message}` }; }
  if (!doc || typeof doc !== "object") return { status: "damaged", reason: "the saved profile is not a profile" };
  if (row.profile_format >= PROFILE_V2_VERSION) {
    const errors = validateProfile2(doc as Profile2, { requireDates: false });
    if (errors.length) return { status: "damaged", reason: `the saved profile is not valid: ${errors.slice(0, 3).join("; ")}` };
    return { status: "ok", profile: doc as Profile2, updatedAt: row.updated_at, storedFormat: row.profile_format };
  }
  const errors = validateProfile(doc as Profile, { requireDates: false });
  if (errors.length) return { status: "damaged", reason: `the saved profile is not valid: ${errors.slice(0, 3).join("; ")}` };
  return { status: "ok", profile: migrateV1ToV2(doc as Profile, row.updated_at), updatedAt: row.updated_at, storedFormat: row.profile_format };
}

// Loading in the v1 SHAPE, for every reader that has not moved to v2 (pipeline, agents, CV builder, Telegram, the current profile page).
export function loadProfile(db: Db): LoadResult {
  const r = loadProfileV2(db);
  if (r.status !== "ok") return r;
  return { status: "ok", profile: toV1View(r.profile), updatedAt: r.updatedAt };
}
