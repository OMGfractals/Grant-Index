const { connectLambda, getStore } = require('@netlify/blobs');
const Stripe = require('stripe');

const CREDITS_PER_PURCHASE = parseInt(process.env.GRANT_CREDITS_PER_PURCHASE || '20', 10);

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

exports.handler = async (event) => {
  connectLambda(event);

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

    if (!paid) {
      return { statusCode: 200, body: JSON.stringify({ valid: false, credits: 0 }) };
    }

    const entitlementStore = getStore({ name: 'entitlements' });

    // Idempotency guard — a page refresh or a retried request must not
    // credit the same Stripe session twice. Credits are granted to the
    // purchaser's IP immediately, matching how entitlement is tracked
    // everywhere else — plus a one-time-use purchase record below, so the
    // buyer has a way to recover access if their IP changes later.
    const processedKey = `processed-session:${sessionId}`;
    const alreadyProcessed = await entitlementStore.get(processedKey, { type: 'json' });

    if (!alreadyProcessed) {
      const clientIp = event.headers?.['x-nf-client-connection-ip'] || event.headers?.['client-ip'] || 'unknown';
      const entitlementKey = `entitlement:${clientIp}`;
      let entitlement = (await entitlementStore.get(entitlementKey, { type: 'json' }))
        || { freeUsedThisMonth: 0, freeMonth: currentMonthKey(), credits: 0 };
      if (entitlement.freeMonth !== currentMonthKey()) {
        entitlement = { freeUsedThisMonth: 0, freeMonth: currentMonthKey(), credits: entitlement.credits || 0 };
      }
      entitlement.credits = (entitlement.credits || 0) + CREDITS_PER_PURCHASE;
      await entitlementStore.setJSON(entitlementKey, entitlement);
      await entitlementStore.setJSON(processedKey, true);

      // Recovery record — sessionId itself is the "purchase code." Long,
      // unique, and only the actual buyer has it (it's in their browser's
      // URL right after paying), so no email or login needed to prove
      // ownership. One-time use: redeemable exactly once, so it can't be
      // replayed on multiple devices to duplicate credits.
      await entitlementStore.setJSON(`purchase:${sessionId}`, { credits: CREDITS_PER_PURCHASE, restored: false });
    }

    return { statusCode: 200, body: JSON.stringify({ valid: true, credits: CREDITS_PER_PURCHASE, purchaseCode: sessionId }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not verify session: ' + err.message }) };
  }
};
