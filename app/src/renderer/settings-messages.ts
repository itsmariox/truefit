// The words on History and Settings (phase 7). STATUS: DRAFT, written without the owner's approval (see ISSUES.md, WORDING). Plain UK English.
import { branded } from "./service.ts";
const HISTORY_RAW = {
  title: "History", intro: "Every job you've looked at. Search by company or role.", search: "Search jobs", all: "Any verdict", sort: "Order", empty: "No jobs match.", none: "No jobs yet. Paste a job ad on New job to start.",
  sorts: { newest: "Newest first", oldest: "Oldest first", fit: "Best fit first", company: "Company A to Z" },
  summary: (s: { jobs: number; analysed: number; built: number; avgFit: number | null }) => `${s.jobs} job${s.jobs === 1 ? "" : "s"}, ${s.analysed} analysed, ${s.built} CV${s.built === 1 ? "" : "s"} built${s.avgFit === null ? "" : `, average fit ${s.avgFit}%`}.`,
  more: (shown: number, total: number) => `Showing ${shown} of ${total}. Show more`,
  verdicts: { apply: "Apply", long_shot: "Long shot", skip: "Skip" },
};
const SETTINGS_RAW = {
  title: "Settings", saved: "Saved.",
  claude: "Claude", notify: "Notifications", notifyNote: "These show inside the app, in the menu bar and on the Dock icon.",
  notifyLabels: { analysed: "A job has been analysed", cvReady: "A CV is ready", needsInput: "A job needs my answer", failed: "A job is paused or didn't finish" },
  cv: "Your CVs", tone: "Tone of Claude's messages", accent: "CV accent colour", rtw: "Show my right to work on the CV",
  startup: "Start up", login: "Open the app when I log in", cap: "Monthly spend limit for an API key (US dollars, leave empty for none)", capSave: "Save limit",
  data: "Your data", dataNote: "Everything stays on this Mac. Nothing is sent anywhere except what Claude needs to do its work.",
  export: "Save a copy of everything", exported: (n: number) => `Saved ${n} job${n === 1 ? "" : "s"} to the file you chose.`, exportFailed: "The copy couldn't be saved.",
  delete: "Delete everything", deleteNote: "This removes your profile, jobs, CVs, saved key and settings from this Mac. It can't be undone. Type \"delete everything\" to confirm.", deleteLabel: "Type delete everything", deleteGo: "Delete everything now", deleted: "Everything was deleted. The app will close.",
  searchLabel: "Search settings", searchNone: "No settings match that.", usage: "Usage", none: "Nothing used yet this month.",
  deleteJobs: "Delete jobs and CVs", deleteJobsNote: "This removes every job, CV and extra, and keeps your profile and settings. It can't be undone. Type \"delete jobs\" to confirm.", deleteJobsLabel: "Type delete jobs", deleteJobsGo: "Delete jobs now", jobsDeleted: (n: number) => `Deleted ${n} job${n === 1 ? "" : "s"}.`,
  restore: "Restore from a copy", restoreNote: "Use a copy you saved above (for example on a new Mac). It replaces everything here: your profile, jobs and settings.", restorePick: "Choose a copy…", restoreBad: "That file isn't a copy made by this app.",
  restoreFound: (jobs: number, when: string, profile: boolean) => `This copy was saved ${when} and holds ${jobs} job${jobs === 1 ? "" : "s"}${profile ? " and a profile" : ""}.`, restoreLabel: "Type replace everything", restoreHint: "Type \"replace everything\" to confirm.", restoreGo: "Replace everything with this copy", restored: "Restored. The app will close; open it again to carry on.",
  about: "About", guide: "First-run guide", guideNote: "Walk through the welcome steps again. Your profile and settings are not changed.", guideShow: "Show the guide", version: (v: string) => `Version ${v}`, problem: "That wasn't saved. Check the value and try again.",
};
const TELEGRAM_RAW = {
  title: "Telegram (optional)", intro: "Send job ads to your own Telegram bot and get your CV back on your phone. It only works while this Mac is awake and the app is open.",
  step1: "In Telegram, talk to @BotFather, create a bot, and paste its token here.", token: "Bot token", save: "Check and save",
  show: "Show the token while I type",
  malformed: "That doesn't look like a bot token. It looks like 123456789:ABC… with a colon in the middle; check for a missing or extra character.", refused: "Telegram didn't accept that token.", unreachable: "Couldn't reach Telegram. Check your internet connection.",
  saved: (n: string) => `Connected to your bot, @${n}.`, pair: "Pair with my Telegram", pairing: (c: string) => `In Telegram, send this code to your bot: ${c}`, cancel: "Cancel", paired: "Telegram is connected.", disconnect: "Disconnect Telegram",
};

// Light or dark (owner's decision 2026-11-20). STATUS: DRAFT, not yet approved by the owner.
export const APPEARANCE = {
  section: "Appearance", title: "How should Truefit look?", note: "Pick the look you find easiest to read. You can change it here at any time.",
  options: { light: "Light", dark: "Dark", system: "Match my Mac" } as const,
  welcomeTitle: "How would you like it to look?", words: ["theme", "dark mode", "light mode", "colours"],
};

// The tables the screens read: worded for the chosen AI service (see service.ts).
export const HISTORY = branded(HISTORY_RAW);
export const SETTINGS = branded(SETTINGS_RAW);
export const TELEGRAM = branded(TELEGRAM_RAW);
