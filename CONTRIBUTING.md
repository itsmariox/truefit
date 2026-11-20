# Contributing to Truefit

Thanks for helping. Truefit is pre-release, so small, focused changes are easiest to review.

## Set up

You need a Mac with Node 24.

```bash
cd app && npm ci
cd ../engine && npm ci
```

## Scripts

From `app/`:

| Command | What it does |
|---|---|
| `npm run dev` | the real app in development |
| `npm run preview` | the pages in a browser with a pretend connection (`http://localhost:5190/?scenario=jobs`) |
| `npm run typecheck` / `npm run lint` | type check (`tsc --noEmit`) and the lint type check |
| `npm test` | every test that needs no screen |
| `npm run check` | type check, lint and all tests (what CI runs, in three steps) |
| `npm run e2e` | the real app in Electron (needs a screen) |
| `npm run package` / `npm run dmg` | a local, unsigned `.app` / disk image |
| `npm run e2e:packaged` | builds the test `.app` and runs the packaged tests |
| `npm run publication-check` | looks for personal terms in files that would be published |

From `engine/`: `npm test`.

## Run the tests

```bash
cd engine && npm test
cd ../app && npm run check
```

CI runs both on every push and pull request. The Electron tests (`e2e*`) need a logged-in desktop session, so run them on your Mac before a release (see [docs/RELEASE-CHECKLIST.md](docs/RELEASE-CHECKLIST.md)). The tests use fictional sample data and fake AI services; none of them calls a real AI service unless you run the live scripts yourself.

## Pull requests

1. Open an issue first for anything large, so we can agree on the direction.
2. Branch from `main`, keep the change small, and add or update a test.
3. Make sure `npm test` in `engine/` and `npm run check` in `app/` pass.
4. Fill in the pull request template. Explain what changed and why.

## No personal data in commits

Never commit real names, employers, cities, salaries, emails, phone numbers, CVs or file paths that contain your username. Use fictional data ("Sample Person") in tests, fixtures, screenshots and examples. Before you push, run:

```bash
node app/scripts/publication-check.ts
```

It needs a git-ignored `private/personal-terms.local.ts` listing the terms to look for; without it the check exits with code 2 and proves nothing. Never commit that file.

## Conduct and security

Everyone takes part under the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as described in [SECURITY.md](SECURITY.md).
