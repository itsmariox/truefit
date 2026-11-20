// The words of the first-run guide (Truefit). Plain UK English, direct: the score first, then the proof. Approved in bulk by the owner on 2026-11-17 (see ISSUES.md).
import { branded } from "./service.ts";
const ONBOARDING_RAW = {
  back: "Back", next: "Continue",
  steps: ["Welcome", "How it stays honest", "Connect Claude", "Your profile"],
  welcome: {
    title: "Know if a job is worth it before you apply.",
    body: "Paste a job ad. Truefit tells you how well you fit, and why, using only facts you have confirmed about yourself.",
    example: "An example", sampleRole: "Marketing Executive, Acme Retail", sampleVerdict: "Apply",
    proof: [{ label: "Weekly email campaigns", state: "Strong match" }, { label: "Reporting in Google Analytics", state: "Strong match" }, { label: "Paid search", state: "Thin: say what you have" }],
    go: "Get started",
  },
  honest: {
    title: "Only what's true leaves your profile.",
    points: [
      { head: "Only your own words count.", text: "Claude only ever sees what came from your CV or from you. Anything it guessed waits for your look on your Mac." },
      { head: "Everything stays on this Mac.", text: "No account, no tracking. The only thing sent out is what Claude needs to read an ad or write your CV." },
      { head: "Every CV is checked twice.", text: "Each line is traced back to a fact from your own words before you see it." },
    ],
  },
  connect: { title: "Connect Claude", body: "Truefit uses your own Claude subscription, or an API key. Nothing else to install.", connected: "Claude is connected." },
  choose: {
    title: "Build your profile.", body: "Truefit needs to know your work before it can score a job. Pick the way that's quickest for you.",
    cv: "Import from my CV", cvHint: "Upload your CV file. Our agents read it and build your profile for you.",
    scratch: "Start from scratch", scratchHint: "No CV to hand? Answer a few short questions, one screen at a time. Type or dictate.",
  },
  wizard: {
    stepOf: (i: number, n: number) => `Step ${i} of ${n}`, next: "Next", finish: "Build my profile", later: "Skip, I'll finish this in my profile", saving: "Saving…", back: "Back",
    privacy: "Everything you type or say here stays on this Mac. Dictation is turned into text on this Mac too. Nothing is sent to Claude in this part.",
    saveFailed: "That didn't save:", exists: "You already have a profile, and this would replace it. Edit it on your Profile page instead, or go back.", optional: "Optional",
    you: { title: "Let's start with you.", body: "This goes at the top of your CV, so use the name you apply under.", name: "Full name", city: "City", country: "Country", cityHint: "Employers filter by location, so write it the way they would search.", ph: { name: "e.g. Sam Example", city: "e.g. Leeds", country: "e.g. United Kingdom" } },
    contact: { title: "How should employers reach you?", body: "Recruiters and the application systems read these lines. Use an email address you check every day.", email: "Email address", phone: "Phone number", linkedin: "LinkedIn link", emailHint: "Plain and professional works best.", linkedinHint: "Optional. Paste the link to your profile.", ph: { email: "e.g. sam@example.com", phone: "e.g. 07700 900123", linkedin: "e.g. linkedin.com/in/sam" } },
    job: { title: "Your most recent job.", titleN: (n: number) => `Job number ${n}.`, body: "Start with the job you do now, or the last one you had. You can add earlier jobs next.", jobTitle: "Job title", company: "Employer", location: "Where it was", from: "Started", to: "Finished", current: "I still work here", month: "Month", year: "Year", hint: "Use the title on your contract. Application systems match on it.", ph: { title: "e.g. Marketing Executive", company: "e.g. Acme Retail", location: "e.g. Leeds" }, dateBad: "Check the dates: a job can't finish before it starts." },
    wins: { title: "What did you achieve there?", body: "Add at least 3 things you did well. One at a time. Say it or type it.", label: "One achievement", add: "Add it", of: (n: number, min: number) => `${n} of at least ${min} added`, remove: "Remove",
      hints: ["Start with a verb: grew, cut, launched, led, saved.", "Add a number if you can: how many, how much, how fast.", "Say what changed, not just what you did."], examples: ["Grew the newsletter list from 1,200 to 3,600 subscribers in 12 months.", "Cut the weekly report from four hours to two by automating the export.", "Led a team of five to launch the spring campaign two weeks early."], ph: "e.g. Grew the newsletter list from 1,200 to 3,600 subscribers in 12 months." },
    more: { title: "Any earlier jobs?", body: "Recent jobs matter most. Add up to a few more if you like, or carry on.", have: "So far:", add: "Add another job", go: "That's enough, continue" },
    skills: { title: "What are your skills?", body: "Tools, methods and strengths that employers search for. Add at least 3; around 8 to 12 is ideal.", label: "A skill", add: "Add", ph: "e.g. Google Analytics", suggest: "Common ones (tap to add):", suggestions: ["Project management", "Excel", "SQL", "Stakeholder management", "Customer service", "Budgeting", "Copywriting", "Data analysis"], remove: "Remove", count: (n: number) => `${n} added` },
    edu: { title: "Your education.", body: "Degrees, diplomas and relevant training. Leave it empty if there's nothing to add.", label: "Qualification", ph: "e.g. BA Marketing, University of Leeds, 2019", add: "Add it", remove: "Remove", hint: "Put the qualification, where, and the year." },
    extras: { title: "Languages and certificates.", body: "Optional, but they help when a job asks for them.", lang: "Language", level: "Level", levels: { native: "Native", fluent: "Fluent", professional: "Professional", basic: "Basic" }, langPh: "e.g. French", addLang: "Add language", cert: "Certificate", certPh: "e.g. Google Analytics Certification", addCert: "Add certificate", remove: "Remove" },
    where: { title: "Where do you want to work?", body: "We use this to judge whether a job suits you, and to print your location on the CV.", current: "Where you live now", modes: "How you want to work", targets: "Other places you'd work", targetsHint: "Optional. Separate with commas.", modeLabels: { onsite: "On-site", hybrid: "Hybrid", remote: "Remote" }, targetsPh: "e.g. Manchester, Leeds" },
    rtw: { title: "Your right to work.", body: "Employers ask for this first. Pick the line that fits, or write your own.", label: "Right to work", sponsor: "I would need visa sponsorship", suggest: "Suggestions (tap to use):", suggestions: ["I have the right to work in the UK", "I am a British citizen", "I have indefinite leave to remain in the UK", "I have the right to work in the EU"], ph: "e.g. I have the right to work in the UK", hint: "A short plain sentence. Never enter passport or visa numbers." },
  },
  import: {
    title: "Import your CV.", body: "Upload your CV and our agents get to work. They read it and build your profile, then you go straight to the app. Anything missing or unclear is flagged in your profile for you to fix.",
    choose: "Choose your CV…", formats: "PDF, Word (.docx) or text file.",
    privacy: "To do this, the text of your CV is sent to Claude once. Your email address, phone number and LinkedIn link are removed first, on this Mac, before anything is sent.",
    tooShort: "There isn't enough text in that file to read. Try another file.", failed: "That didn't work. Try again in a moment.",
    stages: ["Reading your CV…", "Finding your jobs and skills…", "Checking each line against your own words…", "Flagging anything that needs your look…"],
  },

};

// The tables the screens read: worded for the chosen AI service (see service.ts).
export const ONBOARDING = branded(ONBOARDING_RAW);
