# OpenAI option: build issues log

Running record of problems, gaps, assumptions and decisions found while building the "Connect ChatGPT" / OpenAI API-key option (branch `openai-eval`). Companion to `docs/EVAL-OPENAI-LOGIN.md`. Started 2026-11-19. Nothing here was tested against a real OpenAI service: every OpenAI call in the tests goes to a fake local server written from OpenAI's published docs.

Status key: **OPEN** needs a decision or a real run; **NOTED** known limitation, accepted for now; **FIXED** found and fixed during the build.

## Build status (2026-11-19)

| Phase | What | State |
|---|---|---|
| 1, 1b | Provider seam in the runner; Claude behind it; fake provider for the test build | built, tested |
| 2 | OpenAI provider (Responses API, strict JSON schema, streaming, error and cost mapping) | built, tested against a pretend OpenAI |
| 3 | ChatGPT sign-in record in the secret store, single-flight token refresh | built, tested |
| 4 | "Connect ChatGPT" sign-in flow (OAuth + PKCE, loopback, ID-token check, sign-out) | built, tested against a pretend OpenAI |
| 5 | Provider setting, access states, pauses, connection test, API-key connect, usage and spend cap, IPC | built, tested through the real app core |
| 6 | Screens: Claude / OpenAI choice, ChatGPT notice, Continue with ChatGPT, Manage usage, Disconnect; service-aware wording | built, tested (renderer, accessibility) |
| 7 | Packaged test build run through the whole ChatGPT story; release build checked for test hooks | done: 10 new packaged checks pass; the 22 existing packaged checks still pass; the release bundle holds none of the hooks |
| 8 | Real run: first real sign-in, first real call, the quality test plan | **NOT DONE: needs your OpenAI access and decisions below** |

**Nothing in this build has ever talked to the real OpenAI.** Every OpenAI call in every test goes to a pretend service on localhost that I wrote from OpenAI's documentation. The tests prove the app does what the docs say; only phase 8 proves that OpenAI does what the docs say.

Test counts (before the final review fixes; re-run results are in the last commit message): engine suite (all files, including 5 new OpenAI suites) passes; app `npm run check` passes (104 renderer tests incl. 4 new OpenAI and 2 new accessibility ones, plus the node suites incl. `openai-core`, `fake-provider`, secret-store, security); packaged: `e2e:packaged` 22 checks and the new `e2e:packaged-openai` 10 checks.

Run it yourself: `cd engine && npm test`; `cd app && npm run check`; `cd app && npm run e2e:packaged-openai` (opens a window briefly; builds the test bundle first); browser preview of the screens with a pretend OpenAI: `npm run preview`, then `?scenario=openai`.

## Decisions made by the owner (2026-11-19)

- **Models approved:** `gpt-6.2-sol` for all four roles, `gpt-6-luna` for the connection test (issues 7, 33). Still a recommendation, not a measured choice: the quality of these models on Truefit's rules is unproven.
- **Phase 8 skipped for now:** there is no OpenAI account. A beta tester will be the first real test of the OpenAI option; their findings settle issues 20 to 22, 25, 26, 6, 8, 9, 17, 33 and the quality plan.
- **Ship as beta, before OpenAI confirms eligibility:** decided (this was decision 3 of the list below). The ChatGPT sign-in ships enabled. The risk the owner accepts: OpenAI may refuse Truefit's registration, or later object under the (still unread) Sign in with ChatGPT terms; the app then shows the plain failure messages and offers the API key or Claude. The OpenAI screen carries a visible "Beta" note. Nothing in the option has run against the real OpenAI.
- **Not done, because not asked:** nothing was pushed, merged or published; the signed/notarised distribution is not set up (unsigned local builds only).

## Decisions still waiting for you

1. Approve (or rewrite) the OpenAI wording in `engine/src/access/messages-openai.ts`, including the ChatGPT-plan notice (issue 32), and the mechanical "Claude" to "OpenAI" re-wording of the screens (issue 41).
2. Confirm the models: `gpt-6.2-sol` for all four roles and `gpt-6-luna` for the connection test (issues 33, 7).
3. ~~Whether to ship "Connect ChatGPT" before OpenAI confirms eligibility~~ DECIDED: ship it, as a beta (see above). The terms are still unread.
4. Licence and whether Truefit is free and local (you said yes: the sign-in path assumes it).
5. Rewrite the README / PRODUCT.md privacy promise to be service-neutral (issue 41).
6. Whether the ledger needs a provider column so Settings can show the two services separately (issues 34, 42).
7. When you have OpenAI access: run phase 8 (below).

## Phase 8 (when you have access), in order

1. `cd app && npm run dev`, choose OpenAI, "Use my ChatGPT plan", "Continue with ChatGPT". Expect: the browser opens, consent screen, back to the app, "ChatGPT is connected". This settles issues 20 to 22, 25, 26.
2. "Test connection" (one tiny call on `gpt-6-luna`), then analyse a fictional job. This settles issues 6, 8, 9, 17, 33.
3. The quality test plan in `docs/EVAL-OPENAI-LOGIN.md` section 4, using `CVAPP_LIVE=1 CVAPP_PROVIDER=openai OPENAI_API_KEY=... node evals/reword-keywords.ts <folder>` (API key path), run on the same day as the same test on Claude.

## Phase 1 and 1b (provider seam, fake provider)

| # | Status | Issue |
|---|---|---|
| 1 | NOTED | `HANDOFF.md` and `ISSUES.md` do not exist in this worktree; `README.md` refers to `ISSUES.md` (I-07 to I-11). This log is separate on purpose. |
| 2 | NOTED | `engine/node_modules` is a symlink to the main checkout's copy (this worktree had none). It shows as untracked and is never committed. |
| 3 | OPEN | `connect.ts` (test connection, API-key validation), sign-in, status check and access states are still Claude-only; handled in the later phases below. |
| 4 | NOTED | The fake-Claude stream test exercised the Claude provider's isolation check; the provider-level fake skips it. Both are kept (`CVAPP_FAKE_CLAUDE` default, `CVAPP_FAKE_PROVIDER` optional). |

## Phase 2 (OpenAI adapter, fake HTTP server)

| # | Status | Issue |
|---|---|---|
| 5 | FIXED | `redact()` (engine/src/checks.ts) only removed Claude keys, the Claude OAuth token and Telegram tokens. An OpenAI key (`sk-...`, `sk-proj-...`), a JWT or a `Bearer ...` echoed in an error message would have reached logs and the job's error text. Now redacted for all three shapes, and the provider also removes the exact token it used. Covered by a test. |
| 6 | OPEN | Stream events (`response.output_text.delta`, `response.completed`, `response.failed`, `response.incomplete`, `error`) and the `usage` fields (`input_tokens`, `output_tokens`, `input_tokens_details.cached_tokens`, `cache_write_tokens`) are taken from OpenAI's Responses API reference and streaming guide (read 2026-11-19). The ChatGPT-plan path may differ in small ways; only a real call shows it. |
| 7 | OPEN | Cost is computed from tokens with a hand-kept price table (`openai-prices.ts`). Only `gpt-6.2-sol` has cached-input and cache-write prices on the pages I read; for Astra, Terra and Luna the full input price is used (figure can only be too high). Prices change; an unknown model costs 0. |
| 8 | OPEN | Strict mode: all our schemas pass an offline check of OpenAI's published rules (every key required, `additionalProperties:false`, depth and size limits). That we use `type:["integer","null"]` and `["number","null"]` unions is not shown in OpenAI's docs (only `["string","null"]`); whether the API accepts them is unconfirmed until a real call. |
| 9 | OPEN | Web search for the company brief (`tools:[{type:"web_search"}]`): OpenAI says on the plan path web search is "subject to model and account/workspace policy". If refused, the company brief fails on the plan path. The error would arrive as `subscription_sharing_unsupported_capability` (400), mapped to a plain failure. |
| 10 | NOTED | No reasoning effort or `max_output_tokens` is sent; the model's default is used. Sol "always reasons" (effort `none` is rejected), so latency and token use are unknown until the real run. Timeouts stay at the existing 300 s / 420 s. |
| 11 | NOTED | A plan usage limit never gets a reset time (OpenAI: do not infer one); the existing 15-minute lapse in `state.ts` applies. An API-key rate limit keeps its `Retry-After`. |
| 12 | NOTED | Config model names (`engine/config.json`) are all Claude names. The OpenAI provider needs its own model per role (phase 5). |

## Phase 3 (secrets, token record, single-flight refresh)

| # | Status | Issue |
|---|---|---|
| 13 | FIXED | The secret store refused any value over 2,000 characters, which a three-token sign-in record would exceed. Now 24,000 for the ChatGPT sign-in record only; every other secret keeps 2,000 (tested in `app/tests/secret-store.test.ts`). |
| 14 | NOTED | Correction to the evaluation doc: it said OpenAI "doesn't document the refresh request". The accounts-and-sessions page does (form: `grant_type=refresh_token`, issued `client_id`, `refresh_token`, `resource`; omit `scope`). The code follows that page. |
| 15 | NOTED | Refresh is single-flight inside this process (tested with 8 parallel callers). The app is single-instance, so no cross-process lock was built. |
| 16 | NOTED | If the app is killed or the secret write fails after OpenAI rotated the refresh token but before the new one is saved, the saved token is dead and the next renewal fails as `refresh_token_reused`: the user must connect ChatGPT again. The window is small; the cost is one re-sign-in. |
| 17 | OPEN | The token response has `earliest_refresh_at`. We renew when under 2 minutes remain and do not read that field. If OpenAI refuses refreshes before that time, renewal would fail near expiry. Needs a real run. |
| 18 | NOTED | The e-mail address is not stored as a field (the app never uses it), but the retained ID token (needed as `id_token_hint`) contains it; it is encrypted in the secret store and never shown, logged or exported. "Delete everything" removes all three new secrets (it loops over every secret name). |
| 19 | FIXED | Erase rules follow OpenAI. A dead refresh token (`invalid_grant`, `refresh_token_expired`, `..._reused` etc.) erases the TOKENS and asks to connect again; `invalid_client`, a network failure or a 5xx keep everything. **Correction (found in review):** the first version erased the whole record, including the issued `client_id`, on Disconnect and on a dead token, so every reconnect registered a NEW app on the user's ChatGPT account (my pretend service hid it by issuing a fresh id each time). OpenAI says sign-out "does not create a new client" and a dead token means "repeat OAuth with the saved issued client ID". The registration (issuer, client id, account) is now a separate secret that survives both; the next connect reuses it, sends no `agent_name_hint` and no `id_token_hint`. Tested at three levels (store, sign-in flow, app core) and in the packaged test. |

## Phase 4 (the "Connect ChatGPT" sign-in flow)

| # | Status | Issue |
|---|---|---|
| 20 | OPEN | The whole flow (authorize parameters, loopback callback carrying `code`, `state`, `client_id`, `scope`, the form-encoded token exchange, discovery, JWKS, revocation) is written from OpenAI's docs and tested against a pretend service built from the same docs. It proves our code does what the docs say, not that OpenAI's service behaves as the docs say. The first real sign-in is the test. |
| 21 | OPEN | ID-token signature: the docs say to verify against OpenAI's published JWKS but do not name the algorithm. Only RS256 and ES256 are accepted (never `none` or HS*). If OpenAI signs with another algorithm (PS256, EdDSA), every sign-in would fail as `invalid_identity`. |
| 22 | OPEN | Parameters `agent_name_hint` and `ext_agent_host_id` go in the authorize URL's query string; the docs list them among the authorization parameters but the exact placement was read from a table, not an example. |
| 23 | OPEN | The Sign in with ChatGPT terms page returned 403 to my fetcher, so I have not read the terms the app must follow. OpenAI's UI guidelines (read) require the button text "Continue with ChatGPT", a first-sign-in notice, a "Using ChatGPT plan" indicator and a Manage-usage link; those are phase 6 items. |
| 24 | NOTED | One ChatGPT account at a time. A returning sign-in as a different account is refused (`invalid_identity`) and the saved credentials are left alone; switching accounts means signing out first. OpenAI's docs describe a multi-account picker; not built. |
| 25 | OPEN | A user who declined plan use, or whose workspace does not allow it, ends as `plan_not_enabled` (record kept, plan not usable). OpenAI's docs describe re-asking with `prompt=consent` or `force_reconsent=true`; not implemented. Connecting again repeats the normal flow and may not re-show the consent screen. |
| 26 | NOTED | The client "stays bound to its registered workspace" (docs). A user who wants a different ChatGPT workspace must sign out (which keeps the registration on OpenAI's side) and connect again; whether that offers a workspace choice is unknown until a real run. |
| 27 | NOTED | The module takes an `openUrl` function; the app must pass one that opens only addresses on `auth.openai.com` (host allow-list like `allowedLink` for Claude). Wired in phase 5. |
| 28 | NOTED | The listener binds `127.0.0.1` only, prefers port 1455 (OpenAI's example) and falls back to a free port; it accepts one valid callback, answers other paths and wrong `Host` headers with 404 and a wrong `state` with 400 without ending the attempt, and is closed on every exit (tested). |
| 29 | NOTED | The link shown to the user never contains the retained ID token; the browser is opened with it (OpenAI: "redact authorization URLs containing that hint from logs"). |

## Phase 5, engine part (provider setting, access state, runtime, wording, connection test)

| # | Status | Issue |
|---|---|---|
| 30 | NOTED | The setting that holds the chosen way to connect is still named `claude.mode` (it now means "the chosen way to connect" for either service). Renaming it would need a data migration for no user benefit; documented in code. Switching service resets it to "not chosen" on purpose. |
| 31 | FIXED | Export and import: this Mac's chosen service (`ai.provider`) and the ChatGPT notice date (`openai.noticeAcceptedAt`) must stay on this Mac like the Claude ones. The export filter and the import's "keep these" rule only knew `claude.*` and `telegram.*`; both now also keep `ai.*` and `openai.*` (tested). |
| 32 | OPEN | Wording: `messages-openai.ts` is a new DRAFT catalogue (states, pauses, sign-in, test, key, the ChatGPT-plan notice). The Claude catalogue is "the owner's to approve"; this one needs the same approval. The notice text also has to satisfy OpenAI's rule of a first-sign-in notice, which the terms page (unread, issue 23) may word more strictly. |
| 33 | OPEN | Models: `engine/config.json` now has `openaiModels` (all `gpt-6.2-sol`, my recommendation, not tested). The connection test uses `gpt-6-luna`; whether a ChatGPT plan can use Luna (Free/Go get only Luna per the pricing page, Plus is listed with it) is unverified. If a plan account lacks a model the call fails as `model_not_found`/`invalid_request`, mapped to a plain failure. |
| 34 | FIXED | The usage ledger has no provider column: Claude and OpenAI calls are summed together in the monthly figures and the ONE monthly spend cap (API-key mode) covers both services' key spend. That is probably what a user wants, but the Settings "Use this month" screen would label them together. Changing the table needs a migration; deferred. **Done:** the ledger has a `provider` column (migration 5; every earlier call is backfilled as Claude), and Settings shows Claude and OpenAI use on separate lines once OpenAI has been used. The one monthly spend cap deliberately covers API-key spend on BOTH services. |
| 35 | NOTED | Plan limits: no reset time is ever shown for a ChatGPT plan limit (OpenAI says not to infer one); the existing 15-minute lapse applies, and the message sends the user to ChatGPT Usage settings. |
| 36 | NOTED | The recovery watcher's sign-in check (`checkStatus`) is provider-aware: for OpenAI it reads the saved sign-in record (no network). A re-connect is seen because a record exists again and `signedIn()` clears the remembered error. |
| 37 | NOTED | "Plan permission not granted" is treated as not connected (the plan cannot be used until the user connects again and allows it); the sign-in result for that case has its own message (`plan_not_enabled`). |

| 38 | FIXED | The full engine suite failed after the engine part of phase 5 (`delete.test.ts`): it stored only two secrets and expected every secret name to be reported removed. I committed phase 5 before seeing it (my command chain did not stop on the failure) and fixed it in the next commit. The test now stores ALL five secrets, which also proves "Delete everything" wipes the OpenAI key, the ChatGPT sign-in and the host id. |

## Phase 5 (app core, handlers) and Phase 6 (screens)

| # | Status | Issue |
|---|---|---|
| 39 | FIXED | `Button` (ui.tsx) silently dropped `aria-pressed`: TypeScript allows any hyphenated attribute, so the new Claude / OpenAI toggle looked pressed to nobody but sighted users. Found by the new renderer test; `Button` now forwards it. |
| 40 | FIXED | The screen-wording wrapper (`service.ts`, `branded()`) first broke the first-run guide: a message table held a React element (frozen, read-only `props`) and a Proxy may not lie about those. Wrapping now skips frozen objects and React elements. Found by the existing guide tests. |
| 41 | OPEN | The screens' own wording (privacy lines, "Connect ...", job messages, settings) is re-worded for the chosen service by replacing the word "Claude" with "OpenAI" at read time. That keeps every claim about where text goes true, but the result is mechanical: for example "Tone of OpenAI's messages", "OpenAI's note", "Connect OpenAI" (the plan path would read better as ChatGPT). The wording needs the owner's read-through. Also not updated: `README.md`, `app/PRODUCT.md`, `docs/FIRST-RUN.md` still describe a Claude-only app, and the README promise "the only things that leave your Mac are what Claude needs" must become provider-neutral before release. **Partly done:** README, PRODUCT.md, FIRST-RUN, NOTICES and the release checklist are now service-neutral (drafted by me; please read them). The in-app wording is still the mechanical Claude to OpenAI swap. |
| 42 | FIXED | "Use this month" lines in Settings say "Subscription ... requests" and "API key ..." with no service name (the ledger has no provider column, issue 34). **Done:** see 34. With only Claude in use the lines read exactly as before. |
| 43 | OPEN | OpenAI's UI guidelines ask for "Using ChatGPT plan" near the composer or model selector, a first-sign-in welcome notice ("You're using your ChatGPT plan" / "Got it") and a Manage-usage link. Truefit has no model selector: the indicator is in the top status line and the Connect/Settings card, the notice is the tick-box notice plus the "ChatGPT is connected" result. Whether that satisfies the (unread) terms is OpenAI's call. |
| 44 | OPEN | "Open ChatGPT usage settings" goes to `https://chatgpt.com/settings/usage` (a URL taken from OpenAI's docs); for an API-key problem the link goes to `https://platform.openai.com/` (the home page, because I have no verified deep link to billing). |
| 45 | NOTED | `app:openLink` now also allows `chatgpt.com` and `openai.com` (and subdomains), with the same rules as Claude's list (https, no port, no user name, host read from the parsed link). The Claude sign-in link filter is unchanged, so the Claude program still cannot hand the app an OpenAI address. |
| 46 | NOTED | There is no "remove my API key" button for either service (pre-existing). ChatGPT has "Disconnect ChatGPT" (revokes at OpenAI, then clears the record). |
| 47 | NOTED | New channels `access:chooseProvider` and `access:signOut`; `AccessView` gained `provider`. The browser preview (`?scenario=openai`) has a pretend OpenAI flow for the screens. |
| 48 | FIXED | In the test build, saving an OpenAI API key would have called the REAL OpenAI service (the key check used the real provider even when a fake provider was installed). It now uses the fake provider when one is set. |

## Phase 7 (packaging and the packaged test) and the real-run prep

| # | Status | Issue |
|---|---|---|
| 49 | NOTED | New hooks, test build only (compiled out of the release build; verified by searching the release bundle): `CVAPP_OPENAI_BASE` (a pretend OpenAI on localhost), `CVAPP_FAKE_BROWSER` (a stand-in browser that follows the sign-in redirect), `CVAPP_FAKE_PROVIDER`. A new packaged test (`e2e/packaged-openai.test.ts`) runs the real sign-in, a real analysis, Manage usage and Disconnect in the packaged window against the pretend OpenAI, checks that the Keychain item exists and that no token is readable anywhere in the data folder, and cleans its Keychain item up. |
| 50 | NOTED | Size: the OpenAI path adds no bundled program (plain HTTPS from the existing app): both the test and release bundles are 731M here, the same as before; fuses and signing are unchanged. The Claude program (about 310 MB unpacked) is still bundled. |
| 51 | NOTED | The test packaging re-signs the local test and release bundles ad hoc, as the existing script already did. No signing for distribution, no notarisation, nothing published or pushed. |
| 52 | FIXED | `e2e:release` (launches the release bundle) was not run, only built and inspected. **Done:** the release bundle was rebuilt with the final code and launched (`e2e:release` passes: fuses flipped, stays up 10 s, no crash); a search of it finds none of the test hooks. |
| 53 | FIXED | The security test insisted every `shell.openExternal` goes through the link allow-list; the new sign-in opener first did not. It now goes through `openLinkDecision` too (and the core refuses any address that is not the sign-in service's authorize URL). The test now expects exactly three call sites, all through the allow-list. |
| 54 | FIXED | `engine/evals/reword-keywords.ts` takes `CVAPP_PROVIDER=openai` (with `OPENAI_API_KEY`) to run the same eval through OpenAI. `tests/live-run.ts`, `live-gate` and `live-access` are still Claude-only. **Done:** `tests/live-run.ts` also takes `CVAPP_PROVIDER=openai` + `OPENAI_API_KEY`. `live-gate` and `live-access` test Claude's own program and login and stay Claude-only on purpose. |
| 55 | OPEN | Quality: none of the bars in the evaluation doc's test plan has been run (no access). The defaults (Sol for every role) are a recommendation, not a measured choice. |
| 56 | OPEN | Reasoning cost: Sol always reasons and bills reasoning tokens as output; per-job cost and latency are unknown until a real run. The 300 s / 420 s timeouts may need tuning. |
| 57 | NOTED | No new run-time dependency was added (the sign-in uses Node's `http`, `crypto` and `fetch`); the packager's module check still passes. |

## Fixes after the final review

| # | Status | Issue |
|---|---|---|
| 58 | FIXED | "Use a different ChatGPT account" (new button, `access:signOut {forget:true}`): keeping the registration would otherwise lock a user to the first account for ever (a different account on the saved client is refused as `invalid_identity`). It removes the registration too; the next connect registers anew. Tested. |
| 59 | FIXED | "Delete everything" never ended the ChatGPT session at OpenAI (the session stays valid there for up to 30 days). It now revokes first (best effort, while the tokens still exist) and reports a warning when OpenAI could not be told. |
| 60 | FIXED | A token refresh that finished after the user had signed out or connected again could overwrite the newer record with the older session's tokens. It now re-reads the record before writing and discards its result if the record changed. Tested with a deliberately slow refresh. |
| 61 | FIXED | A test accepted either "expired" or "not connected" for a sign-in without the plan permission. Pinned: "not connected" before the first attempt, "expired" after the failed attempt. |
| 62 | FIXED | Switching service in Settings has no confirmation. It drops the chosen way to connect, and a job paused under one service and resumed after switching finishes on the other, so one CV can mix Claude and OpenAI steps. **Done:** switching from a set-up connection asks first (Connect screen). A job records which service started it (`ai-service.txt` in the job folder; a job from before this with an analysis counts as Claude); build, extra, resume and analyse on a job started with the other service are refused with a plain sentence naming both services, and the runner refuses as a backstop (nothing sent). Tested in the engine, the app core and the screens. |
| 63 | NOTED | Honest record: commit `8e81955` contains a failing test (`delete.test.ts`); `f05f9c8` fixes it. The packaging script ad-hoc re-signed the local test and release bundles (no identity, nothing distributed). `engine/node_modules` is an untracked symlink to the main checkout's copy. Nothing was pushed. |
