# humanizer (third-party skill, pinned)

- Source: https://github.com/blader/humanizer
- Commit: b48c832f0f809c1b5658edbb838c2521b72f2413 (2026-11-10), SKILL.md version 4.0.0
- Licence: MIT, Copyright (c) 2025 Siqi Chen. The licence text is in `THIRD_PARTY_NOTICES.md` and must ship with the skill.
- SKILL.md is copied unchanged (SHA-256 below). The repo's `scripts/validate-package.py` and `agents/openai.yaml` are not used.
- Used by: the Coach only, for messages and extras written for the user. Never for CVs.
- Local precedence (set in coach-reply): the user's chosen tone decides the emoji rule; offers are made with buttons, not closing questions.
- Size note: the skill is about 32 KB and is sent with every Coach call; a trimmed edition could save tokens, but only after evals show the messages stay good.
- To update: fetch a newer commit, read the whole file again, then replace it here and update this note and the hash.
804a119e924ac30295b298213e0b71b3e38b2667b8ef4fb7b69e9246369b9045  skills/humanizer/SKILL.md
