// Business rules for the instant lead-response automation.
// Pure functions; the same text is inlined into the n8n Code nodes by build.js.
// All times are IST wall-clock, held as "fake UTC" Dates (read with getUTC*), so host timezone never matters.

const IST_MS = 330 * 60000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ist = (d) => new Date(d.getTime() + IST_MS);
const pad = (n) => String(n).padStart(2, '0');
const fmt = (f) => `${f.getUTCFullYear()}-${pad(f.getUTCMonth() + 1)}-${pad(f.getUTCDate())} ${pad(f.getUTCHours())}:${pad(f.getUTCMinutes())}`;
const nice = (f) => `${DOW[f.getUTCDay()]} ${f.getUTCDate()} ${MON[f.getUTCMonth()]} ${pad(f.getUTCHours())}:${pad(f.getUTCMinutes())}`;

// Blank everywhere means '', 'NaN', 'N/A' or missing.
function clean(v) {
  const s = v == null ? '' : String(v).trim();
  return ['', 'nan', 'n/a'].includes(s.toLowerCase()) ? '' : s;
}

// The ONLY place that knows a specific intake source's field names. Capture one real payload
// (Typeform, Google Forms, Meta Lead Ads, a WhatsApp inbound message, or a generic contact-form
// webhook) and adjust here — see docs/intake-mapping.md for five common sources.
function fromIntake(body) {
  const b = body || {};
  return {
    leadId: clean(b.id || b.response_id || b.lead_id),
    name: clean(b.name || b.full_name || [clean(b.first_name), clean(b.last_name)].filter(Boolean).join(' ')),
    phone: clean(b.phone),
    email: clean(b.email),
    source: clean(b.source || b.platform) || 'form',
    team: clean(b.team),
    interest: clean(b.interest || b.message || b.query || b.inquiry),
  };
}

const hasContact = (lead) => !!(lead.phone || lead.email);
const REQUIRED = [['name', 'name'], ['interest', 'what they’re asking about']];

// Outside Mon-Fri 9:00-18:00 IST. The reply still goes out instantly either way — that's the whole
// point — this only flags that a human needs to personally follow up once the day starts.
function isAfterHours(receivedAt) {
  const t = ist(receivedAt);
  const dow = t.getUTCDay();
  if (dow === 0 || dow === 6) return true;
  const hour = t.getUTCHours();
  return hour < 9 || hour >= 18;
}

function ownerFor(team, settings) {
  const s = settings || [];
  const reachable = (r) => clean(r.WhatsApp) || clean(r.Email);
  const c = s.find((r) => r.Role === 'Team Owner' && String(r.Team).trim().toLowerCase() === String(team || '').trim().toLowerCase() && reachable(r))
    || s.find((r) => r.Role === 'Fallback Owner' && reachable(r));
  return c ? { Name: c.Name, WhatsApp: clean(c.WhatsApp), Email: clean(c.Email) } : null;
}

// The instant reply sent back to the LEAD — plain text, since it has to work identically whether
// it goes out over email, WhatsApp or SMS.
function buildReplyText(lead) {
  const name = lead.name || 'there';
  const interest = lead.interest || 'your inquiry';
  return `Hi ${name}, thanks for reaching out about "${interest}" — we got your message and someone from our team will follow up with you shortly.`;
}

// existing = the Leads sheet row already holding this lead, or null. An update keeps Status.
function buildResponse(lead, receivedAt, settings, existing) {
  const flags = [];
  const missing = REQUIRED.filter(([k]) => !lead[k]).map(([, label]) => label);
  if (missing.length) flags.push('Missing: ' + missing.join(', '));
  if (!hasContact(lead)) flags.push('No phone or email to reply to');
  if (isAfterHours(receivedAt)) flags.push('Arrived after hours – needs personal follow-up');
  const c = ownerFor(lead.team, settings);
  if (!c) flags.push(`No owner set for team ${lead.team || '?'}`);
  const row = {
    'Received at': (existing && existing['Received at']) || fmt(ist(receivedAt)), 'Lead ID': lead.leadId || `no-id-${receivedAt.getTime()}`,
    Name: lead.name, Phone: lead.phone, Email: lead.email, Source: lead.source, Interest: lead.interest,
    Owner: (c && c.Name) || '', Status: (existing && existing.Status) || 'New', Flags: flags.join('; '),
  };
  const replyText = hasContact(lead) ? buildReplyText(lead) : '';
  const ownerText = `New lead from ${lead.source || 'form'}: ${lead.name || '?'} asking about "${lead.interest || '?'}". ${replyText ? 'Replied instantly.' : 'Could not reply — no phone or email.'}`;
  const subject = `New lead: ${lead.name || '?'} — ${lead.interest || 'no interest given'}`;
  return {
    row, replyPhone: lead.phone || '', replyEmail: lead.email || '', replyText,
    to: (c && c.WhatsApp) || null, ownerEmail: c ? c.Email : '', ownerText,
    subject: row.Flags ? `⚠ ${subject}` : subject, updated: !!existing,
  };
}

// Morning digest: yesterday's leads that still need a human follow-up (flagged, or after-hours).
function dailyDigest(rows, now, sheetUrl) {
  const n = ist(now);
  const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  const since = today - 86400000;
  const recent = (rows || []).filter((r) => { const d = ist2(r['Received at']); return d && d.getTime() >= since; });
  const needsFollowUp = recent.filter((r) => r.Flags && r.Status === 'New');
  return [
    `Leads digest – ${nice(n)}`,
    `Replied to in the last 24h: ${recent.length}`,
    `Still need a human follow-up: ${needsFollowUp.length}`,
    ...(needsFollowUp.length ? needsFollowUp.slice(0, 5).map((r) => `- ${r.Name} (${r.Source}): ${r.Flags}`) : []),
    `Full list: ${sheetUrl}`,
  ].join('\n');
}

function ist2(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  return m ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0))) : null;
}

// ---- HTML email (inline styles only: email clients drop <style> blocks) ----
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const FONT = "font-family:Arial,Helvetica,sans-serif;color:#1f2937;";
function shell(title, colour, body, sheetUrl, footer) {
  return `<div style="${FONT}max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">`
    + `<div style="background:${colour};color:#fff;padding:14px 18px;font-size:18px;font-weight:bold">${title}</div>`
    + `<div style="padding:16px 18px">${body}`
    + `<p style="margin:18px 0 4px"><a href="${esc(sheetUrl)}" style="background:#0f766e;color:#fff;text-decoration:none;padding:9px 14px;border-radius:6px;font-size:14px;display:inline-block">Open Leads sheet</a></p>`
    + `</div><div style="padding:10px 18px;background:#f9fafb;color:#6b7280;font-size:12px">${footer}</div></div>`;
}
const tr = (k, v, strong) => `<tr><td style="padding:6px 10px 6px 0;color:#6b7280;font-size:14px;white-space:nowrap;vertical-align:top">${k}</td>`
  + `<td style="padding:6px 0;font-size:14px;${strong ? 'font-weight:bold;' : ''}">${v || '<span style="color:#b91c1c">not set</span>'}</td></tr>`;

function alertHtml(resp, sheetUrl) {
  const r = resp.row;
  const banner = r.Flags
    ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;color:#92400e;padding:10px 12px;margin-bottom:14px;font-size:14px">⚠ ${esc(r.Flags)}</div>` : '';
  const body = banner + `<table style="border-collapse:collapse;width:100%">`
    + tr('Name', esc(r.Name), true) + tr('Source', esc(r.Source)) + tr('Asking about', esc(r.Interest))
    + tr('Phone', esc(r.Phone)) + tr('Email', esc(r.Email)) + tr('Owner', esc(r.Owner)) + tr('Status', esc(r.Status))
    + `</table>`;
  const title = `${resp.updated ? 'Updated: ' : ''}New lead${r.Name ? ` – ${esc(r.Name)}` : ''}`;
  return shell(title, r.Flags ? '#b45309' : '#0f766e', body, sheetUrl, 'Sent the moment a new lead comes in — the lead already got an instant reply; this is for your team.');
}

function digestHtml(rows, now, sheetUrl) {
  const n = ist(now);
  const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  const since = today - 86400000;
  const recent = (rows || []).filter((r) => { const d = ist2(r['Received at']); return d && d.getTime() >= since; });
  const needsFollowUp = recent.filter((r) => r.Flags && r.Status === 'New');
  const tile = (label, num, colour) => `<td style="padding:4px;width:50%"><div style="border:1px solid #e5e7eb;border-radius:6px;padding:10px;text-align:center">`
    + `<div style="font-size:24px;font-weight:bold;color:${colour}">${num}</div><div style="font-size:12px;color:#6b7280">${label}</div></div></td>`;
  const body = `<table style="border-collapse:collapse;width:100%"><tr>`
    + tile('Replied in last 24h', recent.length, '#0f766e')
    + tile('Still need a human', needsFollowUp.length, needsFollowUp.length ? '#b45309' : '#0f766e')
    + `</tr></table>`
    + (needsFollowUp.length ? `<p style="margin:16px 0 6px;font-weight:bold;font-size:14px">Need a human follow-up</p><ul style="margin:0;padding-left:18px;font-size:14px">${needsFollowUp.map((r) => `<li style="margin:3px 0">${esc(r.Name)} (${esc(r.Source)}): ${esc(r.Flags)}</li>`).join('')}</ul>` : '');
  return shell(`Leads digest – ${nice(n)}`, '#0f766e', body, sheetUrl, 'Sent every morning — everything else already got an instant reply overnight.');
}

if (typeof module !== 'undefined') module.exports = { fromIntake, hasContact, isAfterHours, ownerFor, buildReplyText, buildResponse, dailyDigest, alertHtml, digestHtml };
