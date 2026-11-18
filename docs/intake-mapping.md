# Intake field mapping

`fromIntake()` in `respond.js` is the one place that needs adjusting per client. Below is the starting map for
five common lead sources. **Verify against one real webhook payload before going live** — this is the fast
starting point, not a guarantee, especially for Typeform and Meta where the raw payload is nested.

| Our field | Typeform | Google Forms | Meta Lead Ads | WhatsApp (inbound) | Generic contact form |
|---|---|---|---|---|---|
| `id` | `form_response.token` | n/a — assign one in the Apps Script step | `leadgen_id` | `messages[].id` | whatever the form posts, or generate one |
| `name` | an answer in `form_response.answers[]`, matched by field ref | mapped by your Apps Script trigger | a `field_data` entry named `full_name` | `contacts[].profile.name` | `name` |
| `phone` | an answer with `type: "phone_number"` | same, Apps Script-mapped | `field_data` entry named `phone_number` | `messages[].from` | `phone` |
| `email` | an answer with `type: "email"` | same, Apps Script-mapped | `field_data` entry named `email` | not applicable | `email` |
| `source` | hardcode `"Typeform"` | hardcode `"Google Forms"` | hardcode `"Meta Lead Ad"` | hardcode `"WhatsApp"` | hardcode to the site name |
| `interest` | the free-text answer, matched by field ref | same | a custom question's `field_data` entry | `messages[].text.body` | `message` |

**Google Forms has no native webhook** — the common bridge is a small Apps Script trigger on form submit (or
Zapier/Make's Google Forms trigger) that posts a flat JSON object. Whatever keys that script chooses to send are
the ones to map here; there's no fixed Google field-name list the way there is for the others.

**Typeform and Meta Lead Ads both nest answers in an array** rather than flat fields, so `fromIntake()` needs a
small array-search (match by field ref / field name) rather than a direct `body.name` read — see the comment in
`respond.js` for where that logic goes once you have a real payload.

The same pattern extends to any form tool or ad platform with a webhook or Zapier/Make integration, not just
these five.
