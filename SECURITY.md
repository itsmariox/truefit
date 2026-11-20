# Security policy

## Reporting a vulnerability

Please report it privately. Do not open a public issue.

Use GitHub's private vulnerability reporting: go to this repository's **Security** tab and choose **Report a vulnerability**. [OWNER TO CONFIRM: private vulnerability reporting is switched on in the repository settings.]

## What is in scope

- The Truefit app and its engine (this repository).
- How it stores and sends data: keys and sign-ins kept in the macOS Keychain, the local database, exports and "Delete everything".
- Anything that could make the app send data somewhere other than the AI service the user chose, or Telegram if the user turned it on.
- The release build and its published SHA-256 checksums.

Out of scope: vulnerabilities in Electron, macOS, Claude or OpenAI themselves (report those to their owners), and the fact that the pre-release DMG is unsigned, which is known and documented.

## What to include

- What you found and what an attacker could do with it.
- Steps to reproduce, with fictional data only. Please do not send real CVs, keys or tokens.
- The Truefit version, macOS version and which AI service you used.
- Any suggested fix, if you have one.

You will get an acknowledgement as soon as the maintainers can manage; this is a small volunteer project and there is no guaranteed response time.

## Supported versions

Truefit is pre-release. Only the latest release is supported.
