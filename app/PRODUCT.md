# Product

<!-- impeccable:product-schema 1 -->

## Platform

web
<!-- an Electron desktop app for macOS: a web renderer in a native window; the macOS conventions are kept (see DESIGN.md) -->

## Users
Job seekers on a Mac who apply to many jobs and are not technical. They want to know quickly whether an ad is worth their time, and to send a tailored one-page CV that never claims anything untrue. They are busy, often anxious about their CV, and wary of AI inventing things. Confirmed by the owner: "job seeker applying often".

## Product Purpose
Reads a pasted job ad (or one link) against the user's own VERIFIED profile and returns an honest verdict (Apply, Long shot, Skip) with a fit score, how it matches the user's own rules, strengths and gaps. On request it builds a one-page ATS-checked CV and short extras (cover note, recruiter message, interview prep, company brief) written only from facts the user has confirmed. Success: the user knows within a minute whether to apply, and everything they send is true.

## Positioning
Truthful by construction: only facts that came from the user's own words (their CV, or what they typed or said) ever reach the AI service (Claude or OpenAI, the user's choice), every CV is checked twice against them, and everything stays on the user's Mac (no accounts, no telemetry). A general chatbot cannot promise that.

## Brand
Name: Truefit (chosen by the owner on 2026-11-17 from three directions; trademark and availability NOT checked). Voice: modern, direct, a little bold; score first, then proof. Honest about uncertainty. Icon: a fit ring with a tick (black and white). Colours (changed 2026-11-18 by the owner): plain white, grey and black, with green only for a good result and red only for an error or a destructive action. No brand colour.

## Constraints
- Look (changed 2026-11-17 by the owner): a slick, simple, chat-first, "agentic" look (soft surfaces, pill controls, 15 px type, a conversation-style job page); light and dark still follow macOS. Earlier commitment to a 13 px macOS-native look is replaced.
- UK English, plain words, no jargon; user-visible wording is catalogued and approved in bulk.
- Accessibility: every control named, contrast at least 4.5 to 1 (checked in a real window by `npm run e2e:quality`), no colour-only meaning (verdicts use icon plus word).
- Privacy: the page never receives file paths, secrets or API keys; contact details are removed before CV text goes to the AI service.
- Connection to Claude (subscription sign-in or API key) or OpenAI (ChatGPT plan sign-in or API key); a job is carried on only by the service that started it; the app works only while it is open (Telegram is optional).

## Assets and evidence
App icon concept: `/tmp` board only (not yet a file). Existing screens and tests are in `app/src/renderer` and `app/tests`.
