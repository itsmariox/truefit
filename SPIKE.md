# Technical spike results (2026-11-16)
Tested on this Mac (Apple Silicon, Claude Code 2.1.322, Agent SDK 0.3.323, Electron 45.3.3). Throwaway test app was built in the scratchpad and its test Keychain item removed.

## 1. Claude login (PRD 09 questions)
| Question | Answer | Evidence |
|---|---|---|
| Is there a free status check? | YES. `claude auth status` makes no model call and returns JSON: loggedIn, authMethod ("claude.ai"), loginExpiresAt, subscriptionType, planTier (plus email and org, which the app must not display or store). | run on this Mac |
| How does the SDK find the login? | The SDK package ships its own Claude binary (`claude-agent-sdk-darwin-arm64`, 336 MB unpacked) and uses the stored claude.ai login. An option lets it use another executable (`pathToClaudeCodeExecutable`). | package contents and type file |
| Error types the app can map | authentication_failed, oauth_org_not_allowed, account_on_hold, verification_required, billing_error, rate_limit, overloaded, model_not_found, server_error, max_output_tokens, unknown. | SDK type file |
| Quota reset time? | Available: rate-limit events carry the limit type (five_hour, seven_day, per-model) and reset times; results carry the login's end date. | SDK type file |
| Real quota use per job | Not measured in quota terms. Measured in API-equivalent cost from 11 real jobs (below). | `jobs/*/usage.jsonl` |
| What happens when Anthropic refuses subscription use? | NOT TESTED. Probably surfaces as authentication_failed or oauth_org_not_allowed; unverified. | |

## 2. Real cost of a job (11 jobs, Sonnet 5.5, API-equivalent USD, not subscription quota)
- Analysis only (verdict): 2 Claude calls, about $0.11, about 33 s.
- Built CV job: median 10 calls, median $0.45, about 86 s, about 140k input tokens. Heaviest: 22 calls, $1.04, 227 s (many rewrites plus all extras).
- All 11 jobs together: $4.29. Skipped jobs cost about $0.10 each.
- Note: the SDK also reports cost and rate-limit utilisation, so a real "% of the five-hour window used by one job" can be measured with one live run before and after (not done).

## 3. Unsigned Electron app on macOS
| Feature | Result |
|---|---|
| Packaged and ad-hoc signed automatically | yes (Apple Silicon needs at least this) |
| Menu-bar (tray) icon | works |
| Keychain-backed secret storage (safeStorage) | works, round trip OK |
| Start at login | works (status "enabled") |
| HTML to PDF (printToPDF) | works |
| macOS notifications | FAILED in two runs ("notifications not allowed", UNErrorDomain 1). Cause not established: could be the permission prompt never answered because the test app quit in seconds, or a limit of ad-hoc signed apps. Unresolved. |
| Gatekeeper "Open Anyway" on a downloaded copy | NOT TESTED (needs an interactive click-through). |
| Size | Electron alone 252 MB unpacked; the SDK's bundled Claude binary adds 336 MB |

## 4. Not done
Resume parsers on the PDFs. Notification test with a long-running app. Gatekeeper flow. Quota-percent measurement. Bundled binary sharing the login with the user's own `claude`.

## 5. What this changes
1. **DECIDED (bundled; recorded in PRDs 01, 09, 13): "Claude Code not installed" no longer exists as a step.** The SDK carries its own binary. Decide: use the bundled binary (bigger download, no install step, app must run its sign-in itself, shared-login behaviour untested) or point the SDK at the user's installed `claude` (smaller, keeps the install step).
2. **PRD 09: reset time, expiry and plan can be shown** from free data. Reconnect banner can be driven by authentication_failed and loginExpiresAt.
3. **PRD 07: macOS notifications are not proven.** Needs a retest; fallback is the menu-bar icon badge and the in-app banner.
4. **Download size** will be large (likely 300 MB or more compressed). State it in the README.
5. **Cost line for the README:** a verdict costs about 10 cents of API usage, a built CV about 45 cents (median); on a subscription this draws from the plan allowance instead (amount unmeasured).

## 6. Follow-up test (2026-11-16)
The bundled Claude binary, run directly, reported the same stored login as the user's own `claude` (logged in, Pro, same expiry). Shared login confirmed on an already-logged-in Mac. First-time sign-in from inside the app remains untested.

## 7. Correction (2026-11-16, phase 1 step 5)
Section 3's HTML-to-PDF result and the earlier PDF spike used the Mac's system Palatino (CID TrueType). The bundled TeX Gyre Pagella (CFF/OpenType) is stored as Type 3 by Chrome. Pdf readers all coped, but the product now bundles a TrueType font (Crimson Text) and refuses Type 3. See PHASE1.md.
