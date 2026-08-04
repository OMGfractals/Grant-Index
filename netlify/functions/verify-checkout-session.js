const Stripe = require('stripe');

const CREDITS_PER_PURCHASE = parseInt(process.env.GRANT_CREDITS_PER_PURCHASE || '20', 10);

exports.handler = async (event) => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured (missing STRIPE_SECRET_KEY)' }) };
  }

  const sessionId = event.queryStringParameters && event.queryStringParameters.session_id;
  if (!sessionId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing session_id' }) };
  }

  const stripe = Stripe(secretKey, { apiVersion: '2026-07-29.dahlia' });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = session.payment_status === 'paid';
    return {
      statusCode: 200,
      body: JSON.stringify({ valid: paid, credits: paid ? CREDITS_PER_PURCHASE : 0 })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not verify session: ' + err.message }) };
  }
};
