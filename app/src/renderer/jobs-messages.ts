// The words on the New job and Job screens (phase 4f). STATUS: APPROVED by the owner (2026-11-17). Any later change needs approval again. Same rules as the other catalogues: plain, UK English, short title and
// one to three sentences, no jargon, never an error text, a path or a code. Pause and sign-in messages are NOT here: they come from the approved access catalogue.
import { branded } from "./service.ts";
const NEW_JOB_RAW = {
  hero: "Which job are you looking at?",
  placeholder: "Paste a job ad, or a link to one",
  hint: "Claude reads the ad against your profile and tells you whether it's worth applying.",
  send: "Analyse this job",
  tryAnyway: "Try anyway",
  nothing: { title: "Paste a job ad or a link first", body: "Copy the ad from the job site and paste it here." },
};
// The new words of the 2026-11-19 redesign. STATUS: DRAFT, not yet approved by the owner (collected for bulk approval).
export const SHELL = { searchJobs: "Search your jobs", searchNone: "No job matches that.", stays: "Saved only on this Mac" };
export const NEW_JOB_NEW = { trust: ["Checked against your verified profile", "Only your confirmed facts", "Saved only on this Mac"], recent: "Pick up where you left off", send: "Analyse this job", keys: "to send", dockPlaceholder: "Paste another job ad, or a link to one" };
export const JOB_NEW = branded({ adSource: "Pasted job ad", adLink: "Job link", claude: "Claude", lead: "Here is how I got there, starting with your own rules.", extrasHint: "Written only from your verified facts, and only when you ask.", extraEmpty: "Not written yet.", extraWrite: "Write it" });

const REFUSED_RAW: Record<string, { title: string; body: string }> = {
  no_profile: { title: "Your profile isn't set up yet", body: "Claude compares each ad with your profile, so it can't judge a job until you've made one." },
  profile_incomplete: { title: "Your profile needs a little more", body: "Claude needs these before it can judge a job:" },
  too_long: { title: "That ad is too long", body: "Paste just the part that describes the job and what they're asking for." },
  too_short: { title: "That's too short to be a job ad", body: "Paste the whole ad, or a link to it, so I have the role and what they're asking for." },
  not_a_job: { title: "That doesn't look like a job ad", body: "Paste the full job description, or a link to it. If it really is an ad, you can try it anyway." },
  empty: { title: NEW_JOB_RAW.nothing.title, body: NEW_JOB_RAW.nothing.body },
  link_failed: { title: "We couldn't read that link", body: "Some sites need you to sign in, or don't let programs read them. Open the ad, copy its text, and paste the text here instead." },
  not_ready: { title: "The app isn't ready yet", body: "Try again in a moment." },
};
const DUPLICATE_RAW = { title: "You've looked at this job before", body: (title: string) => `This ad matches ${title}.`, open: "Open it", again: "Analyse again" };
const WAITING_RAW = { queued: (n: number | null, blocked = false) => `${n ? `Waiting for its turn (number ${n} in the line).` : "Waiting for its turn."}${blocked ? " Another job is paused, so nothing new starts until you resume or skip it." : ""}`, running: "Claude is reading the ad and checking it against your profile…", usually: "This usually takes a minute or two. You can leave this page; the job carries on." };
const STATES_RAW: Record<string, { title: string; body: string }> = {
  interrupted: { title: "This job was interrupted", body: "The app was closed while it was working. Nothing is lost. Press Resume to carry on." },
  needs_input: { title: "This job needs something from you", body: "Press Resume to carry on." },
  failed: { title: "This job didn't finish", body: "Something went wrong while reading it. You can try again, or skip it." },
  skipped: { title: "You skipped this job", body: "It stays in your list. You can analyse it again whenever you like." },
  missing: { title: "We can't find this job", body: "It may have been deleted. Pick another job from the list." },
};
const VERDICT_WORD_RAW = { apply: "Apply", long_shot: "Long shot", skip: "Skip" } as const;
const RULE_NAME_RAW: Record<string, string> = { seniority: "Level", salary: "Pay", location: "Location", right_to_work: "Right to work", core_job: "The job itself" };
const CARD_RAW = {
  fit: (n: number) => `Fit ${n}%`, why: "Why", rules: "Your rules", strengths: "What fits you", gaps: "Where you're thin", handle: "How to handle it", note: "Claude's note",
  ruleOk: "OK", ruleFail: "Doesn't match", ruleUnclear: "Check this",
  breaks: { title: "This job breaks one of your own rules", body: "Skipping is recommended, but it's your decision." },
  build: "Build CV", buildAgain: "Build again", skip: "Skip this job", again: "Analyse again", resume: "Resume", tryAgain: "Try again",
  listNeeds: "Needs you", listRecent: "Recent", listEmpty: "Your jobs will appear here.",
};

// Build and extras (phase 6). DRAFT, not approved (see ISSUES.md).
const BUILD_RAW = {
  working: "Claude is writing and checking your CV…", usually: "This usually takes a few minutes. You can leave this page; the job carries on.",
  fact: { title: "I need a fact that isn't in your profile", added: "I've added it, build again", without: "Build without it", profile: "Open My profile" },
  layout: { title: "The CV doesn't fit on one page", shorter: "Try a shorter version", anyway: "Deliver it as a longer CV", why: (w: string) => `${w}. A shorter version drops the least relevant points.` },
  built: { title: "Your CV is ready", versions: (n: number) => (n > 1 ? `${n} versions are kept in this job's folder.` : "It is kept in this job's folder."), open: "Open CV", reveal: "Show in Finder" },
  failed: { title: "No CV this time", body: "It didn't pass the checks, so nothing was kept. You can try again, or change your profile and build again." },
  extras: { title: "Extras", cover: "Cover note", prep: "Interview prep", recruiter: "Recruiter message", brief: "Company brief", copy: "Copy", copied: "Copied", save: "Save as text file", saveWord: "Save as Word file", savePdf: "Save as PDF", saved: "Saved.", saveFailed: "That didn't save. Try another place.", edit: "Edit", doneEdit: "Done editing", reset: "Undo my edits", editedNote: "Your edits are not stored in Truefit. Copy or save the text before you leave.", working: "Claude is writing it…" },
};

// Which agent is working (shown while a job runs). Wording: new, not read by the owner. The engine's step names are mapped here; an unknown step shows nothing.
const STAGE_RAW = { analyst: "Reading the ad", check: "Checking it against your rules", coach: "Writing your verdict", writer: "Choosing the lines for your CV", render: "Laying out the page", checker: "Checking every line against your profile", fix: "Fixing what the checker found", question: "Preparing a question for you", delivered: "Writing your summary", extra: "Writing it", verify: "Checking it against your profile" } as const;
export function stageOf(scope: string, name: string): string | null {
  if (scope === "analyse") return name === "analyst" ? STAGE.analyst : name === "check" ? STAGE.check : name === "coach" ? STAGE.coach : null;
  if (scope === "build") {
    if (name === "init") return null; if (name.startsWith("render:")) return STAGE.render; if (name.startsWith("checker:")) return STAGE.checker; if (name === "coach:question") return STAGE.question; if (name === "coach:delivered") return STAGE.delivered; if (name === "w2prep") return STAGE.fix;
    return /[ab]$/.test(name) ? STAGE.writer : null;
  }
  if (scope.startsWith("extra:")) return name.startsWith("verify:") ? STAGE.verify : name.startsWith("write:") ? STAGE.extra : null;
  return null;
}

// The tables the screens read: worded for the chosen AI service (see service.ts).
export const NEW_JOB = branded(NEW_JOB_RAW);
export const REFUSED = branded(REFUSED_RAW);
export const DUPLICATE = branded(DUPLICATE_RAW);
export const WAITING = branded(WAITING_RAW);
export const STATES = branded(STATES_RAW);
export const VERDICT_WORD = branded(VERDICT_WORD_RAW);
export const RULE_NAME = branded(RULE_NAME_RAW);
export const CARD = branded(CARD_RAW);
export const BUILD = branded(BUILD_RAW);
export const STAGE = branded(STAGE_RAW);
