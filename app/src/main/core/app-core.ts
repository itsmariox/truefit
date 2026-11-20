// The app core (phase 4d): the engine put together for the main process. It has NO Electron import: everything it needs from the outside (the secret store, the Claude query
// function, the status runner, the PDF renderer, timers) is passed in, so all of it is tested in plain Node with fakes. The IPC channels and the screens (4e, 4f) call this.
//
//   startApp()   open the data folder and say what happened (ready, damaged, too new, upgrade failed), never opening anything unsafe
//   AppCore      the running app: access (connect, sign in, test), profile, jobs through the queue, backups on a schedule, a clean shutdown
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { createAccessRuntime } from "../../../../engine/src/access/runtime.ts";
import { localAdCheck } from "../../../../engine/src/access/adgate.ts";
import { connectWithKey, testConnection, type TestResult } from "../../../../engine/src/access/connect.ts";
import { createSignIn, type SignInEvent, type SignInHandle, type SignInResult } from "../../../../engine/src/access/signin.ts";
import { createOpenAISignIn, type OpenAISignInEvent, type OpenAISignInHandle, type OpenAISignInResult } from "../../../../engine/src/access/openai-signin.ts";
import { connectWithOpenAIKey, testOpenAIConnection } from "../../../../engine/src/access/openai-connect.ts";
import { OPENAI_AUTH_BASE } from "../../../../engine/src/access/openai-plan.ts";
import { SECRET_NAMES } from "../../../../engine/src/store/secrets.ts";
import type { Provider } from "../../../../engine/src/access/state.ts";
import { APP_NAME } from "../../shared/contract.ts";
import { describeOtherService, otherService } from "../../../../engine/src/access/job-service.ts";
import { checkLoginStatus, type StatusRunner } from "../../../../engine/src/access/status.ts";
import { type Timers, type WatchEvent, type WatchHandle } from "../../../../engine/src/access/watch.ts";
import type { AccessState } from "../../../../engine/src/access/state.ts";
import { minimalEnv } from "../../../../engine/src/agents/options.ts";
import type { QueryFn, RunnerDeps } from "../../../../engine/src/agents/runner.ts";
import { EXTRAS, type Extra, coachMessage, createPipeline, StepError, type JobState, type PipelineConfig } from "../../../../engine/src/pipeline.ts";
import { meetsStartGate, type Profile } from "../../../../engine/src/profile.ts";
import type { PdfRenderer } from "../../../../engine/src/cv/render.ts";
import type { FontUrls } from "../../../../engine/src/cv/html.ts";
import { describePause as catalogue, type PauseKind } from "../../../../engine/src/access/messages.ts";
import type { Db } from "../../../../engine/src/store/db.ts";
import { BACKUPS_DIR, JOBS_DIR, openStore, recoverFromBackup, startFresh } from "../../../../engine/src/store/open.ts";
import { loadProfile, loadProfileV2, saveProfile, saveProfileV2 } from "../../../../engine/src/store/profile-store.ts";
import { migrateV1ToV2, toV1View } from "../../../../engine/src/profile-v2.ts";
import { mergeImportV2 } from "../../../../engine/src/profile-import-v2.ts";
import { applyCardAction, reviewCards } from "../../../../engine/src/profile-review.ts";
import { getSettings, setSettings, type Settings } from "../../../../engine/src/store/settings-store.ts";
import { allJobs, searchJobs, upsertJob, type HistoryQuery } from "../../../../engine/src/store/jobs-index.ts";
import { createBackup, scheduledBackup, type BackupInfo } from "../../../../engine/src/store/backup.ts";
import { deleteEverything } from "../../../../engine/src/store/delete.ts";
import type { SecretStore } from "../../../../engine/src/store/secrets.ts";
import { createTelegramService } from "./telegram-service.ts";
import { EXIT } from "../../../../engine/src/agents/errors.ts";
import { maskForImport } from "../../../../engine/src/profile-import.ts";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { createQueue, type QueueSnapshot, type TaskOutcome } from "./queue.ts";

export type CoreDeps = {
  dataDir: string; now?: () => Date; log?: (line: string) => void;
  secrets: SecretStore; query: QueryFn; statusRunner: StatusRunner; claudeBinary: string | null;
  renderer: PdfRenderer; fonts: FontUrls;
  base: Omit<RunnerDeps, "profile" | "query" | "mode" | "apiKey" | "beforeCall" | "onUsage">;
  pipelineConfig: PipelineConfig; maxAdChars?: number;
  timers?: Timers; backupEveryMs?: number;
  openUrl?: (url: string) => Promise<void>;                                   // opens a link in the user's browser (the shell passes it); the core only ever hands it the OpenAI sign-in address
  openai?: { fetch?: typeof fetch; baseUrl?: string; authBase?: string };     // where OpenAI is (tests point these at a pretend local service; never set in the product)
  keychainKey?: { remove(): Promise<string | null> };
  tmpDir?: string; fetchImpl?: typeof fetch;
};

export type StartNotes = { leftovers: string[]; index: { indexed: number; skipped: { folder: string; reason: string }[] }; profile: "none" | "ok" | "damaged" | "too-new"; backups: BackupInfo[]; created: boolean; migrated: string[] };
export type StartResult =
  | { status: "ready"; core: AppCore; notes: StartNotes }
  | { status: "damaged"; reason: string; backups: BackupInfo[]; recover(file: string): Promise<StartResult>; startFresh(): Promise<StartResult> }
  | { status: "too-new"; message: string }
  | { status: "upgrade-failed"; message: string; backups: BackupInfo[]; recover(file: string): Promise<StartResult> };

export async function startApp(d: CoreDeps): Promise<StartResult> {
  const now = d.now ?? (() => new Date());
  await mkdir(d.dataDir, { recursive: true, mode: 0o700 });
  const o = await openStore(d.dataDir, { now: now() });
  if (o.status === "too-new") return { status: "too-new", message: o.message };
  const recover = async (file: string) => { const r = await recoverFromBackup(d.dataDir, file, { now: now() }); if (!r.ok) throw new Error(r.error); r.db.close(); return startApp(d); };
  if (o.status === "upgrade-failed") return { status: "upgrade-failed", message: o.message, backups: o.backups, recover };
  if (o.status === "damaged") return {
    status: "damaged", reason: o.reason, backups: o.backups,
    recover,
    async startFresh() { const r = await startFresh(d.dataDir, { now: now(), confirmed: true }); if (!r.ok) throw new Error(r.error); r.db.close(); return startApp(d); },
  };
  // A profile still stored as v1 is backed up ONCE before anything can rewrite it as v2 (reading never writes; the first save or import does).
  { const pf = o.db.get<{ profile_format: number }>("SELECT profile_format FROM profile WHERE id = 1"); if (pf && pf.profile_format < 2) { const b = await createBackup(o.db, path.join(d.dataDir, BACKUPS_DIR), { reason: "pre-migration", now: now() }); if (!b.ok) d.log?.("the backup before the profile format change could not be made"); } }
  const core = await createCore(d, o.db);
  return { status: "ready", core, notes: { leftovers: o.leftovers, index: o.index, profile: o.profile, backups: o.backups, created: o.created, migrated: o.migrated } };
}

export type CreateJobResult = { ok: true; job: JobState } | { ok: false; reason: "no_profile" | "profile_incomplete" | "too_long" | "empty" | "too_short" | "not_a_job"; missing?: string[] } | { ok: false; reason: "duplicate"; existing: JobState };
export type AnalyseResult = { ok: true; state: string } | { ok: false; reason: "no_profile" | "profile_incomplete" | "not_found" | "already_active" | "other_service"; missing?: string[]; note?: string };
export type CoreEvent =
  | { type: "queue"; snapshot: QueueSnapshot }
  | { type: "job"; job: JobState }
  | { type: "step"; jobId: string; scope: string; name: string; phase: "start" | "done" }  // which agent is working now (for the page to show)
  | { type: "recovery"; event: WatchEvent["type"] };       // "recovered" or "can_try": Claude works again, the user may press Resume
export type AppCore = Awaited<ReturnType<typeof createCore>>;

const PAUSE_KINDS: PauseKind[] = ["auth", "rate_limit", "unavailable", "account", "timeout", "cap"];
// A paused job's note IS the title of its pause message (one set of words), so after a restart the kind can be read back from it.
export const kindFromNote = (note: string | undefined): PauseKind => PAUSE_KINDS.find((k) => note === catalogue(k, { now: new Date(0) }).title + ".") ?? "other";
const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
const hashText = (t: string) => createHash("sha256").update(norm(t)).digest("hex");

async function createCore(d: CoreDeps, db: Db) {
  const now = d.now ?? (() => new Date()), log = d.log ?? (() => undefined), jobsDir = path.join(d.dataDir, JOBS_DIR), backupsDir = path.join(d.dataDir, BACKUPS_DIR);
  const listeners = new Set<(e: CoreEvent) => void>(); const emit = (e: CoreEvent) => { for (const l of [...listeners]) { try { l(e); } catch { /* a screen's handler never breaks the core */ } } };
  let profile: Profile | null = (() => { const p = loadProfile(db); return p.status === "ok" ? p.profile : null; })();
  let shuttingDown = false, watcher: WatchHandle | null = null, signIn: SignInHandle | null = null;

  // ---- access ----
  const runtime = createAccessRuntime({ db, secrets: d.secrets, statusRunner: d.statusRunner, query: d.query, now, timers: d.timers, base: d.base, openai: d.openai });
  const authBase = d.openai?.authBase ?? OPENAI_AUTH_BASE;
  let openaiSignInHandle: OpenAISignInHandle | null = null;
  // The ChatGPT sign-in opens ONLY an address on the sign-in service itself (a link built by the flow, checked again here).
  const openaiSignIn = createOpenAISignIn({ store: runtime.planStore, secrets: d.secrets, appName: APP_NAME, fetch: d.openai?.fetch, authBase, now,
    openUrl: async (url) => { if (!url.startsWith(`${authBase}/api/accounts/authorize?`)) throw new Error("blocked"); if (!d.openUrl) throw new Error("no browser"); await d.openUrl(url); }, onSignedIn: () => runtime.access.signedIn() });
  const statusCheck = () => checkLoginStatus(d.statusRunner, minimalEnv(d.base.env ?? process.env, { configDir: d.base.configDir }));
  const signInController = d.claudeBinary ? createSignIn({ binary: d.claudeBinary, env: minimalEnv(d.base.env ?? process.env, { configDir: d.base.configDir }), confirm: statusCheck, onSignedIn: () => runtime.access.signedIn() }) : null;

  // ---- pipeline (rebuilt when the profile changes) ----
  const makePipeline = (p: Profile) => createPipeline({ jobsDir, profile: p, runnerFor: runtime.runnerFor, renderer: d.renderer, fonts: d.fonts, config: d.pipelineConfig, now, onStep: (e) => emit({ type: "step", ...e }), onJobChange: (j) => { try { upsertJob(db, j); } catch (e) { log(`index update failed (${(e as Error).name})`); } emit({ type: "job", job: j }); } });
  let pipeline = profile ? makePipeline(profile) : null;
  const gate = (): { ok: true } | { ok: false; reason: "no_profile" | "profile_incomplete"; missing?: string[] } => { if (!profile || !pipeline) return { ok: false, reason: "no_profile" }; const g = meetsStartGate(profile); return g.ok ? { ok: true } : { ok: false, reason: "profile_incomplete", missing: g.missing }; };

  // A job is carried on only by the service that started it: refuse (in plain words) before anything is queued.
  const serviceGuard = (job: JobState): { ok: false; reason: "other_service"; note: string } | null => { const cur = runtime.access.provider(), started = otherService(job.dir, cur); return started ? { ok: false, reason: "other_service", note: describeOtherService(started, cur) } : null; };

  // ---- queue ----
  const queue = createQueue({ onChange: (snapshot) => emit({ type: "queue", snapshot }), onError: (e) => log(`queue error (${(e as Error)?.name})`) });
  const stopWatcher = () => { watcher?.stop(); watcher = null; };
  async function startWatcher(kind: string) {
    stopWatcher();
    const w = runtime.watchPause(kind as never, (e) => { if (e.type === "recovered" || e.type === "can_try") emit({ type: "recovery", event: e.type }); }, {});
    if (w) watcher = await w;
  }
  const fresh = async (id: string): Promise<JobState | null> => (await pipeline?.listJobs())?.find((j) => j.id === id) ?? null;
  // One queue task per job action; a pause from the pipeline becomes a "paused" outcome (and starts the recovery watcher), anything else a plain failure.
  type Action = { kind: "analyse" } | { kind: "resume" } | { kind: "build"; opts: { layout?: "shorter" | "anyway"; ignoreQuestions?: boolean; refreshProfile?: boolean } } | { kind: "extra"; extra: Extra };
  const taskFor = (id: string, label: string, action: "analyse" | "resume" | Action): Parameters<typeof queue.enqueue>[0] => {
    const act: Action = typeof action === "string" ? (action === "analyse" ? { kind: "analyse" } : { kind: "resume" }) : action;
    return { id, label, run: async (): Promise<TaskOutcome> => {
      const job = await fresh(id); if (!job || !pipeline) return { status: "failed", reason: "This job could not be found." };
      try {
        if (act.kind === "analyse") await pipeline.analyse(job);
        else if (act.kind === "resume") await pipeline.resume(job);
        else if (act.kind === "extra") await pipeline.extra(job, act.extra);
        else {
          const r = await pipeline.build(job, act.opts);
          if (r.status === "needs_input") { stopWatcher(); return { status: "needs_input" }; }
          if (r.status === "failed") { stopWatcher(); return { status: "failed", reason: "The CV did not pass the checks." }; }
        }
        stopWatcher(); return { status: "done" };
      } catch (e) {
        if (e instanceof StepError && e.pausable) { void startWatcher(e.kind).catch(() => undefined); return { status: "paused", kind: e.kind }; }
        if (e instanceof StepError && e.job?.status === "needs_input") return { status: "needs_input" };
        return { status: "failed", reason: "This job did not finish." };
      }
    } };
  };
  const labelOf = (j: JobState) => [j.company, j.role].filter(Boolean).join(", ") || "New job";

  // ---- backups on a schedule ----
  let backupTimer: unknown = null; const timers: Timers = d.timers ?? { setTimeout: (f, ms) => { const t = setTimeout(f, ms); (t as { unref?: () => void }).unref?.(); return t; }, clearTimeout: (h) => clearTimeout(h as never) };
  const backupNow = async () => { try { return await scheduledBackup(db, backupsDir, now()); } catch (e) { log(`backup failed (${(e as Error).name})`); return null; } };
  const loopBackup = () => { if (shuttingDown) return; backupTimer = timers.setTimeout(async () => { backupTimer = null; await backupNow(); loopBackup(); }, d.backupEveryMs ?? 3_600_000); };

  // ---- start-up recovery: interrupted jobs are NOT run; paused jobs from before block the queue again ----
  const needsAttention: JobState[] = [];
  if (pipeline) {
    for (const j of await pipeline.recoverInterrupted()) needsAttention.push(j);
    for (const j of await pipeline.listJobs()) if (j.status === "paused" || j.status === "interrupted" || j.status === "needs_input") {
      if (j.status === "paused") queue.adopt(taskFor(j.id, labelOf(j), "resume"), "paused", kindFromNote(j.note));
      else if (j.status === "needs_input") queue.adopt(taskFor(j.id, labelOf(j), "resume"), "needs_input");
    }
  }

  // The Telegram bot gets a pipeline whose long steps (analyse, build, extra) run THROUGH the app queue: one job at a time for the whole app, visible in the app, blocked by a paused job
  // like any other, and refused (an error the bot reports) when that job is already queued or running. The bot still gets the pipeline's own result or error.
  const viaQueue = (pl: NonNullable<typeof pipeline>): typeof pl => {
    const run = <A extends unknown[], R extends { job: JobState }>(name: string, fn: (job: JobState, ...a: A) => Promise<R>) => (job: JobState, ...a: A): Promise<R> => new Promise<R>((resolve, reject) => {
      const r = queue.enqueue({ id: job.id, label: labelOf(job), run: async (): Promise<TaskOutcome> => { try { resolve(await fn(job, ...a)); return { status: "done" }; } catch (e) { reject(e); return e instanceof StepError && e.pausable ? { status: "paused", kind: e.kind } : { status: "failed", reason: "This job did not finish." }; } } });
      if (!r.accepted) reject(new Error(`this job is already ${r.state}`)); void name;
    });
    return { ...pl, analyse: run("analyse", pl.analyse), build: run("build", pl.build as never) as never, extra: ((job: JobState, kind: Extra) => new Promise<string>((resolve, reject) => { const r = queue.enqueue({ id: job.id, label: labelOf(job), run: async (): Promise<TaskOutcome> => { try { resolve(await pl.extra(job, kind)); return { status: "done" }; } catch (e) { reject(e); return { status: "failed", reason: "This job did not finish." }; } } }); if (!r.accepted) reject(new Error(`this job is already ${r.state}`)); })) as never };
  };
  // ---- Telegram (optional): its own state folder; started only when a token AND a pairing exist ----
  await mkdir(path.join(d.dataDir, "telegram"), { recursive: true, mode: 0o700 });
  const telegram = createTelegramService({ secrets: d.secrets, settings: { get: () => getSettings(db).settings, set: (p) => setSettings(db, p as never, now()) }, pipeline: () => (pipeline ? viaQueue(pipeline) : null), stateDir: path.join(d.dataDir, "telegram"), log, fetchImpl: d.fetchImpl });
  void telegram.start().catch(() => undefined);

  const core = {
    telegram, telegramPipeline: () => (pipeline ? viaQueue(pipeline) : null),
    db, dataDir: d.dataDir, jobsDir,
    needsAttention: () => needsAttention.slice(),
    onEvent(l: (e: CoreEvent) => void): () => void { listeners.add(l); return () => listeners.delete(l); },
    settings: { get: () => getSettings(db), set: (patch: Partial<Settings>) => setSettings(db, patch, now()) },

    access: {
      state: (): Promise<AccessState> => runtime.access.state(),
      provider: (): Provider => runtime.access.provider(),
      chooseProvider: (p: Provider) => runtime.access.chooseProvider(p),
      chooseMode: (m: "subscription" | "apiKey" | null) => runtime.access.chooseMode(m),
      acceptNotice: () => runtime.access.acceptNotice(),
      describePause: (kind: Parameters<typeof runtime.describePause>[0]) => runtime.describePause(kind),
      saveKey: (key: string) => runtime.access.provider() === "openai"
        ? connectWithOpenAIKey(key, { makeProvider: (k) => d.base.provider ?? runtime.openaiKeyProvider(k), db, access: runtime.access, now }) // a fake provider (test build) is used for the key check too, so a test never calls the real service
        : connectWithKey(key, { query: d.query, env: d.base.env, db, access: runtime.access, now, tmpRoot: d.tmpDir }),
      async testConnection(): Promise<TestResult | { ok: false; kind: "not_chosen" }> {
        const mode = getSettings(db).settings["claude.mode"]; if (!mode) return { ok: false, kind: "not_chosen" };
        let r: TestResult;
        if (runtime.access.provider() === "openai") {
          let provider = d.base.provider ?? runtime.openaiProvider;
          if (mode === "apiKey" && !d.base.provider) { let k: string | null = null; try { k = await d.secrets.get(SECRET_NAMES.openaiApiKey); } catch { return { ok: false, kind: "not_started", why: "the saved key could not be read" }; } if (!k) return { ok: false, kind: "not_started", why: "no API key is saved" }; provider = runtime.openaiKeyProvider(k); }
          r = await testOpenAIConnection({ provider, mode, db, now });
        } else {
          let apiKey: string | undefined; if (mode === "apiKey") { try { apiKey = (await d.secrets.get("claude-api-key")) ?? undefined; } catch { return { ok: false, kind: "not_started", why: "the saved key could not be read" }; } }
          r = await testConnection({ query: d.query, mode, apiKey, env: d.base.env, configDir: d.base.configDir, db, now, tmpRoot: d.tmpDir });
        }
        if (r.ok) runtime.access.recordSuccess(); else if (r.kind === "access" && r.error) runtime.access.recordError(r.error);
        return r;
      },
      // Claude: the bundled program signs in. OpenAI ("Connect ChatGPT"): our own OAuth flow. Both report the same plain events; the result type tells which it was.
      startSignIn(onEvent: (e: SignInEvent | OpenAISignInEvent) => void): Promise<SignInResult | OpenAISignInResult> {
        if (runtime.access.provider() === "openai") {
          const h = openaiSignInHandle = openaiSignIn.start(onEvent);
          return h.done.finally(() => { if (openaiSignInHandle === h) openaiSignInHandle = null; });
        }
        if (!signInController) return Promise.resolve({ ok: false, reason: "not_runnable" });
        signIn = signInController.start(onEvent as (e: SignInEvent) => void); const h = signIn;
        return h.done.finally(() => { if (signIn === h) signIn = null; });
      },
      cancelSignIn: () => { signIn?.cancel(); openaiSignInHandle?.cancel(); },
      submitCode: (code: string) => signIn?.submitCode(code) ?? false,
      // Disconnect ChatGPT: end the session at OpenAI (best effort), then ALWAYS clear the saved sign-in. The Claude side has no such action.
      async signOutOpenAI(forget = false): Promise<{ cleared: boolean; revoked: boolean }> { const r = await openaiSignIn.signOut({ forget }); runtime.access.signedIn(); return { cleared: r.cleared, revoked: r.revoked }; },
    },

    profile: {
      get: () => profile,
      // CV import (phase 5b): the text (contact details removed by code) goes to Claude once; the answer is merged into a COPY of the profile as DRAFT items and handed back WITHOUT saving: the
      // screen shows it as unsaved changes for the user to review. Nothing here ever marks anything verified.
      async importCv(raw: string): Promise<{ ok: true; profile: Profile; added: { roles: number; bullets: number; skills: number; education: number }; notFromCv: number; dropped: number; upgraded: number; proposedName: string | null; updatedAt: string } | { ok: false; reason: "too_short" | "claude"; kind?: "auth" | "rate_limit" | "unavailable" | "account" | "setup" | "isolation" | "other" }> {
        const text = maskForImport(raw); if (text.length < 80) return { ok: false, reason: "too_short" };
        const base: Profile = profile ? JSON.parse(JSON.stringify(profile)) : ({ schemaVersion: 1, identity: { name: "", city: "", country: "" }, roles: [], skills: [], education: [], focusTypes: [], doNotUse: [], rules: { salaryFloor: null, location: { current: "", targets: [], workModes: [], cvLocationLines: [] }, seniority: { levels: [], avoid: [] }, rightToWork: { statement: "", needsSponsorship: false }, avoidRoles: [] } } as Profile);
        const dir = await mkdtemp(path.join(d.tmpDir ?? os.tmpdir(), "cvapp-import-"));
        try {
          await writeFile(path.join(dir, "cv-source.txt"), text, { mode: 0o600 });
          const r = await runtime.runnerFor(base)(dir, "importer");
          if (r.code !== 0) { const kind = r.code === EXIT.auth ? "auth" : r.code === EXIT.rate_limit ? "rate_limit" : r.code === EXIT.unavailable ? "unavailable" : r.code === EXIT.account ? "account" : r.code === EXIT.setup ? "setup" : r.code === EXIT.isolation ? "isolation" : "other"; return { ok: false, reason: "claude", kind }; }
          const raw2 = JSON.parse(await readFile(path.join(dir, "import.json"), "utf8"));
          // The merge is code on this Mac: trust comes from a word-for-word match against the masked CV text, contacts and a proposed name come from the RAW text, never from Claude's answer.
          const stored = loadProfileV2(db), prev2 = stored.status === "ok" ? stored.profile : migrateV1ToV2(base, now().toISOString()), at = now();
          const m = mergeImportV2(prev2, raw2, raw, { label: `CV imported ${at.toISOString().slice(0, 10)}`, now: at.toISOString() });
          const saved = saveProfileV2(db, m.profile, at, { covers: d.fonts?.covers }); if (!saved.ok) return { ok: false, reason: "claude", kind: "other" };
          profile = toV1View(m.profile); pipeline = makePipeline(profile);
          return { ok: true, profile, added: m.added, notFromCv: m.notFromCv, dropped: m.dropped, upgraded: m.upgraded, proposedName: m.proposedName, updatedAt: at.toISOString() };
        } catch { return { ok: false, reason: "claude", kind: "other" }; } finally { await rm(dir, { recursive: true, force: true }); }
      },
      overview() { const r = loadProfileV2(db); return r.status === "ok" ? { cards: reviewCards(r.profile, now()).map(({ key, kind, message, options, factIds }) => ({ key, kind, message, options, factIds })), unchecked: [...(r.profile.review.unchecked ?? [])], sources: r.profile.sources.map(({ id, label, kind, addedAt }) => ({ id, label, kind, addedAt })) } : { cards: [], unchecked: [], sources: [] }; },
      // A card's button: the card is found from the STORED profile by its key; the page's own copy of it is never trusted.
      cardAction(key: string, action: "accept" | "dismiss" | "merge"): { ok: true; profile: Profile; updatedAt: string } | { ok: false; reason: "no_card" | "not_allowed" } {
        const r = loadProfileV2(db); if (r.status !== "ok") return { ok: false, reason: "no_card" };
        const at = now(); // ONE reading of the clock: the saved time we hand back must be exactly the stored one, or the next Save is refused as stale
        const a = applyCardAction(r.profile, key, action, at); if (!a.ok) return a;
        const saved = saveProfileV2(db, a.profile, at, { covers: d.fonts?.covers }); if (!saved.ok) return { ok: false, reason: "not_allowed" };
        profile = toV1View(a.profile); pipeline = makePipeline(profile); return { ok: true, profile, updatedAt: at.toISOString() };
      },
      updatedAt(): string | null { const r = loadProfileV2(db); return r.status === "ok" ? r.updatedAt : null; },
      save(p: Profile, covers?: (cp: number) => boolean) { const r = saveProfile(db, p, now(), { covers: covers ?? d.fonts?.covers }); if (r.ok) { profile = p; pipeline = makePipeline(p); } return r; },
    },

    jobs: {
      async create(adText: string, source: "text" | "link" = "text", url?: string, opts: { force?: boolean } = {}): Promise<CreateJobResult> {
        const g = gate(); if (!g.ok) return g;
        const text = adText.trim(); if (!text) return { ok: false, reason: "empty" };
        if (text.length > (d.maxAdChars ?? 30000)) return { ok: false, reason: "too_long" };
        const dup = await core.jobs.findDuplicate(text, url); if (dup) return { ok: false, reason: "duplicate", existing: dup };
        // Is it a job ad at all? A free local check first, then one small call on the cheapest model. "Try anyway" (force) skips both. Only a confident "no" ever stops anything.
        if (!opts.force) {
          if (source === "text" && !localAdCheck(text).ok) return { ok: false, reason: "too_short" };
          if ((await runtime.checkAd(text)).verdict === "not_job") return { ok: false, reason: "not_a_job" };
        }
        return { ok: true, job: await pipeline!.createJob(text, source, url) };
      },
      // The same link, or an ad with the same words (spacing and capitals ignored), is the same job: the screen opens the existing one.
      async findDuplicate(text: string, url?: string): Promise<JobState | null> {
        const h = hashText(text);
        for (const j of (await pipeline?.listJobs()) ?? []) {
          if (url && j.url && j.url === url) return j;
          const ad = await readFile(path.join(j.dir, "ad.md"), "utf8").catch(() => null);
          if (ad !== null && hashText(ad) === h) return j;
        }
        return null;
      },
      list: (q?: HistoryQuery) => searchJobs(db, q),
      all: () => allJobs(db),
      // The kind of a paused job: from the queue when it is there, else read back from the job's note.
      pauseKind: (job: JobState): PauseKind => { const k = queue.snapshot().entries.find((e) => e.id === job.id)?.kind; return (PAUSE_KINDS as string[]).includes(k ?? "") ? (k as PauseKind) : kindFromNote(job.note); },
      // Build the CV (or ask for a layout choice or a missing fact: the outcome is the job's status). Always a press by the user.
      build(job: JobState, opts: { layout?: "shorter" | "anyway"; ignoreQuestions?: boolean; refreshProfile?: boolean } = {}): AnalyseResult {
        const g = gate(); if (!g.ok) return g; const o = serviceGuard(job); if (o) return o; stopWatcher();
        const r = queue.enqueue(taskFor(job.id, labelOf(job), { kind: "build", opts })); return r.accepted ? { ok: true, state: r.state } : { ok: false, reason: "already_active" };
      },
      extra(job: JobState, extra: Extra): AnalyseResult {
        const g = gate(); if (!g.ok) return g; const o = serviceGuard(job); if (o) return o;
        const r = queue.enqueue(taskFor(job.id, labelOf(job), { kind: "extra", extra })); return r.accepted ? { ok: true, state: r.state } : { ok: false, reason: "already_active" };
      },
      states: async (): Promise<JobState[]> => (await pipeline?.listJobs()) ?? [],
      get: (id: string) => fresh(id),
      // A job with what the screen needs: its analysis (if there is one) and the coach's plain message about it.
      async detail(id: string): Promise<{ job: JobState; analysis: Record<string, any> | null; coach: string | null; question: string | null; pdf: boolean; versions: number; extras: Partial<Record<Extra, string>> } | null> {
        const job = await fresh(id); if (!job) return null;
        const analysis = await readFile(path.join(job.dir, "analysis.json"), "utf8").then((t) => JSON.parse(t) as Record<string, any>).catch(() => null);
        const coach = job.status === "analysed" || job.status === "built" ? await coachMessage(job.dir, "verdict").catch(() => null) : null;
        const question = job.status === "needs_input" && job.needs === "fact" ? await coachMessage(job.dir, "question").catch(() => null) : null;
        const pdf = existsSync(path.join(job.dir, "cv.pdf")), versions = (await readdir(job.dir).catch(() => [] as string[])).filter((f) => /^cv-v\d+\.pdf$/.test(f)).length;
        const extras: Partial<Record<Extra, string>> = {}; for (const k of EXTRAS) if (existsSync(path.join(job.dir, `coach-${k}.json`))) extras[k] = await coachMessage(job.dir, k).catch(() => "");
        return { job, analysis, coach, question, pdf, versions, extras };
      },
      analyse(job: JobState): AnalyseResult {
        const g = gate(); if (!g.ok) return g; const o = serviceGuard(job); if (o) return o;
        const r = queue.enqueue(taskFor(job.id, labelOf(job), "analyse"));
        return r.accepted ? { ok: true, state: r.state } : { ok: false, reason: "already_active" };
      },
      // Resume is ALWAYS the user's press: a paused job re-runs its task; an interrupted job (not in the queue after a restart) is queued fresh from its kept steps.
      resume(job: JobState): AnalyseResult {
        const g = gate(); if (!g.ok) return g; const o = serviceGuard(job); if (o) return o;
        stopWatcher();
        if (queue.resume(job.id)) return { ok: true, state: "queued" };
        const r = queue.enqueue(taskFor(job.id, labelOf(job), "resume"));
        return r.accepted ? { ok: true, state: r.state } : { ok: false, reason: "already_active" };
      },
      async skip(job: JobState): Promise<void> { stopWatcher(); queue.skip(job.id); await pipeline?.skip(job); },
    },

    queue: { snapshot: () => queue.snapshot(), clearFinished: () => queue.clearFinished(), idle: () => queue.idle() },
    backup: { runNow: backupNow, start: () => { void backupNow(); loopBackup(); }, onWake: () => { void backupNow(); } },

    // "Delete everything": secrets, files, the Keychain item; the core is shut down first and must not be used afterwards.
    async deleteEverything(confirmed: boolean) {
      await core.shutdown({ finalBackup: false, keepDb: true }); // the delete routine closes the database itself
      return deleteEverything({ dataDir: d.dataDir, db, secrets: d.secrets, confirmed, tmpDir: d.tmpDir, afterFiles: d.keychainKey ? () => d.keychainKey!.remove() : undefined,
        // the ChatGPT session lives on at OpenAI for up to 30 days unless it is ended: end it while the saved tokens still exist, and say so if OpenAI could not be told
        beforeSecrets: async () => { const r = await openaiSignIn.signOut({ forget: true }).catch(() => null); return r && r.hadSession && !r.revoked ? "ChatGPT could not be told to end the connection, so it may stay active on OpenAI's side: you can remove Truefit in your ChatGPT settings." : null; } });
    },

    // A clean shutdown: cancel an active sign-in, stop the watcher and the timer, one last backup when due, close the database. Safe to call twice.
    async shutdown(o: { finalBackup?: boolean; keepDb?: boolean } = {}): Promise<void> {
      if (shuttingDown) return; shuttingDown = true;
      try { signIn?.cancel(); } catch { /* already finished */ }
      await telegram.stop().catch(() => undefined); stopWatcher(); if (backupTimer !== null) { timers.clearTimeout(backupTimer); backupTimer = null; }
      if (o.finalBackup !== false) await backupNow();
      if (!o.keepDb) { try { db.close(); } catch { /* already closed */ } }
    },
  };
  return core;
}
