// Builds workflow.json (importable into n8n) with respond.js inlined into the Code nodes.
// Run: SHEET_ID=<id> WA_PHONE_ID=<id> node build.js
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const LOGIC = fs.readFileSync(path.join(__dirname, 'respond.js'), 'utf8');
const SHEET_ID = process.env.SHEET_ID || 'REPLACE_WITH_SHEET_ID';
const WA_PHONE_ID = process.env.WA_PHONE_ID || 'REPLACE_WITH_WHATSAPP_PHONE_NUMBER_ID';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}`;

const doc = { __rl: true, mode: 'id', value: SHEET_ID };
const tab = (name) => ({ __rl: true, mode: 'name', value: name });
const sheetsCred = { googleSheetsOAuth2Api: { id: process.env.GSHEETS_CRED_ID || 'frGoogleSheets01', name: 'Google Sheets account' } };
const waCred = { whatsAppApi: { id: 'frWhatsApp0000001', name: 'WhatsApp account' } };
const gmailCred = { gmailOAuth2: { id: process.env.GMAIL_CRED_ID || 'frGmail00000000001', name: 'Gmail account' } };
let n = 0;
const node = (name, type, typeVersion, position, parameters, extra = {}) =>
  ({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, name, type: `n8n-nodes-base.${type}`, typeVersion, position, parameters, ...extra });
const sticky = (name, content, position, width, height, color) =>
  node(name, 'stickyNote', 1, position, { content, width, height, color });
const readRows = (name, sheet, position, extra = {}) =>
  node(name, 'googleSheets', 4.7, position, { documentId: doc, sheetName: tab(sheet), options: {} }, { credentials: sheetsCred, alwaysOutputData: true, executeOnce: true, ...extra });
const whatsapp = (name, position, to, text) =>
  node(name, 'whatsApp', 1.1, position, { operation: 'send', phoneNumberId: WA_PHONE_ID, recipientPhoneNumber: to, textBody: text, additionalFields: {} }, { credentials: waCred, onError: 'continueRegularOutput' });
const gmail = (name, position, to, subject, text, isHtml = true) =>
  node(name, 'gmail', 2.1, position, { sendTo: to, subject, emailType: isHtml ? 'html' : 'text', message: text, options: { appendAttribution: false } }, { credentials: gmailCred, webhookId: `9e1a0000-0000-4000-8000-${String(n + 1).padStart(12, '0')}` });

const BUILD_RESPONSE = `${LOGIC}
const lead = fromIntake($('Intake – new lead').first().json.body);
const settings = $('Read Settings').all().map((i) => i.json);
const existing = lead.leadId ? ($('Read existing lead').all().map((i) => i.json).find((r) => String(r['Lead ID']) === lead.leadId) || null) : null;
const r = buildResponse(lead, new Date(), settings, existing);
return [{ json: { ...r.row, _replyPhone: r.replyPhone, _replyEmail: r.replyEmail, _replyText: r.replyText, _ownerTo: r.to || '', _ownerEmail: r.ownerEmail || '', _ownerText: r.ownerText, _subject: r.subject, _html: alertHtml(r, '${SHEET_URL}') } }];`;

const BUILD_DIGEST = `${LOGIC}
const rows = $('Read Leads').all().map((i) => i.json).filter((r) => r.Status);
const text = dailyDigest(rows, new Date(), '${SHEET_URL}');
const html = digestHtml(rows, new Date(), '${SHEET_URL}');
return $('Read Settings (Digest)').all().map((i) => i.json)
  .filter((s) => ['Team Owner', 'Fallback Owner'].includes(s.Role) && (String(s.WhatsApp || '').trim() || String(s.Email || '').trim()))
  .map((s) => ({ json: { _to: String(s.WhatsApp || '').trim(), _email: String(s.Email || '').trim(), _subject: text.split('\\n')[0], _text: text, _html: html } }))
  .filter((m, i, all) => all.findIndex((x) => x._to === m._to && x._email === m._email) === i);`;

const nodes = [
  sticky('Note – what this is', '## FirstReply\nA new lead (form, Meta Lead Ad, WhatsApp, email) → instant reply to the lead → alert to the owner → logged in the Leads sheet.\nEvery morning: a digest of who still needs a human follow-up.\nRules live in one place: the Code nodes (source: respond.js). Customize `fromIntake()` for your actual intake source.', [-60, -320], 580, 220, 7),
  sticky('Note – sample payload', '### Sample payload\n`send-test.sh` posts a generic lead-shaped sample.\nTo go live: point your form/ad platform’s webhook here (or use its native webhook/Zapier-style integration) with header `X-Intake-Secret`. Capture one real payload and adjust `fromIntake()` only — see docs/intake-mapping.md for five common sources.', [-60, 190], 460, 220, 3),
  sticky('Note – WhatsApp', '### WhatsApp replies\nReplying to a lead on WhatsApp before they’ve messaged you first requires a pre-approved message template (Meta’s rule, not this workflow’s). Email replies need no approval, so that’s the reliable default here; swap in an approved WhatsApp template (or Twilio for SMS) the same way CloseLoop swaps its WhatsApp node.', [1060, 260], 460, 220, 4),
  sticky('Note – after hours', '### After hours\nThe reply to the lead always goes out instantly, any time, any day — that’s the whole point. Only the owner alert gets flagged “needs personal follow-up,” so nothing sits unanswered just because it arrived at 2am.', [-60, 590], 460, 160, 5),

  node('Intake – new lead', 'webhook', 2.2, [0, 0], { httpMethod: 'POST', path: 'new-lead-intake', authentication: 'headerAuth', responseMode: 'onReceived', options: {} },
    { webhookId: 'b8d2f8d3-2e8f-5d66-af2b-2b3c4d5e6f7a', credentials: { httpHeaderAuth: { id: 'frIntakeSecret0001', name: 'Intake webhook secret' } } }),
  readRows('Read Settings', 'Settings', [220, 0]),
  readRows('Read existing lead', 'Leads', [440, 0], {
    parameters: { documentId: doc, sheetName: tab('Leads'), filtersUI: { values: [{ lookupColumn: 'Lead ID', lookupValue: "={{ $('Intake – new lead').first().json.body.id }}" }] }, options: {} },
  }),
  node('Build Response', 'code', 2, [660, 0], { jsCode: BUILD_RESPONSE }),
  node('Leads – add or update', 'googleSheets', 4.7, [880, 0], {
    operation: 'appendOrUpdate', documentId: doc, sheetName: tab('Leads'),
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: ['Lead ID'], schema: [] },
    options: { cellFormat: 'RAW', handlingExtraData: 'ignoreIt' },
  }, { credentials: sheetsCred }),

  node('Has contact to reply to?', 'if', 2.2, [1100, -140], {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        { id: 'd0ffee00-0000-4000-8000-000000000001', leftValue: "={{ $('Build Response').item.json._replyEmail }}", rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } },
        { id: 'd0ffee00-0000-4000-8000-000000000002', leftValue: "={{ $('Build Response').item.json._replyPhone }}", rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } },
      ],
      combinator: 'or',
    },
    options: {},
  }),
  gmail('Email – reply to lead', [1320, -220], "={{ $('Build Response').item.json._replyEmail }}", "={{ 'Re: ' + $('Build Response').item.json.Interest }}", "={{ $('Build Response').item.json._replyText }}", false),
  whatsapp('WhatsApp – reply to lead (needs approved template)', [1320, -60], "={{ $('Build Response').item.json._replyPhone }}", "={{ $('Build Response').item.json._replyText }}"),

  node('Has owner contact?', 'if', 2.2, [1100, 140], {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        { id: 'd0ffee00-0000-4000-8000-000000000003', leftValue: "={{ $('Build Response').item.json._ownerEmail }}", rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } },
        { id: 'd0ffee00-0000-4000-8000-000000000004', leftValue: "={{ $('Build Response').item.json._ownerTo }}", rightValue: '', operator: { type: 'string', operation: 'notEmpty', singleValue: true } },
      ],
      combinator: 'or',
    },
    options: {},
  }),
  gmail('Email – alert owner', [1320, 60], "={{ $('Build Response').item.json._ownerEmail }}", "={{ $('Build Response').item.json._subject }}", "={{ $('Build Response').item.json._html }}"),
  whatsapp('WhatsApp – alert owner', [1320, 220], "={{ $('Build Response').item.json._ownerTo }}", "={{ $('Build Response').item.json._ownerText }}"),

  node('Every morning', 'scheduleTrigger', 1.2, [0, 900], { rule: { interval: [{ field: 'cronExpression', expression: '0 8 * * *' }] } }),
  readRows('Read Leads', 'Leads', [220, 900]),
  readRows('Read Settings (Digest)', 'Settings', [440, 900]),
  node('Build digest', 'code', 2, [660, 900], { jsCode: BUILD_DIGEST }),
  gmail('Email – daily digest', [900, 1020], '={{ $json._email }}', '={{ $json._subject }}', '={{ $json._html }}'),
  whatsapp('WhatsApp – daily digest', [900, 780], '={{ $json._to }}', '={{ $json._text }}'),
];

const link = (to) => ({ main: [[{ node: to, type: 'main', index: 0 }]] });
const connections = {
  'Intake – new lead': link('Read Settings'),
  'Read Settings': link('Read existing lead'),
  'Read existing lead': link('Build Response'),
  'Build Response': link('Leads – add or update'),
  'Leads – add or update': { main: [[{ node: 'Has contact to reply to?', type: 'main', index: 0 }, { node: 'Has owner contact?', type: 'main', index: 0 }]] },
  'Has contact to reply to?': { main: [[{ node: 'WhatsApp – reply to lead (needs approved template)', type: 'main', index: 0 }, { node: 'Email – reply to lead', type: 'main', index: 0 }], []] },
  'Has owner contact?': { main: [[{ node: 'WhatsApp – alert owner', type: 'main', index: 0 }, { node: 'Email – alert owner', type: 'main', index: 0 }], []] },
  'Every morning': link('Read Leads'),
  'Read Leads': link('Read Settings (Digest)'),
  'Read Settings (Digest)': link('Build digest'),
  'Build digest': { main: [[{ node: 'WhatsApp – daily digest', type: 'main', index: 0 }, { node: 'Email – daily digest', type: 'main', index: 0 }]] },
};

const wf = { id: 'firstReplyLeads0001', name: 'FirstReply – instant lead response', active: false, nodes, connections, settings: { timezone: 'Asia/Kolkata', executionOrder: 'v1' }, pinData: {} };

// self-check: names wired correctly, logic inlined
const names = new Set(nodes.map((x) => x.name));
for (const [from, c] of Object.entries(connections)) {
  assert(names.has(from), from);
  for (const out of c.main) for (const e of out) assert(names.has(e.node), e.node);
}
for (const x of nodes.filter((x) => x.type.endsWith('.code'))) assert.match(x.parameters.jsCode, /function isAfterHours/);
for (const x of nodes.filter((x) => x.type.endsWith('.code'))) new Function('$', x.parameters.jsCode);

fs.writeFileSync(path.join(__dirname, 'workflow.json'), JSON.stringify(wf, null, 2));
console.log('build ok');
