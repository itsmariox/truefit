# Evaluation: an OpenAI / ChatGPT sign-in as an alternative to Claude

**Date of this evaluation: 2026-11-19.** **Desk evaluation, no OpenAI model was run.** No OpenAI account, key or token was created or used, no model was called, no code was changed. Every web page below was read on 2026-11-19; where a page shows no date of its own I say "no date on page, read 2026-11-19". Models change fast: re-check every number before relying on it.

Note: `HANDOFF.md` and `ISSUES.md` do not exist in this worktree (only `README.md`, `SPIKE.md`, `docs/FIRST-RUN.md`, `docs/RELEASE-CHECKLIST.md`). `README.md` mentions `ISSUES.md` (I-07 to I-11) so it exists elsewhere; I could not read it.

> **Update 2026-11-19:** phases 1 to 7 of the build plan were built afterwards, on branch `openai-eval`, against pretend OpenAI services only. See `docs/OPENAI-BUILD-ISSUES.md` for what exists, what was found, and what still needs a real run. This evaluation itself is unchanged.

---

## Verdict

**Go with conditions. Confidence: medium on "it can be built", low on "it will be as good as Claude", low on "a ChatGPT sign-in is allowed for Truefit".**

The engineering is feasible and small if we put a provider seam in front of the Claude call and talk to OpenAI's Responses API directly (no bundled OpenAI program). Letting users run Truefit on a ChatGPT subscription is **not clearly allowed** today: OpenAI says the older route (Codex app-server login) "has never been permitted for commercial or hosted services", and its newer "Sign in with ChatGPT" (SIWC) route is described in one place as written for "open-source and locally hosted apps" and in another as "currently offered to a select group of commercial partners". Whether Truefit qualifies depends on whether it is free/open-source or sold, which the repo does not settle (LICENSE says MIT, README says the licence is "not decided"). So: **build the seam and an OpenAI API-key option first (option B); do not build the sign-in until OpenAI confirms in writing that Truefit may use it.** On quality there is no official number that speaks to Truefit's strict rules for either vendor, so quality is a RISK that only a real run can settle (test plan in section 4). The one OpenAI-published signal on our riskiest rule ("no invented facts") is a small regression, not a clear pass (see 4).

Why not higher confidence: the OpenAI launch post for GPT-6.2 (2026-11-17) and the SIWC terms page returned HTTP 403 to my fetcher, so I read neither directly (details in "What I could not verify").

---

## Options

| | A1: ChatGPT login via Codex app-server (managed login) | A2: ChatGPT sign-in via SIWC (own OAuth) + Responses API | B: OpenAI API key only (Responses API) | C: Do nothing |
|---|---|---|---|---|
| What it is | Bundle the Codex program; it owns the login and the model call | Truefit runs the OAuth flow itself, then calls `POST /v1/responses` with the user's plan token | User pastes an OpenAI API key; Truefit calls the Responses API | Claude only |
| Effort | High: new bundled binary, isolation unknown, new notice | Medium-high: OAuth client, token refresh, new UI rules | **Low-medium**: provider seam, one HTTP adapter, ledger prices | None |
| Main risk | Terms: "never permitted for commercial or hosted services"; Codex is a coding agent with its own tools, no documented way to turn them off | Eligibility unclear (partner waitlist vs open-source); preview limits; rotating refresh tokens; structured output not documented for this path | Quality unproven; user pays per token | Users without Claude access are locked out |
| Unlocks | Subscription use, only if terms allow | Subscription use ("Using ChatGPT plan"), the route OpenAI recommends | Any OpenAI user with a key; same model pricing as Claude's API ($2/$10 per 1M tokens for `gpt-6.2-sol` and `claude-sonnet-5-5`) | Nothing new |
| Recommendation | No | **Only after written eligibility and the conditions below** | **Yes, first** | Fallback if quality bars fail |

---

## Benchmark mapping: what Truefit needs vs what exists publicly

Claude model Truefit uses today: **`claude-sonnet-5-5`** for analyst, writer, checker and coach (`engine/config.json`), and `claude-haiku-5-5` for the connection test (`engine/src/access/connect.ts`). Best OpenAI candidates: `gpt-6.2-sol` (same list price as Sonnet 5.5) and `gpt-6.2-astra` ($8/$40, flagship), both released 2026-11-17.

| Truefit need | Best public proxy | OpenAI number (model, date, URL) | Claude Sonnet 5.5 number, same benchmark and date range | Verdict |
|---|---|---|---|---|
| Strict instruction following | No IFEval-type score found for either vendor. Closest: OpenAI's internal Model Spec "Targeted Cases" (738 compliance, 87 steerability cases) | Compliance pass: **GPT-6.2 Astra 87.8%, GPT-6.2 Sol 87.1%**, vs GPT-6 Astra 90.2% and GPT-5.6 Sol 83.3%; steerability 66.9% (Astra) / 59.2% (Sol). OpenAI GPT-6.2 system card, 2026-11-17, graded by a GPT-5.6 Sol grader. https://deploymentsafety.openai.com/gpt-6-2-astra-sol | **No comparable data** (OpenAI-internal eval, no Claude score) | **RISK** |
| Verbatim copying (bullets word for word) | None | None | None | **RISK, but mostly protected by code**: in `choose-and-order` mode (the default in `engine/config.json`) the Writer returns bullet IDs and code copies the text (`engine/skills/cv-writing`). Model-side risk is only in `reword` mode and in CV import (the model extracts bullets from the user's CV) |
| No invented facts | OpenAI "Performance in Cases Flagged by Users" (1,000 conversations where earlier models made reported errors). Result is a chart only; I read no per-model percentage | System card section 3.3: GPT-6.2 Astra and Sol had **lower error rates than GPT-6 Astra** at comparable response times. Section 4.1: compliance fell vs GPT-6 Astra, "much of the decline came from replies that omitted a required caveat or treated an unconfirmed detail as fact". The same card lists "propensity to disclose obstacles in work" as regressed (no figure). Same URL as above | **No comparable data** | **RISK, highest.** Our rule is "verified facts only"; the one OpenAI signal that touches it is mixed |
| Structured / JSON output reliability | No benchmark found | Docs: Structured Outputs "ensures schema adherence" for supported models, `gpt-6.2-sol` listed as supported (https://developers.openai.com/api/docs/guides/structured-outputs and https://developers.openai.com/api/docs/models/gpt-6.2-sol, no date on page, read 2026-11-19). No reliability percentage published. **Not documented for the ChatGPT-plan (SIWC) path** (https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) | Anthropic's launch page footnote says a pre-release deployment had "a bug that could degrade responses to requests that use structured outputs" (fixed). https://www.anthropic.com/news/claude-sonnet-5-5, 2026-09-28. Not a score | **RISK.** Guarantee is by the API, not a measured benchmark; our schemas look compatible (see Q3) but this must be run |
| Tool use / agent loops | Terminal-Bench (benchmark's own leaderboard) | **Terminal-Bench 4.1: GPT-6.2 Astra (max, Codex) 62.1% ± 2.3; GPT-6.2 Sol (max, Codex) 61.5% ± 2.8**, release date shown 2026-11-17 | **Sonnet 5.5 (max, Claude Code) 63.9% ± 3.0**, 2026-09-28. https://www.tbench.ai/ (read raw, 2026-11-19). Different harnesses; intervals overlap. Anthropic reports 70.6% on Terminal-Bench **4.0**, a different version, so it must not be mixed with the 4.1 rows | Roughly level on this proxy. Weak proxy: Truefit has no agent loop (`maxTurns` 4, one search tool only for the company brief) |
| Agentic coding (not a Truefit need, shown for completeness) | FrontierCode 1.1 Main | GPT-6 Sol 49.3% (older model, reported by Anthropic) | Sonnet 5.5 46.2% (Max) / 52.1% (Xhigh). https://www.anthropic.com/news/claude-sonnet-5-5, 2026-09-28 | No GPT-6.2 number on this version |
| Knowledge-work writing quality (closest to cover notes) | GDPval-AA v2.1 (Artificial Analysis) | GPT-6 Sol 1487 Elo (older model) | Sonnet 5.5 1844 Elo. Same Anthropic page. Anthropic's footnote: GPT-6 Sol image fix may not be reflected | **No comparable data for GPT-6.2** |
| Long-context reading of ad + profile | Not needed | `gpt-6.2-sol` context 1,050,000 tokens (model page). Our ads are capped at 30,000 characters (`maxAdChars`) plus a profile, far below any long-context limit | Sonnet 5.5 context size not retrieved | **Low risk, no benchmark needed** |
| Prompt-injection resistance (the ad is untrusted text) | OpenAI-internal | GPT-6.2 Sol 99.76%, Astra 99.23% resisted (benchmark environments); model-generated environments 91.65% / 84.67%. System card, 2026-11-17 | **No comparable data** | Informational |

Things with **no good public benchmark, so a real test is the only way to settle them**: verbatim copying in reword/import, invented facts in summaries and extras, Checker reliability (does it catch a planted false claim), schema validity on our own schemas, locked hard facts, ATS checks, tone of the extras.

Sources I saw and did **not** use because they are third-party (unverified): Vellum, DataCamp, Vals.ai and benchmarklist pages on GPT-6 Astra/Sol; their numbers conflicted with each other. A search summary also claimed "GPT-6.2 Sol within 0.5 points of Astra on FrontierCode 2.0"; I could not confirm it in a primary source.

---

## Answers to the 7 questions

### 1. What is OpenAI's equivalent of how we use Claude today?

Today: the Claude Agent SDK launches a bundled Claude program (310 MB unpacked in this checkout: `app/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`, 323,702,464 bytes) with every tool, MCP server, plugin and setting source switched off (`engine/src/agents/options.ts`), subscription login via the program itself.

| Candidate | What it is | Fit |
|---|---|---|
| **Responses API called directly** | Plain HTTPS, you send exactly the instructions and schema you built. Supports `text.format` json_schema strict, streaming, web search tool (https://developers.openai.com/api/docs/models/gpt-6.2-sol) | **Best fit.** Nothing bundled, no hidden tools, isolation is by construction. Works with an API key (B) and with a SIWC token (A2) |
| Codex CLI / app-server / `@openai/codex-sdk` | A coding agent (Apache-2.0 repo, latest release `rust-v0.170.0`, 2026-11-18). The TypeScript SDK controls a local Codex; Python SDK "controls the local Codex app-server over JSON-RPC" and "includes a pinned Codex CLI runtime dependency" (https://learn.chatgpt.com/docs/codex-sdk, no date, read 2026-11-19). `turn/start` accepts `outputSchema`, sandbox and approval options (https://learn.chatgpt.com/docs/app-server) | Poor fit. It is a coding harness with its own prompt and tools; I found **no documented way to turn all of its tools off or to list its tools at start-up**, which is what `isolationProblems()` relies on today |
| OpenAI Agents SDK (`@openai/agents`) | A library on top of the API: agent loop, handoffs, guardrails, tracing. No binary documented | Not needed (we have our own pipeline). **Privacy trap:** "Tracing is enabled by default in server runtimes (Node…)" and can be disabled with `OPENAI_AGENTS_DISABLE_TRACING=1` (https://openai.github.io/openai-agents-js/guides/tracing/, no date, read 2026-11-19) |

Recommendation: a thin direct Responses client behind a provider interface.

### 2. Can a user sign in with ChatGPT from a third-party desktop app?

Not clearly. What the primary sources say (all read 2026-11-19, none carry a date unless stated):

- Codex's own sign-in: "Sign in with ChatGPT for subscription access" vs API key, first-party use (https://learn.chatgpt.com/docs/auth).
- App-server login (A1): "If you've built a local or open-source application using Codex app-server authentication, you can continue using it, though we recommend migrating to Sign in with ChatGPT… **App-server authentication has never been permitted for commercial or hosted services.** We launched Sign in with ChatGPT to support these use cases… Join our partner waitlist." (https://learn.chatgpt.com/docs/app-server, "Auth endpoints")
- SIWC "ChatGPT plan usage" (A2): "written for open-source and locally hosted apps"; "Apps with paid or remotely hosted offerings" go to an interest form (https://developers.openai.com/siwc/token-sharing-open-source). Registration is dynamic (`client_id=dynamic_agent_client`, no separate application described) (…/token-sharing-open-source/sign-in).
- **Conflicting page:** "Sign in with ChatGPT is currently offered to a select group of commercial partners… join the waitlist" (https://developers.openai.com/siwc/request-client-id). I do not reconcile the two statements; only a real sign-in attempt or OpenAI's answer can.
- SIWC terms (https://openai.com/policies/sign-in-with-chatgpt-terms/) returned 403. A search-result summary (unverified, secondhand) said they are dated 2026-09-29 and forbid impersonating OpenAI, creating security risk or misleading users. **Read the real page before relying on any of this.**
- The wording is also a product-fit issue: apps must show "Using ChatGPT plan", a first-sign-in notice, a "Manage usage" link and use "Continue with ChatGPT" (https://developers.openai.com/siwc/ui-ux-guidelines).
- Preview limits on this path: `store` must be `false`, `stream` must be `true`, system-role messages are rejected, `temperature`/`top_p` and several tools are unsupported (…/preview-limitations).

Truefit's status: LICENSE is MIT; README says "name, licence and signing are not decided". I did not check Anthropic's equivalent terms (out of scope). **This decides the plan: if Truefit is sold or hosted, A1 and likely A2 are closed to it without OpenAI approval; if it stays free and local, A2 looks open but is described as a preview.**

### 3. How does the engine use Claude today, and what changes?

Every place (from reading the code; `grep -rli claude` lists 60+ files, the load-bearing ones are below):

| Place | What it does | Change for OpenAI |
|---|---|---|
| `engine/src/agents/runner.ts` `createSdkRunner` | One isolated SDK call per agent step; reads the SDK message stream (`init`, `assistant`, `result`, `rate_limit`), uses `structured_output`, `total_cost_usd`, `modelUsage`, `apiKeySource` | **Main seam.** Hide the SDK behind a provider interface returning a normalised result (answer, tokens, cost, error type, credential source) |
| Pipeline (`engine/src/pipeline.ts`): analyst, writer, checker, coach (verdict, delivered, question, failed), text-mode checker for extras | Fixed order, code checks every answer | None if the runner contract holds |
| CV import (`app-core.ts:212`, role `importer`) | Model extracts roles/bullets from CV text with contact details removed | Same schema; verbatim-extraction quality is a RISK |
| Interview (`app-core.ts:255`, role `interviewer`) | Chat that proposes profile changes, confirmed by the person | Same |
| Company brief (coach, `web: true`) | The only call with a tool (WebSearch, `maxTurns` 12) | Map to the Responses `web_search` tool; on the SIWC path web search is "subject to model and account/workspace policy" |
| Skills (`engine/skills/*/SKILL.md`, 12 folders) | **Plain markdown files**, front-matter stripped, pasted into the system prompt (`prompts.ts loadSkill`); not SDK skills (`skills: []`) | **Format carries over.** Text goes into `instructions` (system-role items are rejected on the SIWC path). XML-style `<job_ad>` blocks are plain text; tuned on Claude, so wording needs a real test |
| `engine/src/agents/schemas.ts` | JSON Schemas built with `S()`: every key required, `additionalProperties:false`, nullable via `type:["integer","null"]` | Matches OpenAI strict rules ("all fields … `required`", `additionalProperties: false`, root must be an object). Nullable unions are shown as `["string","null"]`; **`["integer","null"]` and `["number","null"]` are not shown, confirm on first run.** Limits (5,000 properties, 10 levels deep) are far above our schemas. (https://developers.openai.com/api/docs/guides/structured-outputs) |
| `agents/options.ts` | Closes every door, minimal environment, sets `ANTHROPIC_API_KEY`, `CLAUDE_CONFIG_DIR` | Not needed for a direct client (nothing to close), but the **"no silent switching" check** (`modeProblems`, `preflightProblems`) must be re-expressed per provider |
| `access/*` (`state`, `status`, `signin`, `connect`, `access`, `runtime`, `watch`, `messages`) | States, `claude auth status --json`, `claude auth login --claudeai` with link allow-list (claude.com, claude.ai, anthropic.com), connection test with `claude-haiku-5-5`, notice text, recovery watcher | New provider dimension; new sign-in module (OAuth with loopback `127.0.0.1`, host allow-list `auth.openai.com`); new notice and messages; SDK error names in `agents/errors.ts` become OpenAI codes (`subscription_sharing_usage_limit_exceeded` 429, `…_usage_unavailable` 503, `…_user_not_eligible` 403, `…_invalid_user` 401) |
| `access/ledger.ts` | Usage table from the SDK's `total_cost_usd`; spend cap applies to API-key mode only; subscription shows request counts | Needs a maintained price table (tokens × price) because the API gives tokens, not dollars (not re-verified: standard `usage` fields in the response) |
| Settings keys `claude.mode`, `claude.noticeAcceptedAt`; `store/secrets.ts` names; renderer `Connect.tsx`, `Onboarding.tsx`, `SettingsPage.tsx`, message files; `contract.ts` | Claude-named UI and storage | Rename or add `ai.provider`; copy changes |
| Tests and tooling: `core/fake-claude.ts`, `engine/tests/live-*.ts`, `engine/evals/reword-keywords.ts`, `app/e2e/*`, `scripts/package.ts` | Fake provider for the packaged test; live runs | Fake becomes a fake provider; live scripts take a provider argument |

### 4. Quality from benchmarks, the harness, and a test plan

What the official numbers say: see the mapping table. In one sentence: on the only like-for-like public benchmark (Terminal-Bench 4.1) the two are within error bars, and for every Truefit-specific need (strict rules, no invented facts, verbatim, JSON) there is **no comparable published number**. Our strict rules ranked by risk: (1) no invented facts in summary and extras, (2) Checker catching a false claim, (3) CV-import fidelity, (4) strict JSON on our schemas via the SIWC path, (5) locked hard facts and ATS checks (these are code-enforced after the model, so lower risk), (6) verbatim bullets in `choose-and-order` (code-copied, lowest).

**Existing harness:** `engine/src/eval/keywords.ts` is pure code (keyword coverage); `engine/evals/reword-keywords.ts` calls `createSdkRunner` with an injectable `query` function over 6 fictional ads in `engine/evals/ads/`, and `engine/tests/live-run.ts` runs one full job on the fictional profile `engine/tests/fixtures/profile-priya.json`. So **yes, the same fixtures and scoring can score an OpenAI model** as soon as the provider seam exists (the harness never sees the vendor). It scores keyword coverage and code validators, not factual honesty; that needs the additions below.

**Test plan for when you have access (not run):**
- Same fictional profile (`profile-priya.json`, plus `profile-sam.json`), the 6 existing ads, plus two new fictional ads: one that tempts invention (asks for a skill the profile lacks) and one with an injected instruction. `choose-and-order` first, then `reword`.
- Models: `gpt-6.2-sol` and `gpt-6.2-astra` vs `claude-sonnet-5-5`, **all run in the same session**, 3 repetitions per ad, same skills text, temperature left at defaults, model and snapshot recorded. Re-run Claude then; do not reuse remembered numbers.
- Pass bars (proposed, you decide):
  1. Schema valid on first try, all roles: 100% (any failure is reported with its case).
  2. Code validators pass first time (selection, limits, ATS, locked facts): at least Claude's rate minus 5 points; **locked hard facts violated: 0** in all runs.
  3. Bullets word for word: 100% match to profile text in `choose-and-order`; in `reword`, 0 changed facts on blind review of 20 outputs.
  4. Invented facts: blind human review of every summary and extra for the 8 ads; unsupported claims no higher than Claude's count, and **0 invented employers, numbers or tools**.
  5. Checker: plant 10 false claims into valid text; detection at least 90% and no worse than Claude.
  6. Keyword coverage within 3 points of Claude; injection ad: instruction not followed.
  7. Report latency and cost per job; informational.
- Any bar 3 or 4 failure on a model means that model is not offered.

### 5. Security and privacy

- **Where tokens go:** reuse `SafeStorageSecretStore` (Electron safeStorage, key in Keychain "Truefit Safe Storage"). Needed changes: new names in its `KNOWN` list (`store/secrets.ts`), and **its `set()` rejects values over 2,000 characters** while a SIWC record (ID, access and refresh tokens, scopes, issued client ID) may exceed that. OpenAI's docs suggest plain files under `~/.config/…` with mode 0600 (…/sign-in); our encrypted store is stronger. "Delete everything" already removes the Keychain item.
- **Rotating refresh tokens + parallel jobs:** `refresh_token_reused` is a listed failure (…/errors-and-recovery). With several jobs in flight we need a single-flight refresh and an atomic write (the store already writes tmp-then-rename).
- **If a Codex program were bundled (A1):** it caches logins in `~/.codex/auth.json` (plaintext unless `cli_auth_credentials_store` is `keyring`), so it would read or write the user's **own** Codex login unless `CODEX_HOME` is redirected, the same problem `CLAUDE_CONFIG_DIR` solves for Claude. Its telemetry defaults are unverified; README promises none.
- **What leaves the machine:** the same material as now (ad text, the masked profile text, CV text with contact details removed), but to OpenAI instead of Anthropic. SIWC adds a persistent opaque `ext_agent_host_id` and an app name (`agent_name_hint`) registered with OpenAI, and a local listener on `127.0.0.1`. Requests must use `store:false`. ChatGPT sign-in follows the user's workspace retention settings, API-key use follows API data settings (https://learn.chatgpt.com/docs/auth); I did not read OpenAI's API data-retention policy.
- **"Everything stays local" promise:** the wording in `README.md`/`PRODUCT.md` ("only what Claude needs") must become provider-neutral; the promise itself still holds for B and A2 (no Truefit server, no telemetry). It would **not** hold if the Agents SDK tracing default were left on.
- **Personal-data guard:** unchanged in principle (contact details are removed by code before text leaves). `security.ts` link/navigation allow-lists need the OpenAI sign-in host; the personal-data tests must still pass.

### 6. Cost and usage

Official prices (https://developers.openai.com/api/docs/models and the model page, no date, read 2026-11-19), per 1M tokens in/out: GPT-6.2 Astra $8/$40; **GPT-6.2 Sol $2/$10** (cached input $0.10; input above 272K tokens doubles); GPT-6.1 Terra $1/$5; GPT-6 Luna $0.10/$0.50. Sonnet 5.5: $2/$10, cache reads $0.10 (https://www.anthropic.com/news/claude-sonnet-5-5, 2026-09-28). Batch is 50% of standard. Rate limits for Sol: Build tier 5,000 requests/min and 1,000,000 tokens/min, far above one user's use.

- **API key (B):** spend cap works as now, but dollars come from our own price table, so prices must be versioned and a stale table would misreport. The cap is still checked before each call.
- **ChatGPT plan (A2):** no dollars. Plus is $20/month; limits are "local messages per five-hour period", estimated and variable: Sol 17-180, Astra 6-50, Terra 35-285, Luna 350-3,000; Free and Go get Luna only; Pro has no five-hour limit (https://learn.chatgpt.com/docs/pricing, no date, read 2026-11-19). A Truefit job makes roughly 5 to 8 model calls (analyst, writer, checker, up to 2 coach calls, extras); **how a "message" maps to our calls is not documented**, so jobs per window is unknown. A limit arrives as `subscription_sharing_usage_limit_exceeded` (429); OpenAI says "don't … infer a reset time" and an app-specific limit may apply, so the existing 15-minute lapse in `state.ts` fits. Required display: "Using ChatGPT plan", a "Manage usage" link, and a first-sign-in notice. Codex app-server also offers `account/rateLimits/read`.
- Usage screen: keep "requests, not billed per request" for the plan path, as the subscription line does today.

### 7. Packaging

- **Direct client (A2/B):** no new binary; bundle size unchanged; fuses and signing unchanged. Optionally the packaged build could even drop the Claude binary if Claude were ever removed (not proposed).
- **Bundled Codex (A1):** latest release assets for macOS arm64 are 88.5 MB (`codex-app-server`, compressed) and 114.5 MB (`codex`, compressed); uncompressed size not measured; x86_64 is larger. It would need adding to the `asar.unpack` list in `app/scripts/package.ts`, the existing ad-hoc `codesign --deep` step, and Hardened Runtime/notarisation (phase 10, not done and undecided) would have to cover it. Fuses are unaffected.
- **Packaged test with a fake provider:** the mechanism exists (`__TEST_BUILD__`, `fake-claude.ts`, the `MARKER` check in `package.ts` that the release build contains no test hooks). Generalise `fakeQuery` into a fake provider that returns the normalised result; `e2e/packaged.test.ts` then runs unchanged. A fake local HTTP server can also test the OpenAI adapter and OAuth, including a rotated refresh token.

---

## Proposed build plan (small steps, each testable with a fake provider first)

0. **Decisions** (below). No code.
1. **Provider seam.** Define one normalised call result; wrap the current Claude SDK call in it; no behaviour change. Test: whole existing suite passes with the fake provider.
2. **OpenAI adapter against a fake HTTP server.** Responses streaming, strict schema, error and usage mapping, never real network. Test: fixtures written from the docs.
3. **Ledger and cap.** Price table, tokens to dollars, cap for API-key mode, plan-mode request counting. Test: ledger tests with fake usage.
4. **Access and storage (API key).** `ai.provider` setting, new secret name, test-connection call, messages. Test: access tests with fake provider.
5. **UI for provider choice** in Connect, Onboarding, Settings; copy updated. Test: renderer and accessibility tests, preview scenarios.
6. **Packaged test** with the fake provider; release build checked for test hooks.
7. **Real-run gate (needs your OpenAI access):** run the test plan; ship option B only if bars pass.
8. **Only if eligibility is confirmed in writing:** SIWC sign-in (OAuth, token store, single-flight refresh, "Using ChatGPT plan"), again against a fake auth server first.

## Decisions for you

1. Will Truefit be free/open-source and local, or sold or hosted? (decides whether A1/A2 can ever apply)
2. Licence: keep MIT, or change? (README says undecided)
3. Do you want me, or you, to ask OpenAI about eligibility (partner waitlist form)? I did not submit anything.
4. Ship B (API key) first, before any sign-in?
5. Which OpenAI model per role (e.g. Sol for all, Astra for writer/checker), and a cost ceiling per job.
6. One provider at a time for all roles, or per-role mixing (I recommend one at a time).
7. Acceptable label if bars are only partly met (for example "experimental").
8. Wording of the privacy promise per provider.
9. Whether `reword` mode is offered on OpenAI before it has passed its own bar.

## What I could not verify, and what needs a real run

- **The OpenAI GPT-6.2 launch post** (https://openai.com/index/introducing-gpt-6-2-astra-sol/, dated 2026-11-17 per search) and the **SIWC terms** returned 403. I have no OpenAI-published benchmark table from the launch post; the only OpenAI-published numbers I read are from the system card. Search summaries mentioned GDPval and FrontierCode 2.0 claims there; unverified.
- The **Claude Sonnet 5.5 system card** was not read, so I have no Anthropic-published instruction-following, hallucination or long-context figures to set against OpenAI's. Several rows are therefore "no comparable data", which may mean "not looked up" rather than "does not exist".
- Terminal-Bench 4.1 (OpenAI rows, Sonnet row) and the Anthropic page were read raw (downloaded and grepped); the Terminal-Bench leaderboard shows 4.1 while Anthropic reports 4.0, so I did not compare across versions. Other page figures (pricing, limits, SIWC pages, app-server) were read through a summarising fetch tool, plus raw grep for the app-server auth section and the system card; treat them as summarised.
- Whether SIWC is open to a non-commercial open-source app today, given the two conflicting pages. Whether `gpt-6.2-sol` and structured outputs work on the ChatGPT-plan path. Whether `["integer","null"]` is accepted by strict mode.
- How Codex "local messages" translate into Truefit jobs per five-hour window.
- Whether any Codex program can be run with no tools and no telemetry; whether it reads `~/.codex`.
- Sonnet 5.5's own context size and structured-output behaviour on our schemas under today's SDK.
- **Everything about quality on our own rules** (invented facts, verbatim, Checker detection, import fidelity, JSON validity, tone) and about **latency**: needs the real run in section 4 before you rely on any of it.
