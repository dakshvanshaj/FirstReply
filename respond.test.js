// Run: node respond.test.js
const assert = require('node:assert/strict');
const { fromIntake, hasContact, isAfterHours, ownerFor, buildReplyText, buildResponse, dailyDigest, alertHtml, digestHtml } = require('./respond.js');

// business hours: Mon-Fri 9:00-17:59 IST; outside that (incl. weekends) is "after hours"
const A = (iso) => isAfterHours(new Date(iso));
assert.equal(A('2026-10-28T10:00:00+05:30'), false); // Wed, in hours
assert.equal(A('2026-10-28T09:00:00+05:30'), false); // exactly opens
assert.equal(A('2026-10-28T07:00:00+05:30'), true);  // before hours
assert.equal(A('2026-10-28T18:00:00+05:30'), true);  // exactly closes
assert.equal(A('2026-10-31T12:00:00+05:30'), true);  // Saturday
assert.equal(A('2026-11-01T12:00:00+05:30'), true);  // Sunday

// fromIntake normalisation
const base = { id: 'L1', name: 'Priya S', phone: '+919800000001', email: 'priya@example.com', source: 'Typeform', team: 'Sales', interest: 'pricing for the Pro plan' };
const L = fromIntake(base);
assert.equal(L.leadId, 'L1'); assert.equal(L.name, 'Priya S'); assert.equal(L.source, 'Typeform');
assert.equal(fromIntake({ first_name: 'A', last_name: 'B' }).name, 'A B');
assert.equal(fromIntake({ ...base, source: '' }).source, 'form');
assert.equal(hasContact(L), true);
assert.equal(hasContact(fromIntake({ ...base, phone: '', email: '' })), false);

const S = [
  { Role: 'Team Owner', Team: 'Sales', Name: 'Asha', WhatsApp: '+919800000010' },
  { Role: 'Fallback Owner', Team: '', Name: 'Head', WhatsApp: '+919800000099' },
];
const now = new Date('2026-10-28T10:00:00+05:30'); // Wed, in business hours

// ok case
const ok = buildResponse(L, now, S, null);
assert.equal(ok.row.Flags, '');
assert.equal(ok.row.Owner, 'Asha');
assert.equal(ok.to, '+919800000010');
assert.equal(ok.replyText, 'Hi Priya S, thanks for reaching out about "pricing for the Pro plan" — we got your message and someone from our team will follow up with you shortly.');
assert.equal(ok.ownerText, 'New lead from Typeform: Priya S asking about "pricing for the Pro plan". Replied instantly.');
assert.equal(ok.subject, 'New lead: Priya S — pricing for the Pro plan');
assert.deepEqual(Object.keys(ok.row), ['Received at', 'Lead ID', 'Name', 'Phone', 'Email', 'Source', 'Interest', 'Owner', 'Status', 'Flags']);

// missing fields, but still has contact so still replies (with the generic fallback wording)
const missingFields = buildResponse(fromIntake({ ...base, name: '', interest: '' }), now, S, null);
assert.equal(missingFields.row.Flags, 'Missing: name, what they’re asking about');
assert.equal(missingFields.replyText, 'Hi there, thanks for reaching out about "your inquiry" — we got your message and someone from our team will follow up with you shortly.');
assert.match(missingFields.subject, /^⚠ New lead: \? — no interest given/);

// no contact method: can't reply, says so instead of silently failing
const noContact = buildResponse(fromIntake({ ...base, phone: '', email: '' }), now, S, null);
assert.equal(noContact.replyText, '');
assert.match(noContact.row.Flags, /No phone or email to reply to/);
assert.match(noContact.ownerText, /Could not reply — no phone or email/);

// after-hours: still replies instantly, just flags for a human follow-up later
const afterHours = buildResponse(L, new Date('2026-10-28T20:00:00+05:30'), S, null);
assert.match(afterHours.row.Flags, /Arrived after hours/);
assert.notEqual(afterHours.replyText, ''); // the reply still goes out immediately

// fallback owner when team doesn't match any Team Owner row
assert.equal(buildResponse(fromIntake({ ...base, team: 'Support' }), now, S, null).to, '+919800000099');
const noOwner = buildResponse(L, now, [], null);
assert.equal(noOwner.to, null); assert.match(noOwner.row.Flags, /No owner set for team Sales/);

// update keeps Status and first-arrival time
const prev = { 'Received at': '2026-10-20 09:00', 'Lead ID': 'L1', Status: 'Contacted' };
const up = buildResponse(L, now, S, prev);
assert.equal(up.row.Status, 'Contacted');
assert.equal(up.row['Received at'], '2026-10-20 09:00');
assert.equal(up.updated, true);

// dailyDigest: 2 leads in the last 24h (one flagged), 1 older excluded
const rows = [
  { Name: 'A1', Source: 'Typeform', Interest: 'pricing', 'Received at': '2026-11-01 15:00', Status: 'New', Flags: 'Arrived after hours – needs personal follow-up' },
  { Name: 'B1', Source: 'Meta Ads', Interest: 'demo', 'Received at': '2026-11-01 20:00', Status: 'New', Flags: '' },
  { Name: 'C1', Source: 'WhatsApp', Interest: 'support', 'Received at': '2026-10-30 09:00', Status: 'New', Flags: '' },
];
const digestNow = new Date('2026-11-02T09:00:00+05:30');
const d = dailyDigest(rows, digestNow, 'https://sheet');
assert.match(d, /Replied to in the last 24h: 2/);
assert.match(d, /Still need a human follow-up: 1/);
assert.match(d, /A1 \(Typeform\)/); assert.doesNotMatch(d, /C1/);
assert.match(d, /https:\/\/sheet/);

// HTML, and XSS escaping
const h1 = alertHtml(ok, 'https://sheet');
assert.match(h1, /New lead/); assert.match(h1, /pricing for the Pro plan/); assert.match(h1, /href="https:\/\/sheet"/);
const h2 = alertHtml(missingFields, 'https://sheet');
assert.match(h2, /Missing: name/); assert.match(h2, /#fef3c7/);
assert.match(alertHtml(up, 'https://sheet'), /Updated/);
const evil = buildResponse(fromIntake({ ...base, name: '<script>x</script>' }), now, S, null);
assert.doesNotMatch(alertHtml(evil, 'https://sheet'), /<script>/); assert.match(alertHtml(evil, 'https://sheet'), /&lt;script&gt;/);

const dh = digestHtml(rows, digestNow, 'https://sheet');
assert.match(dh, /Leads digest/); assert.match(dh, /A1/); assert.doesNotMatch(dh, /C1/);
console.log('respond ok');
