// THE bridge contract (phase 4c): every message that may cross between the window's page (renderer) and the main process, in ONE file that both sides import.
// Nothing else crosses: the preload script exposes only the channels listed here, the main process answers only these channels, every request is validated against its
// own validator (unknown fields are refused), and every answer is a Result (a failure is a short plain code and message, never a raw error, a stack or a path).
// Adding a message means adding it here first; a test checks that the main process has a handler for every channel.

export const APP_NAME = "Truefit"; // the working name: one constant, the final name is still open

export type ErrorCode = "invalid_request" | "forbidden" | "not_found" | "failed";
export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } };
export const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
export const fail = (code: ErrorCode, message: string): Result<never> => ({ ok: false, error: { code, message } });

// ---------- tiny validators (no library): each returns the checked value or INVALID ----------
export const INVALID = Symbol("invalid");
export type Validator<T> = (x: unknown) => T | typeof INVALID;
const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
export const none: Validator<undefined> = (x) => (x === undefined || x === null ? undefined : INVALID);
export const object = <T extends Record<string, Validator<any>>>(shape: T): Validator<{ [K in keyof T]: Exclude<ReturnType<T[K]>, typeof INVALID> }> => (x) => {
  if (!isRecord(x)) return INVALID;
  const keys = Object.keys(x);
  if (keys.some((k) => !Object.hasOwn(shape, k))) return INVALID; // a field we do not know is refused, never ignored
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(shape)) { const v = shape[k](x[k]); if (v === INVALID) return INVALID; out[k] = v; }
  return out as never;
};
export const string = (max: number, min = 0): Validator<string> => (x) => (typeof x === "string" && x.length >= min && x.length <= max && !x.includes("\0") ? x : INVALID);
export const oneOf = <T extends string>(...values: T[]): Validator<T> => (x) => (typeof x === "string" && (values as string[]).includes(x) ? (x as T) : INVALID);
// A JSON-like object whose total size is limited (the profile: its inner shape is checked in the main process by the engine's own validator, never trusted from the page).
export const jsonObject = (maxChars: number): Validator<Record<string, unknown>> => (x) => { if (!isRecord(x)) return INVALID; try { return JSON.stringify(x).length <= maxChars ? x : INVALID; } catch { return INVALID; } };
export const optional = <T,>(v: Validator<T>): Validator<T | undefined> => (x) => (x === undefined ? undefined : v(x));
export const boolean: Validator<boolean> = (x) => (typeof x === "boolean" ? x : INVALID);

// ---------- requests the page may make (page asks, main answers) ----------
// What the page is shown. The main process builds the wording from the approved message catalogue; the page only displays it (a button is an id plus its label).
export type UiAction = { id: string; label: string };
export type UiMessage = { id: string; tone: "ok" | "info" | "warn" | "error"; title: string; body: string; actions: UiAction[]; details: string };
export type UiNotice = { title: string; intro: string; points: { heading: string; text: string }[]; checkbox: string };
export type AccessView = { provider: "claude" | "openai"; message: UiMessage; kind: string; mode: "subscription" | "apiKey" | null; noticeAccepted: boolean; connected: boolean; notice: UiNotice };
export type UiBackup = { id: string; createdAt: string | null; reason: string | null };
export type StartPhase = "starting" | "ready" | "damaged" | "too-new" | "upgrade-failed" | "failed";
export type StartStatus = { phase: StartPhase; backups: UiBackup[] };
export type SignInProgress = { running: boolean; message: UiMessage; link: string | null; awaitingCode: boolean };
export type ActionResult = { view: AccessView; message: UiMessage | null };
// ---- history, settings, data (7) ----
export type UiHistory = { rows: UiJobRow[]; total: number };
export type UiSummary = { jobs: number; analysed: number; built: number; avgFit: number | null; apply: number; long_shot: number; skip: number };
export type ImportPick = { status: "picked"; jobs: number; createdAt: string; hasProfile: boolean } | { status: "cancelled" } | { status: "invalid" };
export type UiSettings = { onboardingDone: boolean; usage: string[]; tone: string; accent: string; appearance: string; showRightToWork: boolean; notify: { analysed: boolean; cvReady: boolean; needsInput: boolean; failed: boolean }; updateCheck: boolean; startAtLogin: boolean; capUsd: number | null; tones: string[]; accents: string[]; version: string };
export type SettingsSaveResult = { ok: true; settings: UiSettings } | { ok: false; errors: string[] };
export type SaveTextResult = { status: "saved" } | { status: "cancelled" } | { status: "failed" };
export type ExportResult = { status: "saved"; jobs: number; files: number; bytes: number } | { status: "cancelled" } | { status: "failed" };
export type UiTelegram = { state: "off" | "token_saved" | "pairing" | "paired" | "running" | "error"; botName: string | null; code: string | null };
// ---- profile (5) ----
export type ProfileGate = { ok: boolean; missing: string[] };
export type ProfileView = { status: "none" | "ok"; profile: Record<string, unknown> | null; gate: ProfileGate; updatedAt: string | null };
export type UiReviewCard = { key: string; kind: string; message: string; options: string[]; factIds?: string[] };
export type ProfileOverview = { cards: UiReviewCard[]; unchecked: string[]; sources: { id: string; label: string; kind: string; addedAt: string }[] };
export type ProfileCardResult = { ok: true; profile: Record<string, unknown>; updatedAt: string; overview: ProfileOverview } | { ok: false; reason: "no_card" | "not_allowed" };
export type ProfileImportResult = { status: "ok"; profile: Record<string, unknown>; added: { roles: number; bullets: number; skills: number; education: number }; notFromCv: number; dropped: number; upgraded: number; proposedName: string | null; updatedAt: string } | { status: "refused"; reason: "too_short" | "claude"; message: UiMessage | null };
export type VoiceResponse = { status: "ok"; text: string } | { status: "refused"; reason: "too_short" | "too_long" | "quiet" | "nothing_heard" | "unavailable" | "bad_audio" };
export type ImportFileResult = { status: "picked"; text: string; kind: "pdf" | "docx" | "text" } | { status: "cancelled" } | { status: "refused"; reason: "too_big" | "unsupported" | "unreadable" | "empty" };
export type ProfileSaveResult = { ok: true; warnings: string[]; gate: ProfileGate; updatedAt: string } | { ok: false; errors: string[] };
// ---- notices (4g): the in-app banner that stands in for macOS notifications (an unsigned app cannot send those) ----
export type UiBanner = { id: string; kind: "analysed" | "built" | "needs_input" | "paused" | "failed"; jobId: string; title: string; body: string; at: string };
// ---- jobs (4f) ----
export type UiJobRow = { id: string; title: string; status: string; verdict: "apply" | "long_shot" | "skip" | null; fit: number | null; needsYou: boolean; updated: string };
export type UiRule = { rule: string; status: "ok" | "fail" | "unclear"; note: string };
export type UiVerdict = { verdict: "apply" | "long_shot" | "skip"; fit: number; fitNote: string; summary: string; location: string; workMode: string; salary: string | null; seniority: string; rules: UiRule[]; strengths: string[]; gaps: { gap: string; handle: string }[] };
export type UiBuild = { state: "none" | "building" | "needs_fact" | "needs_layout" | "built" | "failed"; question: string | null; layoutWhy: string | null; pdf: boolean; versions: number };
export type UiExtra = { kind: "cover-note" | "interview-prep" | "recruiter-message" | "company-brief"; text: string };
export type UiJobDetail = { build: UiBuild; extras: UiExtra[]; id: string; title: string; status: string; source: "text" | "link"; url: string | null; note: string | null; verdict: UiVerdict | null; coach: string | null; pause: UiMessage | null; queue: { state: string; position: number | null; blocked: boolean } | null };
export type CreateJobOutcome =
  | { outcome: "created"; job: UiJobRow }
  | { outcome: "duplicate"; existing: UiJobRow }
  | { outcome: "refused"; reason: "no_profile" | "profile_incomplete" | "too_long" | "empty" | "link_failed" | "not_ready" | "too_short" | "not_a_job"; missing: string[] };
export type AppInfo = { name: string; version: string; platform: string; packaged: boolean };
export const channels = {
  // the app's name, version and platform (the first proof that the bridge works)
  "app:info": { request: none, description: "name and version" },
  // ask the main process to open a link in the user's browser; only links on Claude's own sites are ever opened (the main process re-checks)
  "app:openLink": { request: object({ url: string(2000, 8) }), description: "open an allow-listed link in the browser" },
  // the page tells the main process it has finished loading (so the window can be shown without a white flash)
  "app:ready": { request: none, description: "the page is ready" },
  // ---- start-up (4e) ----
  "app:status": { request: none, description: "did the app start, or what is wrong with the saved data" },
  "app:recover": { request: object({ id: string(40, 1) }), description: "restore the saved data from one of the listed backups (by the id the list gave; never a path)" },
  "app:startFresh": { request: object({ confirmed: boolean }), description: "set the damaged data aside and start empty (needs confirmed: true)" },
  "app:copy": { request: object({ text: string(6000) }), description: "put text on the clipboard (diagnostics)" },
  // ---- Claude access (4e) ----
  "access:get": { request: none, description: "the state of the connection, as a message" },
  "access:chooseMode": { request: object({ mode: oneOf("subscription", "apiKey") }), description: "choose subscription or API key" },
  "access:acceptNotice": { request: none, description: "the user ticked the subscription notice" },
  "access:saveKey": { request: object({ key: string(500, 1) }), description: "check an API key with one tiny call and save it if it works" },
  "access:test": { request: none, description: "test the connection with one tiny call" },
  "access:signIn": { request: none, description: "start the sign-in in the user's browser; progress arrives as events" },
  "access:cancelSignIn": { request: none, description: "cancel the sign-in" },
  "access:submitCode": { request: object({ code: string(500, 1) }), description: "paste the code the browser page showed" },
  "access:chooseProvider": { request: object({ provider: oneOf("claude", "openai") }), description: "choose which AI service answers: Claude or OpenAI (forgets the chosen way to connect)" },
  "access:signOut": { request: object({ forget: boolean }), description: "disconnect ChatGPT: end the session at OpenAI and remove the saved sign-in from this Mac; forget also drops the registration, to use a different ChatGPT account" },
  // ---- history, settings, data (7) ----
  "history:search": { request: object({ text: string(200), verdict: optional(oneOf("apply", "long_shot", "skip")), sort: optional(oneOf("newest", "oldest", "fit", "company")), offset: optional(string(7)) }), description: "search and filter the jobs; 200 rows a page, the next page starts at the given offset" },
  "history:summary": { request: none, description: "counts for the History page" },
  "settings:get": { request: none, description: "the settings the page may show and change" },
  "settings:set": { request: object({ patch: jsonObject(2000) }), description: "change settings (the engine checks the whole patch; one bad value refuses all)" },
  "data:export": { request: none, description: "save everything to a file chosen in the save dialog (the main process asks for the place)" },
  "data:saveText": { request: object({ name: string(120, 1), text: string(40000, 1), format: optional(oneOf("txt", "docx", "pdf")) }), description: "save a piece of text (an extra, possibly edited) as a .txt, .docx or .pdf file; the main process shows the save dialog and writes it, the page never sees the path" },
  "data:delete": { request: object({ phrase: string(40) }), description: "delete everything; the typed phrase must match" },
  "data:deleteJobs": { request: object({ phrase: string(40) }), description: "delete all jobs and CVs but keep the profile and settings; the typed phrase must match" },
  "data:importPick": { request: none, description: "choose an export file in the open dialog and read what it holds (nothing is changed)" },
  "data:importConfirm": { request: object({ phrase: string(40) }), description: "replace everything with the chosen export; the typed phrase must match; the app then quits" },
  // ---- telegram (8) ----
  "telegram:status": { request: none, description: "Telegram's state (off, token saved, pairing with a code, paired, running)" },
  "telegram:saveToken": { request: object({ token: string(200, 1) }), description: "check a bot token with Telegram and save it as a secret" },
  "telegram:pair": { request: none, description: "start pairing: returns a code the user sends to their bot" },
  "telegram:cancelPair": { request: none, description: "stop pairing" },
  "telegram:disconnect": { request: none, description: "remove the token and the pairing" },
  // ---- profile (5) ----
  "profile:get": { request: none, description: "the user's profile and whether it is ready for analysing jobs" },
  "profile:import": { request: object({ text: string(200_000) }), description: "send the text of the user's CV (contact details removed first) to Claude once; the merged profile is SAVED at once (items found word for word in the CV are trusted, the rest stay under review) and returned" },
  "profile:overview": { request: none, description: "the review cards computed from the stored profile (contradictions, overlaps, duplicates, items waiting for a look, details the import filled in) and the CVs it was built from" },
  "profile:card": { request: object({ key: string(120, 1), action: oneOf("accept", "dismiss", "merge") }), description: "do what a review card's button says; the card is looked up from the stored profile by its key (nothing else is trusted from the page)" },
  "profile:importFile": { request: none, description: "choose a CV file (PDF, Word or text) in the open dialog and read its text on this Mac (nothing is sent anywhere)" },
  "voice:mic": { request: none, description: "ask macOS for permission to use the microphone (it shows its own question the first time) and say what the answer is" },
  "voice:transcribe": { request: object({ audio: string(1_400_000, 4) }), description: "turn a recording (16 kHz mono, 16-bit, base64) into text on this Mac with the bundled speech model; the audio is never stored and never leaves the computer" },
  "profile:save": { request: object({ profile: jsonObject(400_000), baseUpdatedAt: optional(string(40)) }), description: "validate and save the whole profile (the engine's own checks run in the main process); refused when baseUpdatedAt is older than the stored profile (it changed in the meantime, for example by an import)" },
  // ---- notices (4g) ----
  "notices:list": { request: none, description: "the banners waiting for the user" },
  "notices:dismiss": { request: object({ id: string(40, 1) }), description: "dismiss one banner" },
  // ---- jobs (4f) ----
  "jobs:list": { request: none, description: "the jobs for the sidebar" },
  "jobs:get": { request: object({ id: string(100, 1) }), description: "one job with its verdict" },
  "jobs:create": { request: object({ text: string(40000), force: optional(boolean) }), description: "make a job from pasted ad text or one link (a small check that it is a job ad may run first; the analysis is a separate step)" },
  "jobs:analyse": { request: object({ id: string(100, 1) }), description: "queue the analysis of a job (also 'Analyse again')" },
  "jobs:resume": { request: object({ id: string(100, 1) }), description: "continue a paused or interrupted job (always the user's own press)" },
  "jobs:build": { request: object({ id: string(100, 1), layout: optional(oneOf("shorter", "anyway")), ignoreQuestions: optional(boolean), refreshProfile: optional(boolean) }), description: "build the CV (also: a layout choice, build without an unanswered fact, or rebuild after adding the fact)" },
  "jobs:extra": { request: object({ id: string(100, 1), kind: oneOf("cover-note", "interview-prep", "recruiter-message", "company-brief") }), description: "write one extra (cover note, interview prep, recruiter message, company brief)" },
  "jobs:openPdf": { request: object({ id: string(100, 1) }), description: "open the job's CV in the user's PDF viewer (the path never comes from the page)" },
  "jobs:reveal": { request: object({ id: string(100, 1) }), description: "show the job's CV in Finder" },
  "jobs:skip": { request: object({ id: string(100, 1) }), description: "skip a job" },
} as const;
export type ChannelName = keyof typeof channels;
export type RequestOf<C extends ChannelName> = Exclude<ReturnType<(typeof channels)[C]["request"]>, typeof INVALID>;
export type ResponseMap = {
  "app:info": AppInfo; "app:openLink": { opened: boolean }; "app:ready": { shown: boolean };
  "app:status": StartStatus; "app:recover": StartStatus; "app:startFresh": StartStatus; "app:copy": { copied: boolean };
  "access:get": AccessView; "access:chooseMode": AccessView; "access:acceptNotice": AccessView; "access:saveKey": ActionResult; "access:test": ActionResult;
  "history:search": UiHistory; "history:summary": UiSummary; "settings:get": UiSettings; "settings:set": SettingsSaveResult; "data:export": ExportResult; "data:saveText": SaveTextResult; "data:delete": { deleted: boolean; warnings: string[] }; "data:deleteJobs": { deleted: boolean; jobs: number }; "data:importPick": ImportPick; "data:importConfirm": { imported: boolean };
  "telegram:status": UiTelegram; "telegram:saveToken": { ok: boolean; botName: string | null; reason: string | null; status: UiTelegram }; "telegram:pair": UiTelegram; "telegram:cancelPair": UiTelegram; "telegram:disconnect": UiTelegram;
  "profile:get": ProfileView; "profile:overview": ProfileOverview; "profile:card": ProfileCardResult; "voice:mic": { access: "granted" | "denied" | "restricted" | "unknown" }; "voice:transcribe": VoiceResponse; "profile:save": ProfileSaveResult; "profile:import": ProfileImportResult; "profile:importFile": ImportFileResult;
  "notices:list": UiBanner[]; "notices:dismiss": { dismissed: boolean };
  "jobs:list": UiJobRow[]; "jobs:get": UiJobDetail | null; "jobs:create": CreateJobOutcome; "jobs:analyse": { queued: boolean; reason: string | null; note?: string | null }; "jobs:resume": { queued: boolean; reason: string | null; note?: string | null }; "jobs:build": { queued: boolean; reason: string | null; note?: string | null }; "jobs:extra": { queued: boolean; reason: string | null; note?: string | null }; "jobs:openPdf": { opened: boolean }; "jobs:reveal": { shown: boolean }; "jobs:skip": { skipped: boolean };
  "access:signIn": { started: boolean }; "access:cancelSignIn": { cancelled: boolean }; "access:submitCode": { accepted: boolean }; "access:chooseProvider": AccessView; "access:signOut": { cleared: boolean; revoked: boolean };
};
export type ResponseOf<C extends ChannelName> = ResponseMap[C];
export const CHANNEL_NAMES = Object.keys(channels) as ChannelName[];

// ---------- messages the main process pushes to the page ----------
export type EventMap = {
  "app:visibility": { visible: boolean };   // the window was hidden or shown (menu bar app: the app keeps running when the window closes)
  "access:signin": SignInProgress;          // progress of the sign-in; `running: false` carries the final message
  "app:notice": UiBanner;                  // a new banner (job analysed, CV ready, needs you, paused, failed)
  "jobs:step": { jobId: string; scope: string; name: string; phase: "start" | "done" }; // which step of a run has begun or ended (the page shows the agents at work)
  "jobs:changed": { rows: UiJobRow[] };      // any job or the queue changed: the page re-reads what it shows
  "access:changed": AccessView;             // the connection state changed (for the status line and banners)
};
export type EventName = keyof EventMap;
export const EVENT_NAMES: EventName[] = ["app:visibility", "access:signin", "access:changed", "jobs:changed", "jobs:step", "app:notice"];

// What the preload script puts on `window.cvapp`.
export interface CvAppBridge {
  invoke<C extends ChannelName>(channel: C, request?: RequestOf<C>): Promise<Result<ResponseOf<C>>>;
  on<E extends EventName>(event: E, listener: (payload: EventMap[E]) => void): () => void;
}
