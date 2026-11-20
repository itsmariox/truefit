# Truefit (working name)

A Mac app that reads a job ad against your own verified profile, tells you whether it is worth applying, and builds a one-page CV and short extras (cover note, recruiter message, interview prep, company brief) from facts you have confirmed. It uses an AI service you choose: Claude (your own subscription or an API key) or OpenAI (your ChatGPT plan or an API key). Everything else stays on your Mac.

Status: **pre-release, not yet published.** The name, licence and signing are not decided (see `ISSUES.md`, I-07 to I-11).

## What you need
- A Mac with Apple silicon (an Intel build has not been made).
- A Claude subscription or an Anthropic API key, or a ChatGPT plan or an OpenAI API key. Nothing else to install: the Claude program is inside the app, and OpenAI is reached directly. Using a ChatGPT plan is a preview that OpenAI may change or stop.

## First launch
The app is not signed yet, so macOS will warn you the first time. See `docs/FIRST-RUN.md`.

## What it does
1. **Connect** to Claude or OpenAI (sign in with your Claude subscription or ChatGPT plan, or paste an API key).
2. **My profile**: your details, roles and achievements, skills, education and rules. Only facts you tick as true are ever shown to the AI service.
3. **New job**: paste an ad (or one link). You get a verdict (Apply, Long shot, Skip), a fit score, how it matches your own rules, strengths and gaps.
4. **Build CV**: a one-page PDF written only from your verified facts, checked twice before you see it. **Extras** on request.
5. **History**, **Settings** (notifications, tone, accent, spend limit, export, delete everything), and optional **Telegram** (use your own bot from your phone while the app is open).

## Privacy
No telemetry, no analytics, no crash reports. The only things that leave your Mac are what the AI service you chose (Claude or OpenAI) needs to do its work, Telegram messages if you turn Telegram on, and a job link you paste (read once by the app). Your API keys, your ChatGPT sign-in and your bot token are kept encrypted, protected by the macOS Keychain. If you use your ChatGPT plan, requests count towards your plan's usage, which you can see and manage in ChatGPT settings. "Delete everything" in Settings removes them all. Details: `prd/11-privacy-security-data.md`.

## For developers
```bash
cd app && npm install
npm run dev          # the real app in development
npm run preview      # the pages in a browser with a pretend connection (http://localhost:5190/?scenario=jobs)
npm test             # every test that needs no screen
npm run e2e          # the real app in Electron (needs a screen)
npm run package      # a local, unsigned release .app (dist/release)
npm run e2e:packaged # builds the test .app and runs the packaged tests
npm run dmg          # an unsigned disk image of the release app
```
The engine (`engine/`) holds the profile, the job pipeline and the Claude access code; the app (`app/`) is Electron + React. `PHASE*.md` record how it was built; `ISSUES.md` lists what is still open.
