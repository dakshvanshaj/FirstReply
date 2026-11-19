# FirstReply (n8n)

[![Tests](https://github.com/dakshvanshaj/FirstReply/actions/workflows/test.yml/badge.svg)](https://github.com/dakshvanshaj/FirstReply/actions/workflows/test.yml)

Never let an interested lead go quiet — a new-lead instant-response automation.

**Docs:** https://dakshvanshaj.com/first-reply/

- [What it does and why](docs/index.md)
- [How it works](docs/how-it-works.md): the flow, the after-hours rule, flags
- [Set it up](docs/setup.md): run locally, credentials, test payloads, going live
- [Intake field mapping](docs/intake-mapping.md): Typeform, Google Forms, Meta Lead Ads, WhatsApp, generic form

Quick check of the rules: `node respond.test.js` should print `respond ok`.
Rebuild `workflow.json` after editing `respond.js`: `SHEET_ID=<id> WA_PHONE_ID=<id> node build.js`.
