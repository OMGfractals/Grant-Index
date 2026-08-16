const { connectLambda, getStore } = require('@netlify/blobs');

const MAX_GRANTS_PER_EMAIL = 100;
const MAX_SENDS_PER_IP_PER_DAY = parseInt(process.env.MAX_EMAIL_SENDS_PER_IP_PER_DAY || '10', 10);
const FROM_ADDRESS = process.env.GRANT_EMAIL_FROM || 'The Grant Index <onboarding@resend.dev>';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function csvEscape(value) {
  const s = String(value ?? '');
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(grants) {
  const headers = ['Name', 'Organization', 'Amount', 'Deadline', 'Category', 'Eligibility', 'Description', 'Source URL'];
  const rows = grants.map((g) => [
    g.name || '',
    g.organization || '',
    g.amount || '',
    g.deadline || '',
    g.category || '',
    g.eligibility || '',
    g.description || '',
    g.url || ''
  ].map(csvEscape).join(','));
  return [headers.join(','), ...rows].join('\r\n');
}

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { email, grants, replyTo } = payload;

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter a valid email address.' }) };
  }
  if (!Array.isArray(grants) || grants.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Select at least one saved grant to send.' }) };
  }
  if (grants.length > MAX_GRANTS_PER_EMAIL) {
    return { statusCode: 400, body: JSON.stringify({ error: `You can send up to ${MAX_GRANTS_PER_EMAIL} grants at once.` }) };
  }
  // replyTo is optional and only meaningful if it passed real verification
  // client-side (a completed magic-link login) — this function trusts
  // whatever string it's given here, so the frontend must never pass an
  // unverified email through this field.
  const validReplyTo = replyTo && typeof replyTo === 'string' && EMAIL_RE.test(replyTo.trim()) ? replyTo.trim() : null;

  // Basic per-IP daily cap so this endpoint can't be used to spam arbitrary
  // inboxes. Not a full abuse system, just a reasonable ceiling.
  const clientIp = event.headers?.['x-nf-client-connection-ip'] || event.headers?.['client-ip'] || 'unknown';
  const rateKey = `email-sends:${clientIp}:${todayKey()}`;
  try {
    const store = getStore({ name: 'rate-limits' });
    const record = (await store.get(rateKey, { type: 'json' })) || { count: 0 };
    if (record.count >= MAX_SENDS_PER_IP_PER_DAY) {
      return { statusCode: 429, body: JSON.stringify({ error: 'Too many emails sent from this connection today. Try again tomorrow.' }) };
    }
    await store.setJSON(rateKey, { count: record.count + 1 });
  } catch {
    // Rate limiting is a courtesy, not the core feature — don't block a send over a Blobs hiccup.
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Email sending isn\'t configured yet.' }) };
  }

  const csv = buildCsv(grants);
  const csvBase64 = Buffer.from(csv, 'utf-8').toString('base64');
  const count = grants.length;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [email.trim()],
        ...(validReplyTo ? { reply_to: validReplyTo } : {}),
        subject: `Your saved grants from The Grant Index (${count})`,
        text: `Attached: ${count} saved grant${count === 1 ? '' : 's'} exported from The Grant Index as a CSV file. Open it in Excel, Google Sheets, or Numbers.`,
        attachments: [
          {
            filename: 'saved-grants.csv',
            content: csvBase64
          }
        ]
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { statusCode: 502, body: JSON.stringify({ error: 'The email could not be sent. Please try again.', detail: errText.slice(0, 300) }) };
    }

    return { statusCode: 200, body: JSON.stringify({ status: 'sent', count }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'The email could not be sent: ' + err.message }) };
  }
};
