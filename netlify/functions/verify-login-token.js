const { connectLambda, getStore } = require('@netlify/blobs');

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

// Normalize a stored entitlement record to "this month's" numbers — a
// record left over from a prior month should read as 0 used, same rule
// used everywhere else entitlement is touched.
function normalizeForThisMonth(record) {
  if (!record) return { freeUsedThisMonth: 0, credits: 0 };
  if (record.freeMonth !== currentMonthKey()) return { freeUsedThisMonth: 0, credits: record.credits || 0 };
  return { freeUsedThisMonth: record.freeUsedThisMonth || 0, credits: record.credits || 0 };
}

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const token = event.queryStringParameters?.token;
  if (!token) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing login token.' }) };
  }

  try {
    const tokenStore = getStore({ name: 'login-tokens' });
    const record = await tokenStore.get(token, { type: 'json' });

    if (!record) {
      return { statusCode: 400, body: JSON.stringify({ error: 'This login link is invalid or has already been used.' }) };
    }
    if (record.used) {
      return { statusCode: 400, body: JSON.stringify({ error: 'This login link has already been used. Request a new one.' }) };
    }
    if (Date.now() > record.expiresAt) {
      return { statusCode: 400, body: JSON.stringify({ error: 'This login link has expired. Request a new one.' }) };
    }

    // Mark used immediately so the same link can't be replayed.
    await tokenStore.setJSON(token, { ...record, used: true });

    const email = record.email.toLowerCase();

    // Merge whatever this IP has accrued (free searches used this month,
    // any purchased credits) into the persistent email-based record, then
    // clear the IP record. Clearing it is what makes this safe to run on
    // every login rather than just a "first ever" one — there's nothing
    // left on the IP to merge a second time, so logging in again from the
    // same network is a no-op, while logging in from a *new* network
    // correctly pulls in whatever that network has separately accrued.
    try {
      const entitlementStore = getStore({ name: 'entitlements' });
      const clientIp = event.headers?.['x-nf-client-connection-ip'] || event.headers?.['client-ip'] || 'unknown';
      const ipKey = `entitlement:${clientIp}`;
      const emailKey = `entitlement:email:${email}`;

      const ipRecord = normalizeForThisMonth(await entitlementStore.get(ipKey, { type: 'json' }));
      const emailRecord = normalizeForThisMonth(await entitlementStore.get(emailKey, { type: 'json' }));

      if (ipRecord.freeUsedThisMonth > 0 || ipRecord.credits > 0) {
        await entitlementStore.setJSON(emailKey, {
          freeUsedThisMonth: emailRecord.freeUsedThisMonth + ipRecord.freeUsedThisMonth,
          credits: emailRecord.credits + ipRecord.credits,
          freeMonth: currentMonthKey()
        });
        // Zero out, don't delete — deleting would make this IP look
        // "fresh" again immediately, handing back searches that were
        // already counted and just moved to the email record.
        await entitlementStore.setJSON(ipKey, { freeUsedThisMonth: 0, credits: 0, freeMonth: currentMonthKey() });
      }
    } catch {
      // Entitlement merge is a courtesy on top of a successful login —
      // don't fail the login itself over a Blobs hiccup here.
    }

    return { statusCode: 200, body: JSON.stringify({ status: 'ok', email }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not verify that login link: ' + err.message }) };
  }
};
