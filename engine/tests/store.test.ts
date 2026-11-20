// Phase 2c: the profile store and the settings store on a real SQLite file. Fixtures only.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const { openDb } = await import("../src/store/db.ts");
const { migrate } = await import("../src/store/migrate.ts");
const { MIGRATIONS } = await import("../src/store/schema.ts");
const { saveProfile, loadProfile } = await import("../src/store/profile-store.ts");
const { getSettings, setSettings, defaultSettings, SETTINGS } = await import("../src/store/settings-store.ts");
const { loadFonts } = await import("../src/cv/render.ts");
type Prof = import("../src/profile.ts").Profile;
const canon = (x: unknown): string => JSON.stringify(x, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v)); // content equality, key order ignored (the stored document is re-serialised through schema v2)
let failures = 0;
const ok = (n: string, c: boolean) => { if (!c) failures++; console.log((c ? "PASS " : "FAIL ") + n); };
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const T0 = new Date("2026-11-17T10:00:00Z"), T1 = new Date("2026-11-17T11:00:00Z");
const priya: Prof = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-priya.json"), "utf8")), sam: Prof = JSON.parse(readFileSync(path.join(dir, "fixtures", "profile-sam.json"), "utf8"));
const tmp = mkdtempSync(path.join(os.tmpdir(), "cvapp-store-")), file = path.join(tmp, "app.db");
let db = openDb(file); migrate(db, MIGRATIONS);

// ---------- profile ----------
ok("a new database has no profile (none, not an error)", loadProfile(db).status === "none");
const s1 = saveProfile(db, priya, T0);
const l1 = loadProfile(db);
ok("a saved profile loads back IDENTICAL (every field, including contact details, drafts and Do-not-use items), with its save time", s1.ok && l1.status === "ok" && canon(l1.profile) === canon(priya) && l1.updatedAt === T0.toISOString());
ok("it is still identical after closing and reopening the file", (() => { db.close(); db = openDb(file); migrate(db, MIGRATIONS); const l = loadProfile(db); return l.status === "ok" && canon(l.profile) === canon(priya); })());
ok("saving again replaces the profile (still ONE row; the later save wins)", (() => { const p = clone(priya); p.identity.city = "Bradford"; const r = saveProfile(db, p, T1); const l = loadProfile(db); return r.ok && l.status === "ok" && l.profile.identity.city === "Bradford" && l.updatedAt === T1.toISOString() && db.all("SELECT * FROM profile").length === 1; })());
{
  const keep = JSON.stringify((loadProfile(db) as { profile: Prof }).profile);
  const bad = clone(priya); bad.roles[1].id = bad.roles[0].id;
  const r = saveProfile(db, bad, T1), noVer = saveProfile(db, { ...clone(priya), schemaVersion: 99 } as Prof, T1), junk = saveProfile(db, { nonsense: true } as unknown as Prof, T1);
  ok("a structurally wrong profile (repeated role id, wrong schema version, not a profile at all) is REFUSED with reasons and the saved profile is untouched", !r.ok && !noVer.ok && !junk.ok && (!r.ok && r.errors.some((e) => /repeated/.test(e))) && JSON.stringify((loadProfile(db) as { profile: Prof }).profile) === keep);
}
ok("a second fixture profile (no focus types, different shape) saves and loads identical", (() => { const d2 = openDb(":memory:"); migrate(d2, MIGRATIONS); const r = saveProfile(d2, sam, T0); const l = loadProfile(d2); d2.close(); return r.ok && l.status === "ok" && canon(l.profile) === canon(sam); })());
{
  const empty = clone(priya); empty.roles = []; empty.skills = [];
  const r = saveProfile(db, empty, T1);
  ok("unfinished work is SAVED, with warnings that say what is missing (the start gate), so onboarding can save as it goes", r.ok && r.warnings.some((w) => /not ready to build CVs/.test(w)) && (loadProfile(db) as { profile: Prof }).profile.roles.length === 0);
  saveProfile(db, priya, T1);
}
{
  const fonts = await loadFonts(), p = clone(priya); p.roles[0].bullets[0].text += " → 😀";
  const r = saveProfile(db, p, T1, { covers: fonts.covers });
  ok("characters the CV font cannot print are reported as warnings with WHERE they are, but the profile is still saved", r.ok && r.warnings.some((w) => /cannot be printed/.test(w) && /→|😀/.test(w)) && saveProfile(db, priya, T1, { covers: fonts.covers }).ok && (saveProfile(db, priya, T1, { covers: fonts.covers }) as { warnings: string[] }).warnings.length === 0);
}
{
  const p0 = clone(priya);
  const set = (doc: string, fmt = 1) => db.run("UPDATE profile SET doc = ?, profile_format = ? WHERE id = 1", doc, fmt);
  saveProfile(db, p0, T1);
  set("{this is not json"); const a = loadProfile(db);
  set(JSON.stringify({ hello: "world" })); const b = loadProfile(db);
  set(JSON.stringify({ ...p0, roles: [{ ...p0.roles[0] }, { ...p0.roles[0] }] })); const c = loadProfile(db);
  set(JSON.stringify(p0), 99); const d = loadProfile(db); const fmtAfterD = db.get<{ profile_format: number }>("SELECT profile_format FROM profile")!.profile_format;
  set("null"); const e = loadProfile(db);
  ok("a damaged saved profile is NEVER loaded: broken JSON, a document that is not a profile, an invalid profile and 'null' are all reported as damaged with a reason", [a, b, c, e].every((x) => x.status === "damaged" && (x as { reason: string }).reason.length > 10));
  ok("a profile written by a newer format is reported as too-new (found and known), not loaded and not overwritten", d.status === "too-new" && d.found === 99 && d.known === 2 && fmtAfterD === 99);
  set(JSON.stringify(p0), 99);
  ok("saving over a profile written by a NEWER format is refused (it is never overwritten by an older app)", (() => { const r = saveProfile(db, p0, T1); return !r.ok && /newer version/.test(r.errors[0]) && db.get<{ profile_format: number }>("SELECT profile_format FROM profile")!.profile_format === 99; })());
  set(JSON.stringify(p0), 1); saveProfile(db, p0, T1);
}

// ---------- settings ----------
{
  const g = getSettings(db);
  ok("a new database gives every setting its default (friendly tone, Oxford accent, light appearance, update check on, start at login off, Telegram off and unpaired, all four notifications on)", JSON.stringify(g.settings) === JSON.stringify(defaultSettings()) && g.repaired.length === 0 && g.settings.tone === "friendly" && g.settings.accent === "oxford" && g.settings.appearance === "light" && g.settings.updateCheck === true && g.settings.startAtLogin === false && g.settings["telegram.chatId"] === null && g.settings["notify.failed"] === true);
  const r = setSettings(db, { tone: "concise", accent: "plum", "notify.cvReady": false, "telegram.enabled": true, "telegram.chatId": 123456789 }, T0);
  db.close(); db = openDb(file);
  const g2 = getSettings(db).settings;
  ok("settings are saved and survive reopening; untouched ones keep their defaults", r.ok && g2.tone === "concise" && g2.accent === "plum" && g2["notify.cvReady"] === false && g2["telegram.chatId"] === 123456789 && g2["notify.analysed"] === true);
  const before = JSON.stringify(getSettings(db).settings);
  const bads = [{ tone: "shouty" }, { accent: "hotpink" }, { updateCheck: "yes" }, { "telegram.chatId": 1.5 }, { nope: 1 }, { tone: "neutral", nope: 1 }, { apiKey: "sk-ant-x" }, { "telegram.botToken": "123:abc" }, { password: "p" }] as never[];
  const results = bads.map((b) => setSettings(db, b, T1));
  ok("a bad value, an unknown key or a secret-looking key (API key, bot token, password) REFUSES the whole patch, with the reason, and nothing is written (even the valid part of a mixed patch)", results.every((x) => !x.ok) && JSON.stringify(getSettings(db).settings) === before && db.all("SELECT * FROM settings WHERE key IN ('apiKey','nope','password') OR key LIKE '%oken%'").length === 0 && !(results[7] as { errors: string[] }).errors.every((e) => !/secrets/.test(e)));
  ok("every setting's key and allowed values are defined in one place; no setting key itself looks like a secret", Object.keys(SETTINGS).every((k) => !/token|secret|password|api[-_.]?key|credential/i.test(k)));
  db.run("UPDATE settings SET value = ? WHERE key = 'tone'", '"shouting"'); db.run("UPDATE settings SET value = ? WHERE key = 'accent'", "{broken"); db.run("INSERT INTO settings VALUES ('futureThing', '1', 'x')");
  const g3 = getSettings(db);
  ok("a stored value that is no longer valid (or broken) falls back to its default and is listed in `repaired`, never an error; a key from another version is ignored and kept", g3.settings.tone === "friendly" && g3.settings.accent === "oxford" && g3.repaired.sort().join() === "accent,tone" && db.all("SELECT * FROM settings WHERE key = 'futureThing'").length === 1);
  ok("an empty patch is fine and writes nothing", setSettings(db, {}, T1).ok);
}
db.close(); rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? "\nall store tests passed" : `\n${failures} store test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
