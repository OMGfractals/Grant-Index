const { connectLambda, getStore } = require('@netlify/blobs');
const crypto = require('crypto');

const TOKEN_TTL_MINUTES = 15;
const MAX_LINK_REQUESTS_PER_IP_PER_DAY = parseInt(process.env.MAX_LOGIN_REQUESTS_PER_IP_PER_DAY || '10', 10);
const FROM_ADDRESS = process.env.GRANT_EMAIL_FROM || 'The Grant Index <onboarding@resend.dev>';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
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

  const email = (payload.email || '').trim();
  if (!email || !EMAIL_RE.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Please enter a valid email address.' }) };
  }

  // Basic per-IP daily cap so this can't be used to spam a stranger's inbox
  // with repeated login link requests.
  const clientIp = event.headers?.['x-nf-client-connection-ip'] || event.headers?.['client-ip'] || 'unknown';
  const rateKey = `login-requests:${clientIp}:${todayKey()}`;
  try {
    const rateStore = getStore({ name: 'rate-limits' });
    const record = (await rateStore.get(rateKey, { type: 'json' })) || { count: 0 };
    if (record.count >= MAX_LINK_REQUESTS_PER_IP_PER_DAY) {
      return { statusCode: 429, body: JSON.stringify({ error: 'Too many login attempts from this connection today. Try again tomorrow.' }) };
    }
    await rateStore.setJSON(rateKey, { count: record.count + 1 });
  } catch {
    // Rate limiting is a courtesy — don't block a legitimate login over a Blobs hiccup.
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Login isn\'t configured yet.' }) };
  }

  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = Date.now() + TOKEN_TTL_MINUTES * 60 * 1000;

  try {
    const tokenStore = getStore({ name: 'login-tokens' });
    await tokenStore.setJSON(token, { email, expiresAt, used: false });
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not create a login link: ' + err.message }) };
  }

  const siteUrl = process.env.URL || `https://${event.headers?.host || ''}`;
  const loginLink = `${siteUrl}/?login_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [email],
        subject: 'Log in to The Grant Index',
        text: `Click this link to log in. It expires in ${TOKEN_TTL_MINUTES} minutes and can only be used once.\n\n${loginLink}\n\nIf you didn't request this, you can ignore this email.`
      })
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { statusCode: 502, body: JSON.stringify({ error: 'The login link could not be sent. Please try again.', detail: errText.slice(0, 300) }) };
    }

    return { statusCode: 200, body: JSON.stringify({ status: 'sent' }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'The login link could not be sent: ' + err.message }) };
  }
};
