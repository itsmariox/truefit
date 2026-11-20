# Release checklist (nothing here has been done; each item needs the owner's go-ahead)

Decide first: final name and bundle id; licence; signing identity (Apple Developer account) and notarisation; whether Claude-based CV import and `osascript` notifications are wanted (ISSUES I-07 to I-11); whether "Connect ChatGPT" ships before OpenAI confirms Truefit's eligibility and the Sign in with ChatGPT terms are read; approval of the OpenAI wording (docs/OPENAI-BUILD-ISSUES.md).

Then, in order:
1. Put the final name in `APP_NAME` (`app/src/shared/contract.ts`), `appBundleId` and the name in `app/scripts/package.ts`, the README, `docs/FIRST-RUN.md` and the window title.
2. Add the licence file and the third-party notices (Electron, React, the Claude SDK and program, fflate, pdf.js, Crimson Text font: OFL).
3. Add the app icon (`.icns`) and the menu-bar icon.
4. Run `node scripts/publication-check.ts` (in `app/`) and remove every personal name, employer, place and figure it finds from the files that will be published (the PHASE and PRD documents still name the owner). Keep `private/` out of the repository.
5. Sign and notarise the release `.app` (`@electron/osx-sign`, `@electron/notarize`) with the real identity, then `npm run dmg`.
6. Run on a clean Mac (no Claude login, no Chrome): first launch, "Open Anyway" or notarised launch, connect, profile, one real job, one real CV, Telegram pairing, export, delete everything.
7. Run `npm test`, `npm run e2e`, `npm run e2e:packaged`, `npm run e2e:release`, `node e2e/quality.test.ts` and fix anything that fails.
8. Only then: create the repository and the release, and publish the update-check endpoint if the daily check is built (ISSUES I-14).
