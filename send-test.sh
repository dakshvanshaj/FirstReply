#!/bin/sh
# Posts a generic lead-shaped sample to the local n8n webhook.
# Usage: ./send-test.sh [payloads/new-lead.json]
cd "$(dirname "$0")" && . ./.env
curl -sS -w ' HTTP %{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -H "X-Intake-Secret: $INTAKE_SECRET" --data @"${1:-payloads/new-lead.json}" \
  http://localhost:5678/webhook/new-lead-intake
