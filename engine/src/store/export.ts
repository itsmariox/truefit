// Export and import of everything the user owns (phase 2f, PRD 15 / 06 / 14). ONE zip: the profile (as data and as a readable copy), the settings that are not secrets,
// the History table as CSV, and every job folder with all its files (ads, analyses, CV and extras versions). Never the API key, the Telegram token or any login,
// and not the Telegram pairing (it belongs to this Mac's token). An import is verified completely BEFORE anything changes; a bad file changes nothing.
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Zip, ZipDeflate, ZipPassThrough, strFromU8, strToU8, unzipSync } from "fflate";
import type { Db } from "./db.ts";
import { openDb } from "./db.ts";
import { migrate } from "./migrate.ts";
import { MIGRATIONS } from "./schema.ts";
import { PROFILE_SCHEMA_VERSION, validateProfile, type Profile } from "../profile.ts";
import { PROFILE_FORMAT_LATEST, loadProfile, loadProfileV2 } from "./profile-store.ts";
import { isV2, toV1View, validateProfile2, type Profile2 } from "../profile-v2.ts";
import { getSettings, SETTINGS } from "./settings-store.ts";
import { allJobs, historyCsv, rebuildIndex } from "./jobs-index.ts";
import { createBackup } from "./backup.ts";
import { jobFolders, runningJobs } from "./delete.ts";

export const EXPORT_FORMAT = 1;
export const LIMITS = { entries: 20_000, fileBytes: 50_000_000, totalBytes: 500_000_000, nameLen: 120 };
const NAME = /^[a-z0-9][a-z0-9._-]*$/i;
const FIXED = new Set(["profile.json", "profile.md", "settings.json", "history.csv"]);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, "-");
// The Telegram pairing and the way THIS Mac connects to Claude (mode, notice) describe this Mac, not the user's data: never exported, never imported.
const exportable = (k: string) => k in SETTINGS && !k.startsWith("telegram.") && !k.startsWith("claude.") && !k.startsWith("ai.") && !k.startsWith("openai.");

type Manifest = { exportFormat: number; createdAt: string; dbFormat: number; jobs: number; files: { path: string; size: number; sha256: string }[] };
type Files = Map<string, Uint8Array>;

// ---------- a readable copy of the profile ----------
export function profileToReadable(p: Profile): string {
  const L: string[] = ["# My profile", "", "A readable copy. The app reads profile.json, not this file.", "", "## About me", `- Name: ${p.identity.name}`, `- Based in: ${p.identity.city}, ${p.identity.country}`];
  if (p.identity.email) L.push(`- Email: ${p.identity.email}`); if (p.identity.phone) L.push(`- Phone: ${p.identity.phone}`); if (p.identity.linkedin) L.push(`- LinkedIn: ${p.identity.linkedin}`);
  const ym = (x: unknown) => { const v = x as { y?: number; m?: number } | string | undefined; return v && typeof v === "object" ? `${String(v.m).padStart(2, "0")}/${v.y}` : String(v ?? ""); };
  L.push("", "## Roles");
  for (const r of p.roles) { L.push("", `### ${r.title} at ${r.company} (${ym(r.start)} to ${ym(r.end)})`); for (const b of r.bullets) L.push(`- [${b.status}] ${b.text}${b.tags.length ? ` (${b.tags.join(", ")})` : ""}`); }
  L.push("", "## Skills", ...p.skills.map((s) => `- [${s.status}] ${s.name}${s.group ? ` (${s.group})` : ""}`), "", "## Education", ...p.education.map((e) => `- [${e.status}] ${e.text}`));
  L.push("", "## Focus types", ...p.focusTypes.map((f) => `- ${f.name}: ${f.headline} (${f.status})`));
  L.push("", "## Rules", `- Salary floor: ${p.rules.salaryFloor ? `${p.rules.salaryFloor.amount} ${p.rules.salaryFloor.currency}` : "none"}`, `- Based in: ${p.rules.location.current}; wants: ${p.rules.location.targets.join(", ")}; work modes: ${p.rules.location.workModes.join(", ")}`, `- Right to work: ${p.rules.rightToWork.statement}${p.rules.rightToWork.needsSponsorship ? " (needs sponsorship)" : ""}`);
  if (p.rules.seniority.levels.length || p.rules.seniority.avoid.length) L.push(`- Seniority: ${p.rules.seniority.levels.join(", ")}${p.rules.seniority.avoid.length ? `; avoid: ${p.rules.seniority.avoid.join(", ")}` : ""}`);
  if (p.rules.avoidRoles.length) L.push(`- Roles to avoid: ${p.rules.avoidRoles.join("; ")}`);
  if (p.rules.availability) L.push(`- Availability: ${p.rules.availability}`);
  if (p.doNotUse.length) L.push("", "## Do not use", ...p.doNotUse.map((d) => `- (${d.kind}) ${d.text}${d.note ? ` - ${d.note}` : ""}`));
  return L.join("\n") + "\n";
}

// ---------- export ----------
export async function exportAll(db: Db, jobsDir: string, outFile: string, o: { now: Date }): Promise<{ ok: true; jobs: number; files: number; bytes: number; skipped: { folder: string; reason: string }[]; warnings: string[] } | { ok: false; error: string }> {
  const files: Files = new Map(), skipped: { folder: string; reason: string }[] = [], warnings: string[] = [];
  const prof = loadProfileV2(db);
  // The export carries the v2 profile WITHOUT the stored CV text and WITHOUT the change log (both stay on this Mac; decision C of the schema spec).
  if (prof.status === "ok") { const exp: Profile2 = { ...prof.profile, sources: prof.profile.sources.map(({ text: _t, ...s }) => { void _t; return s; }), log: [] }; files.set("profile.json", strToU8(JSON.stringify(exp, null, 2))); files.set("profile.md", strToU8(profileToReadable(toV1View(prof.profile)))); }
  else if (prof.status !== "none") warnings.push(`the profile was left out of the export: ${prof.status === "damaged" ? prof.reason : "it was written by a newer version of the app"}`);
  const settings = Object.fromEntries(Object.entries(getSettings(db).settings).filter(([k]) => exportable(k)));
  files.set("settings.json", strToU8(JSON.stringify(settings, null, 2)));
  // The History table is built from the job folders themselves (the folders are the truth), not from the index.
  const scratch = openDb(":memory:"); migrate(scratch, MIGRATIONS);
  const idx = await rebuildIndex(scratch, jobsDir);
  const rows = allJobs(scratch); files.set("history.csv", strToU8(historyCsv(rows))); scratch.close();
  skipped.push(...idx.skipped);
  const okFolders = new Set(rows.map((r) => r.folder));
  let total = 0;
  for (const folder of (await readdir(jobsDir).catch(() => [] as string[])).sort()) {
    if (!okFolders.has(folder)) continue;
    if (!NAME.test(folder) || folder.length > LIMITS.nameLen) { skipped.push({ folder, reason: "the folder name has characters that cannot be exported" }); continue; }
    for (const f of (await readdir(path.join(jobsDir, folder))).sort()) {
      if (f.startsWith(".") || f.endsWith(".tmp")) continue;
      const full = path.join(jobsDir, folder, f), st = await stat(full);
      if (st.isDirectory()) return { ok: false, error: `job ${folder} contains a folder (${f}); this version of the export cannot include it` };
      if (!NAME.test(f) || f.length > LIMITS.nameLen) { skipped.push({ folder: `${folder}/${f}`, reason: "the file name has characters that cannot be exported" }); continue; }
      if (st.size > LIMITS.fileBytes) return { ok: false, error: `a file in job ${folder} is larger than ${LIMITS.fileBytes / 1e6} MB (${f})` };
      total += st.size; if (total > LIMITS.totalBytes) return { ok: false, error: `the export would be larger than ${LIMITS.totalBytes / 1e6} MB` };
      let data = new Uint8Array(await readFile(full));
      if (f === "status.json") { // the job state records this Mac's folder path (it holds the user name): never put that in a file that is shared
        try { const j = JSON.parse(strFromU8(data)); delete j.dir; data = strToU8(JSON.stringify(j, null, 2)); } catch { /* an unreadable status file was already skipped above */ }
      }
      files.set(`jobs/${folder}/${f}`, data);
    }
  }
  const jobCount = new Set([...files.keys()].filter((k) => k.startsWith("jobs/")).map((k) => k.split("/")[1])).size;
  const manifest: Manifest = { exportFormat: EXPORT_FORMAT, createdAt: o.now.toISOString(), dbFormat: MIGRATIONS.length, jobs: jobCount, files: [...files].map(([p, b]) => ({ path: p, size: b.length, sha256: sha(b) })) };
  try {
    const chunks: Uint8Array[] = [];
    await new Promise<void>((resolve, reject) => {
      const z = new Zip((err, chunk, final) => { if (err) reject(err); else { chunks.push(chunk); if (final) resolve(); } });
      const add = (name: string, data: Uint8Array) => { const e = /\.pdf$/.test(name) ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 }); z.add(e); e.push(data, true); };
      add("cvapp-export.json", strToU8(JSON.stringify(manifest, null, 2)));
      for (const [p, b] of files) add(p, b);
      z.end();
    });
    const out = Buffer.concat(chunks);
    await mkdir(path.dirname(outFile), { recursive: true });
    const tmp = outFile + ".tmp"; await writeFile(tmp, out, { mode: 0o600 }); await rename(tmp, outFile); await chmod(outFile, 0o600);
    return { ok: true, jobs: jobCount, files: files.size + 1, bytes: out.length, skipped, warnings };
  } catch (e) { return { ok: false, error: `could not write the export: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}` }; }
}

// ---------- reading and checking an export ----------
type Read = { ok: true; manifest: Manifest; files: Files; profile: Profile | Profile2 | null; settings: Record<string, unknown> } | { ok: false; problems: string[] };
export async function readExport(zipFile: string, limits = LIMITS): Promise<Read> {
  let raw: Uint8Array;
  try { raw = new Uint8Array(await readFile(zipFile)); } catch { return { ok: false, problems: ["the file cannot be read"] }; }
  if (raw.length > limits.totalBytes) return { ok: false, problems: ["the file is too large to be one of our exports"] };
  const names: string[] = []; let declared = 0, tooBig: string | null = null, count = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(raw, { filter: (f) => { names.push(f.name); count++; declared += f.originalSize; if (f.originalSize > limits.fileBytes) tooBig = `${f.name} is too large`; if (count > limits.entries || declared > limits.totalBytes) tooBig = "the archive holds too much data"; return !tooBig; } });
  } catch { return { ok: false, problems: ["the file is not a valid export (it cannot be unpacked)"] }; }
  if (tooBig) return { ok: false, problems: [tooBig] };
  const problems: string[] = [];
  if (new Set(names).size !== names.length) problems.push("the archive lists the same file name twice");
  const files: Files = new Map();
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith("/")) continue; // folder entries carry no data
    const parts = name.split("/");
    const safe = !name.includes("\\") && !name.includes("\0") && !name.startsWith("/") && parts.every((p) => p !== "" && p !== "." && p !== ".." && NAME.test(p) && p.length <= limits.nameLen);
    const allowed = name === "cvapp-export.json" || FIXED.has(name) || (parts[0] === "jobs" && parts.length === 3);
    if (!safe || !allowed) { problems.push(`an unexpected or unsafe file path in the archive: ${name.slice(0, 60).replace(/[^\x20-\x7e]/g, "?")}`); continue; }
    files.set(name, data);
  }
  if (problems.length) return { ok: false, problems };
  const mraw = files.get("cvapp-export.json"); if (!mraw) return { ok: false, problems: ["this is not an export from this app (no manifest)"] };
  let m: Manifest; try { m = JSON.parse(strFromU8(mraw)); } catch { return { ok: false, problems: ["the manifest cannot be read"] }; }
  if (!m || typeof m.exportFormat !== "number" || !Array.isArray(m.files) || typeof m.createdAt !== "string") return { ok: false, problems: ["the manifest is incomplete"] };
  if (m.exportFormat > EXPORT_FORMAT) return { ok: false, problems: ["this export was made by a newer version of the app: update the app"] };
  const listed = new Map<string, { size: number; sha256: string }>();
  for (const f of m.files) { if (!f || typeof f.path !== "string" || typeof f.size !== "number" || typeof f.sha256 !== "string" || listed.has(f.path)) { problems.push("the manifest has a bad or repeated entry"); break; } listed.set(f.path, f); }
  for (const p of files.keys()) if (p !== "cvapp-export.json" && !listed.has(p)) problems.push(`a file that the manifest does not list: ${p.slice(0, 60)}`);
  for (const [p, f] of listed) { const b = files.get(p); if (!b) problems.push(`a listed file is missing: ${p.slice(0, 60)}`); else if (b.length !== f.size || sha(b) !== f.sha256) problems.push(`a file was changed or damaged: ${p.slice(0, 60)}`); }
  if (problems.length) return { ok: false, problems: problems.slice(0, 8) };
  let profile: Profile | Profile2 | null = null;
  if (files.has("profile.json")) {
    try { profile = JSON.parse(strFromU8(files.get("profile.json")!)); } catch { return { ok: false, problems: ["profile.json cannot be read"] }; }
    const errs = isV2(profile) ? validateProfile2(profile, { requireDates: false }) : validateProfile(profile as Profile, { requireDates: false });
    if (errs.length) return { ok: false, problems: [`the profile in the export is not valid: ${errs[0]}`] };
  }
  let settings: Record<string, unknown> = {};
  if (files.has("settings.json")) { try { settings = JSON.parse(strFromU8(files.get("settings.json")!)); } catch { return { ok: false, problems: ["settings.json cannot be read"] }; } if (!settings || typeof settings !== "object" || Array.isArray(settings)) return { ok: false, problems: ["settings.json is not a settings file"] }; }
  const folders = new Set<string>();
  for (const p of files.keys()) if (p.startsWith("jobs/")) folders.add(p.split("/")[1]);
  for (const f of folders) {
    const st = files.get(`jobs/${f}/status.json`);
    try { const s = JSON.parse(strFromU8(st ?? new Uint8Array())); if (typeof s.id !== "string" || typeof s.status !== "string" || typeof s.created !== "string" || typeof s.updated !== "string") throw 0; } catch { return { ok: false, problems: [`job ${f.slice(0, 60)} has no readable status file`] }; }
  }
  return { ok: true, manifest: m, files, profile, settings };
}

export async function inspectExport(zipFile: string, limits = LIMITS) {
  const r = await readExport(zipFile, limits);
  if (!r.ok) return r;
  const jobs = new Set([...r.files.keys()].filter((k) => k.startsWith("jobs/")).map((k) => k.split("/")[1])).size;
  return { ok: true as const, summary: { createdAt: r.manifest.createdAt, exportFormat: r.manifest.exportFormat, hasProfile: !!r.profile, jobs, files: r.files.size, settings: Object.keys(r.settings).filter(exportable).length } };
}

// ---------- import: "Replace everything" ----------
export type ImportResult =
  | { ok: true; jobs: number; profile: boolean; settings: number }
  | { ok: false; error?: string; problems?: string[]; needsConfirmation?: { replacesProfile: boolean; replacesJobs: number } };
export async function importExport(o: { zipFile: string; db: Db; jobsDir: string; backupsDir: string; now: Date; confirmReplace: boolean; limits?: typeof LIMITS; afterSwap?: () => void }): Promise<ImportResult> {
  const r = await readExport(o.zipFile, o.limits);
  if (!r.ok) return { ok: false, problems: r.problems };
  const busy = runningJobs((await jobFolders(o.jobsDir)).jobs);
  if (busy.length) return { ok: false, error: `${busy.length} job(s) are still running: stop them first; nothing was changed` };
  const existingJobs = (await readdir(o.jobsDir).catch(() => [] as string[])).filter((n) => !n.startsWith(".")).length;
  const hasProfile = loadProfile(o.db).status !== "none";
  if ((hasProfile || existingJobs) && !o.confirmReplace) return { ok: false, needsConfirmation: { replacesProfile: hasProfile, replacesJobs: existingJobs } };
  const b = await createBackup(o.db, o.backupsDir, { reason: "pre-import", now: o.now });
  if (!b.ok) return { ok: false, error: `no backup of your current profile could be made first (${b.error}); nothing was changed` };
  const id = stamp(o.now), staging = `${o.jobsDir}.import-${id}`, replaced = `${o.jobsDir}.replaced-${id}`;
  const jobFiles = [...r.files].filter(([p]) => p.startsWith("jobs/"));
  try {
    await mkdir(staging, { recursive: true, mode: 0o700 });
    for (const [p, data] of jobFiles) { const [, folder, name] = p.split("/"); await mkdir(path.join(staging, folder), { recursive: true, mode: 0o700 }); await writeFile(path.join(staging, folder, name), data, { mode: 0o600 }); }
  } catch (e) { await rm(staging, { recursive: true, force: true }); return { ok: false, error: `could not unpack the export: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}; nothing was changed` }; }
  let hadJobsDir = true;
  try { await rename(o.jobsDir, replaced); } catch { hadJobsDir = false; }
  try { await rename(staging, o.jobsDir); } catch (e) { if (hadJobsDir) await rename(replaced, o.jobsDir).catch(() => undefined); await rm(staging, { recursive: true, force: true }); return { ok: false, error: `could not put the jobs in place: ${(e as Error).message}; nothing was changed` }; }
  const settings = Object.entries(r.settings).filter(([k, v]) => exportable(k) && (SETTINGS as Record<string, { ok: (v: unknown) => boolean }>)[k].ok(v));
  try {
    o.afterSwap?.();
    o.db.transaction(() => {
      o.db.exec("DELETE FROM profile; DELETE FROM settings WHERE key NOT LIKE 'telegram.%' AND key NOT LIKE 'claude.%' AND key NOT LIKE 'ai.%' AND key NOT LIKE 'openai.%';");
      if (r.profile) o.db.run("INSERT INTO profile(id, doc, profile_format, updated_at) VALUES (1, ?, ?, ?)", JSON.stringify(r.profile), isV2(r.profile) ? PROFILE_FORMAT_LATEST : PROFILE_SCHEMA_VERSION, o.now.toISOString());
      for (const [k, v] of settings) o.db.run("INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)", k, JSON.stringify(v), o.now.toISOString());
    });
  } catch (e) { // put the old jobs back: the database transaction already rolled back
    await rm(o.jobsDir, { recursive: true, force: true }); if (hadJobsDir) await rename(replaced, o.jobsDir).catch(() => undefined);
    return { ok: false, error: `could not save the imported data: ${(e as Error).message}; nothing was changed` };
  }
  await rebuildIndex(o.db, o.jobsDir);
  await rm(replaced, { recursive: true, force: true }); // "Replace everything" really removes the old jobs, only after the new ones are in place
  return { ok: true, jobs: new Set(jobFiles.map(([p]) => p.split("/")[1])).size, profile: !!r.profile, settings: settings.length };
}
