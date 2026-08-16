const Stripe = require('stripe');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;

  if (!secretKey || !priceId) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured (missing Stripe env vars)' }) };
  }

  let rawEmail;
  try {
    ({ email: rawEmail } = JSON.parse(event.body || '{}'));
  } catch {
    rawEmail = null;
  }
  const email = typeof rawEmail === 'string' && EMAIL_RE.test(rawEmail.trim()) ? rawEmail.trim().toLowerCase() : null;

  const stripe = Stripe(secretKey, { apiVersion: '2026-07-29.dahlia' });
  const origin = event.headers.origin || `https://${event.headers.host}`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?purchase=cancelled`,
      // Carries the logged-in user's email through Stripe's hosted checkout
      // so verify-checkout-session.js can credit their email-based
      // entitlement instead of whatever IP they happen to check out from.
      ...(email ? { metadata: { email } } : {})
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not start checkout: ' + err.message }) };
  }
};
