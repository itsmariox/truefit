# Profile schema v2 (2026-11-18; PHASE 1 BUILT on the engine side, see ISSUES.md; sections 7 and 12 and the languages/certifications/projects extraction are NOT built yet; the four open decisions in section 11 were answered by the owner on 2026-11-18; the spec as a whole still needs his go-ahead to build)

Why: the profile must become a hands-off, agent-fed "vault" without losing the promise that nothing untrue reaches a CV. Today every item carries `status: draft | verified` (the user ticks it). The new rule is **provenance**: where a fact came from decides whether it is trusted. This page fixes the SHAPE and the RULES so they can be approved before any code. Already decided by the owner: trust the user's own words and flag AI inferences; on-device voice; locked hard facts are name, city, country, email, phone, LinkedIn, right to work / visa status.

This is an ENGINE change, not a profile-page change: it reaches the stored profile, every job's snapshot, export and restore, the Telegram bot and the importer (section 9).

## 1. Top level
```
Profile {
  schemaVersion: 2
  locked:      Locked        // hard facts, wired into every lens, never written by an agent
  facts:       Facts         // everything a CV can be built from
  lenses:      Lens[]        // today's "focus types"
  preferences: Preferences   // what the user wants (today's "rules"); user-owned
  guards:      Guard[]       // today's "do not use": never reach a model, checked by code
  sources:     Source[]      // the CVs and interviews the facts came from
  review:      ReviewState   // the user's dismissals and accepts (the cards themselves are computed)
}
```

## 2. Locked (hard facts)
`identity { name, city, country }`, `contact { email?, phone?, linkedin?, links[] }`, `work { rightToWork: string, needsSponsorship: boolean, visaNote?: string }`.
- **Contact details are extracted by CODE on the Mac, never by Claude.** The CV is masked before Claude sees it (email, phone, LinkedIn), so Claude cannot be the source of these fields. Nobody may later send the unmasked CV to Claude to "extract contacts". The name has no reliable pattern: code proposes the most likely name from the top of the CV and the user confirms or types it (one field, shown at the end of import).
- `visaNote` is a free sentence ("British citizen", "needs sponsorship"). The app never asks for passport, visa or ID numbers (PRODUCT.md rule stays).
- After the first fill, ONLY the user's own edit can change a locked field. Imports and agents may only PROPOSE a change; it becomes a `locked-change` review card.
- The CV header and the verdict read these fields from code.

## 3. Facts (each wears a `meta`)
```
meta { id, origin: "cv" | "said" | "typed" | "inferred" | "legacy", trust: "trusted" | "review", sourceId?, quote?, tags[], addedAt }
Role   { id, title, company, location, start, end, bullets: Bullet[], story?: Story, meta }
Bullet { id, text, tags[], metrics?: string[], onlyForLenses?: number[], meta }
Skill  { name, group?, level?: "core" | "working" | "familiar", meta }
Education { id, text, meta }   Language { name, level: "native" | "fluent" | "professional" | "basic", meta }
Certification { id, name, issuer?, year?, meta }   Project { id, name, text, tags[], meta }
```
**Trust is set by CODE, never by a model**, with these rules:
- origin `cv`: the text is found WORD FOR WORD in the source text (code normalises whitespace and case) -> `trusted`; found only loosely or not at all -> `review`.
- origin `typed` (the user wrote it in the editor) -> `trusted`.
- origin `inferred` (a summary, a guessed skill, anything not in a source) -> `review`.
- origin `legacy` (v1 data): see section 10.
- origin `said` (interview or voice): see decision A in section 11. Code cannot judge speech turned into a bullet, so the rule must be chosen.
- **What editing does:** editing a `review` item makes it `typed` and therefore trusted. This means fixing a comma in an AI-invented bullet accepts it. That is deliberate (the user looked at it and changed it) and is shown in the card ("you edited this: it is now yours").
- **What "accept" on a review card records:** `trust: trusted`, `origin` unchanged, `acceptedAt` and `acceptedBy: "user"`. A dismissed card is stored by a stable key and stays dismissed until its facts change.
- **Scope of "only trusted reaches a model":** only `trusted` facts reach the CV-building agents (analyst, writer, checker, coach). The IMPORTER sees the raw CV (contacts masked) and the INTERVIEWER may see items under review (masked), because it must be able to ask "your two CVs disagree about X".

## 4. Lenses, preferences, guards
- `Lens { id, name, headline, leadTags[], meta }` (focus types renamed). `Bullet.onlyForLenses` is today's `onlyForFocus`.
- `Preferences { salaryFloor, location { current, targets, workModes, cvLocationLines }, seniority { levels, avoid }, avoidRoles, availability? }`: set by the user; an agent may only suggest a change through a review card.
- `Guard { id, kind: "phrase" | "skill" | "gap", text, note }`: unchanged.

## 5. Sources
`Source { id, kind: "cv" | "interview", label, addedAt, textHash, text? }`. Decision C in section 11: keep the MASKED source text on disk (enables "found here" on a card and re-matching after migration) or only the hash.

## 6. Review cards (computed, not stored)
`ReviewItem { id, kind: "contradiction" | "inferred" | "unmatched" | "duplicate" | "gap" | "locked-change", factIds[], message, options[] }`. Code derives them after every change. Detectors: impossible or overlapping dates, two sources disagreeing about a date, title, company or number, claimed years the dates do not support, near-duplicate bullets across CVs (merge offer), an inferred or loosely matched item, a proposed change to a locked field, a thin role (fewer than three bullets). Resolving a card applies a patch.

## 7. How anything changes the profile
One function, `applyPatch(profile, ops, actor)`, actors `user | import | interviewer | system`:
- refuses a write to `locked` or `preferences` by a non-user actor once the field is set (it becomes a review card);
- stamps `meta` (origin, source, trust by section 3);
- validates the whole result (schema, ids, dates, no contact details in free text) and refuses an invalid patch;
- records an undo log. The undo log is personal data: it lives in the data folder, "Delete everything" removes it, and the export does NOT include it (the export carries the profile as it is).

## 8. What the CV-building agents see
A compact text view of `trusted` facts only, ids outside the text, tag-ranked for the job by code BEFORE the model runs (top 20 to 30 bullets). Agents return selections by id; code rejects ids that are not trusted; the Checker still traces every CV line to a fact id. Derived views (agent view, ranking, completeness hints) are computed, never stored.

## 9. Everything that reads or writes a profile (the real cost)
The stored profile in the database; each job's `profile-snapshot.json` (old jobs resume and "Build again" from a v1 snapshot, so every snapshot is converted ON READ); export and restore (a v1 export restored into a v2 app); the Telegram bot; `profileToPersona` and `meetsStartGate`; `profile-md.ts`; the import merge and the importer skill; the renderer's own `P` type in `Profile.tsx`; the preview mock bridge; the fixtures and `fake-claude`; the delete code. The start gate becomes: name and city (locked), one role with at least 3 TRUSTED bullets, where you live and want to work (preferences), right to work (locked).

## 10. Migration v1 -> v2
`identity` and `rules.rightToWork` -> `locked`; `rules` (rest) -> `preferences`; `focusTypes` -> `lenses`; `doNotUse` -> `guards`; `onlyForFocus` -> `onlyForLenses`; `status verified` -> `origin legacy, trust trusted`; `status draft` -> `origin legacy, trust review`. A v1 file is backed up, converted on load, and never written back as v1. Round-trip tests on the fictional fixture profiles. v1 stored no source text, so migration cannot re-match old bullets against a CV: see decision B.

## 11. Decisions (answered by the owner, 2026-11-18)
- **A. The "said" rule: (b).** The agent reads each interview fact back in chat; the user's "yes" (or a fix) is the confirmation. Recorded as origin `said`, `confirmedIn: "conversation"`, with the `quote`. Facts the user has not answered stay `review`.
- **B. Migrating the owner's own profile: (a).** Re-import the same CV once; code re-matches every bullet word for word and trusts the matches; unmatched items become review cards. (The v1 `status` is kept as a hint only; it does not make an item trusted.)
- **C. Source text: keep it.** The MASKED text of each imported CV is kept on this Mac (data folder), removed by "Delete everything", excluded from the export, and used for "found here" on cards and for re-matching.
- **D. Name: code proposes, the user confirms** once at the end of import.
- **E. Interviewer limits (2026-11-18).** Chat is read-back with the user's yes (decision A). Only the HARD FACTS (name, city, country, email, phone, LinkedIn, right to work) are refused to the interviewer; preferences and the Never-say lists are NOT locked from it, and deleting is not forbidden, but every interviewer change (add, edit, remove) is proposed, read back by code, and applied only after the user's button press. Built as `engine/src/profile-patch.ts` (`applyPatch`, with undo ops recorded in the log). The interview page is a full-page reacting sphere (reference: a glass bubble with a blue-pink glowing core), text first, voice in phase 4.

## 12. Out of scope for the first build
Skill levels from the model, automatic metric extraction, locking education and past-employer dates (the owner chose to keep them editable), a PDF export of the profile.
