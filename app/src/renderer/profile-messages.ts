// The words on My profile (phase 5). STATUS: DRAFT, written without the owner's approval (he asked for the build to continue; see ISSUES.md, WORDING). Plain UK English.
import { branded } from "./service.ts";
const PROFILE_RAW = {
  talk: {
    voice: { deaf: "I can't hear anything yet. Check that the right microphone is chosen in System Settings, Sound, Input, and that Truefit is allowed to use it. Or press Stop and type instead.", listeningHint: "Listening. It stops by itself when you pause, or press Stop and send.", aloud: "Read replies aloud", speak: "Speak", stop: "Stop and send", working: "Listening back…", nothing: "Nothing was recorded. Try again.", blocked: "The microphone is blocked. Allow Truefit in System Settings, Privacy and Security, Microphone, then try again.", noMic: "No microphone could be started. Type instead.",
      problems: { too_short: "That was too short. Hold on a little longer and say it again.", too_long: "That was too long. Say it in pieces of about half a minute.", quiet: "I couldn't hear anything. Check your microphone and try again.", nothing_heard: "I couldn't make out any words. Try again, a little closer.", unavailable: "Speech to text isn't available right now. Type instead.", bad_audio: "That recording couldn't be read. Try again." } },
  },
  dna: {
    iWorkAs: "I work as", at: "At", facts2: { name: "My name is", live: "I live in", reach: "You can reach me at", or: "Or", work: "My right to work:" },
    extras: { nav: "Languages & more", title: "Languages, certificates and projects", note: "Printed on your CVs word for word, under their own headings, when you add them.", languages: "Languages", certs: "Certificates", projects: "Projects", addLanguage: "Add a language", addCert: "Add a certificate", addProject: "Add a project", language: "Language", level: "Level", certName: "Certificate", issuer: "Awarded by (optional)", year: "Year (optional)", yearShort: "Year", projectName: "Project", projectText: "What it was, in one or two sentences", remove: "Remove", empty: "None added.", levels: { native: "Native", fluent: "Fluent", professional: "Professional", basic: "Basic" } },
    stats: { label: "Your profile at a glance", verified: "Verified, used by Claude", check: "Needs a look, not used yet", waiting: "Waiting for your look", legendVerified: "Verified: Claude can use it", legendCheck: "Needs a look: Claude cannot see it yet", verifiedTag: "Verified" }, // DRAFT wording (2026-11-20), not yet approved
    navLabel: "Profile sections", summary: (r: number, b: number, s: number) => `${r} role${r === 1 ? "" : "s"} · ${b} achievement${b === 1 ? "" : "s"} · ${s} skill${s === 1 ? "" : "s"}`,
    review: "Needs a look", reviewNote: "Things to check. Nothing here is used in your CVs until you accept it or change it.", accept: "Accept", staleCard: "That card is out of date. The page has been refreshed.", dismiss: "Dismiss", editBtn: { overlap: "Fix a date", contradiction: "Fix it", gap: "Edit", "needs-review": "Edit" } as Record<string, string>, keepBoth: "Yes, both are right", confirm: "These are right", merge: "Merge", checkThis: "Check", reviewMark: "Needs review",
    cardBullets: (n: number, where: string) => `${n} achievement${n === 1 ? "" : "s"} in ${where} ${n === 1 ? "isn't" : "aren't"} used in CVs yet: ${n === 1 ? "it wasn't" : "they weren't"} found word for word in your CV.`,
    cardRole: (where: string) => `${where} is waiting for a look.`, cardStory: (where: string) => `The story for ${where} is waiting for a look.`, cardSkills: (n: number) => `${n} skill${n === 1 ? "" : "s"} waiting for a look.`, cardEdu: (n: number) => `${n} education line${n === 1 ? "" : "s"} waiting for a look.`,
    facts: "Hard facts", experience: "Experience", skills: "Skills", studies: "Studies", wants: "What I want",
    factsNote: "Only you can change these. They go on every CV and no agent edits them.", dateOrder: "This role ends before it starts.", addStory: "Add a story", noDates: "No dates", untitled: "New role", achievements: (n: number) => `${n} achievement${n === 1 ? "" : "s"}`, removeSkill: "Remove",
  },
  // DRAFT wording (2026-11-20): the Focus and Never say sections are gone, phone and LinkedIn are marked "(optional)", and every other hard fact shows "Required" once left empty. Not yet approved.
  title: "My profile",
  intro: "Everything Claude uses to judge jobs and write your CVs comes from here. Claude only sees what came from your own CV or from you; anything else waits for your look.",
  saved: "Saved", saving: "Saving…",
  gateTitle: "To analyse jobs you still need:", gateReady: "Your profile is ready for analysing jobs.",
  details: { name: "Full name", email: "Email", phone: "Phone (optional)", linkedin: "LinkedIn address (optional)", required: "Required", city: "City", country: "Country", note: "These appear in the header of your CV. They are never sent to Claude." },
  roles: { add: "Add a role", title: "Job title", company: "Company", location: "Where", startM: "Start month", startY: "Start year", endM: "End month", endY: "End year", current: "I still work here", remove: "Remove this role", empty: "No roles yet. Add the jobs you've done, newest first.", bullets: "What you did", story: "Your story for this role (optional)", addBullet: "Add something you did", bulletHint: "One achievement, with numbers if you have them.", tags: "Topics (separated by commas)", confirm: "I confirm this is true", removeBullet: "Remove", confirmRole: "I confirm this role is accurate" },
  skills: { add: "Add a skill", name: "Skill", empty: "No skills yet." },
  education: { add: "Add education or a qualification", text: "Qualification, where, and when", empty: "Nothing added yet." },
  // DRAFT wording: the "What I want" place chips (targetsHint, targetsPlaceholder, targetsList, removeTarget) and the level chips (levels) are new and await the owner's review.
  rules: { salary: "The lowest yearly pay you'd accept (£)", here: "Where you live now", targets: "Places you'd work", targetsHint: "Type a place, then press Enter or a comma to add it.", targetsPlaceholder: "For example, Leeds", targetsList: "Places added", removeTarget: (v: string) => `Remove ${v}`, modes: "How you'd work", onsite: "On site", hybrid: "Hybrid", remote: "Remote", levels: "Levels you'd take", rtw: "Your right to work (for example: I have the right to work in the UK)", sponsor: "I would need a visa sponsor", availability: "When you could start (optional)" },
  setup: { title: "Set up your profile first", body: "Claude compares every job with your profile, so it can't judge one until the basics are there.", open: "Open My profile" },
  import: {
    title: "Start from your CV", intro: "Paste your CV or choose a file (PDF, Word or text). Claude lists your jobs, achievements, skills and education so you don't have to type them. What matches your CV word for word is ready to use; anything else waits for your look.",
    privacy: "To do this, the text of your CV is sent to Claude once. Your email address, phone number and LinkedIn link are removed first, on this Mac, before anything is sent.",
    paste: "Paste the text of your CV", choose: "Choose a file…", go: "Find my jobs and skills", working: "Claude is reading your CV…",
    tooShort: "There isn't enough text to read yet. Paste more of your CV.", fileBad: { too_big: "That file is too large. Try a shorter CV.", unsupported: "That kind of file can't be read. Use a PDF, Word (.docx) or text file.", unreadable: "That file couldn't be read. Try pasting the text instead.", empty: "That file has hardly any text in it. If it's a scan, paste the text instead." },
    done: (r: number, b: number, s: number, e: number) => `Added ${r} job${r === 1 ? "" : "s"}, ${b} achievement${b === 1 ? "" : "s"}, ${s} skill${s === 1 ? "" : "s"} and ${e} education line${e === 1 ? "" : "s"} from your CV. What matches your CV word for word is ready to use and is saved; anything else is waiting for your look under "Needs a look".`,
    check: (n: number) => `${n} item${n === 1 ? " wasn't" : "s weren't"} found word for word in your CV. Check ${n === 1 ? "it" : "them"} carefully.`, review: "Check the card under \"Needs a look\", and the details you can see under \"Hard facts\".",
  },
  errorsTitle: "Some details need fixing before this can be saved:",
};

// The tables the screens read: worded for the chosen AI service (see service.ts).
export const PROFILE = branded(PROFILE_RAW);
