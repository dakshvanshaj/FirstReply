# Set it up

You need Docker and Node 18+. Node is only used for the tests and `build.js`; n8n itself runs in Docker.

## 1. Run n8n locally

From the repo folder:

```bash
docker run -d --name n8n -p 5678:5678 -e GENERIC_TIMEZONE=Asia/Kolkata -e TZ=Asia/Kolkata -v n8n_data:/home/node/.n8n -v "$PWD:/files" docker.n8n.io/n8nio/n8n
```

Open <http://localhost:5678> and create your login.

## 2. Google Sheet

Create a Sheet with two tabs.

**`Leads`**: row 1 headers, in this order:

```text
Received at, Lead ID, Name, Phone, Email, Source, Interest, Owner, Status, Flags
```

- Give `Status` a dropdown: `New, Contacted`.
- Format `Received at` as plain text (Format → Number → Plain text).

**`Settings`**: headers `Role, Team, Name, WhatsApp, Email`:

| Role | Team | Name | WhatsApp | Email |
|---|---|---|---|---|
| Team Owner | Sales | *name* | *number* | *email* |
| Fallback Owner | | *name* | *number* | *email* |

- Format the WhatsApp column as plain text, with the country code, e.g. `919800000001`.
- `Fallback Owner` is used when a lead's team doesn't match any `Team Owner` row, or when no team is sent at all.

## 3. Credentials in n8n

- **Google Sheets OAuth2 and Gmail OAuth2** (one OAuth client covers both; enable the Sheets, Drive and Gmail APIs):
  1. In Google Cloud, create an OAuth client with redirect URI `http://localhost:5678/rest/oauth2-credential/callback`.
  2. Add the credential in n8n and sign in.
- **WhatsApp:**
  1. On developers.facebook.com, create an app and add WhatsApp.
  2. On API Setup, add and verify your phone as a recipient. Copy the *Phone number ID*, the *WhatsApp Business Account ID* and the access token into an n8n **WhatsApp API** credential.
  3. **Before replying to leads on WhatsApp in production**, get a message template approved in Meta's WhatsApp Manager — a business can't freely message someone who hasn't messaged first.
- **Webhook secret:**
  1. Create a **Header Auth** credential named `Intake webhook secret`, with header name `X-Intake-Secret` and a long random value.
  2. Copy `.env.example` to `.env` and put the same value in it.

## 4. Build, import, publish

```bash
SHEET_ID=<sheet id> WA_PHONE_ID=<phone number id> node build.js
```

```bash
docker exec n8n n8n import:workflow --input=/files/workflow.json && docker exec n8n n8n publish:workflow --id=firstReplyLeads0001 && docker restart n8n
```

Open the workflow and pick your credentials on the webhook node, every Google Sheets node, both Gmail nodes and both
WhatsApp nodes. Then publish. Re-importing resets the credential picks, so pick them again after every rebuild.

## 5. Try it

```bash
./send-test.sh payloads/new-lead.json
```

| Payload | What should happen |
|---|---|
| `new-lead.json` | New row in Leads, instant email reply, WhatsApp alert to the Sales owner |
| same file again | Still one row; `Status` stays whatever it was set to |
| `missing-fields.json` | Row flagged `Missing: name, what they're asking about`, alert starts `⚠` |
| `no-contact.json` | Row flagged `No phone or email to reply to`; no reply sent, owner still alerted |

To see the morning digest now, open **Every morning** in the editor and click *Execute workflow*.

To run the rule tests: `node respond.test.js` should print `respond ok`.

## Going live with a real intake source

**Route 1: native webhook (recommended).**

1. In the form/ad platform (see the [field mapping](intake-mapping.md) for where this lives per source), point its
   webhook or Zapier/Make integration at the production webhook URL, with the header `X-Intake-Secret`.
2. n8n must be reachable from the internet: n8n Cloud, or a tunnel.

**Route 2: Google Forms, which has no native webhook.**

1. Add a small Apps Script trigger on form submit that posts the response as flat JSON to the webhook URL.
2. Map whatever keys that script sends in `fromIntake()`.

**Before going live:** capture one real payload from the client's actual intake source and adjust `fromIntake()`
in `respond.js` — start from the [intake field mapping](intake-mapping.md) if they use Typeform, Google Forms,
Meta Lead Ads, WhatsApp, or a generic contact form.
