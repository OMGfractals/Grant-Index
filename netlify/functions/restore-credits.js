const { connectLambda, getStore } = require('@netlify/blobs');

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let code;
  try {
    ({ code } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  code = (code || '').trim();
  if (!code) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Enter your purchase code.' }) };
  }

  const store = getStore({ name: 'entitlements' });
  const purchaseKey = `purchase:${code}`;

  try {
    const purchase = await store.get(purchaseKey, { type: 'json' });

    if (!purchase) {
      return { statusCode: 404, body: JSON.stringify({ error: "That code wasn't found. Double-check it and try again." }) };
    }
    if (purchase.restored) {
      return { statusCode: 409, body: JSON.stringify({ error: 'This code has already been used to restore credits once.' }) };
    }

    const clientIp = event.headers?.['x-nf-client-connection-ip'] || event.headers?.['client-ip'] || 'unknown';
    const entitlementKey = `entitlement:${clientIp}`;
    let entitlement = (await store.get(entitlementKey, { type: 'json' }))
      || { freeUsedThisMonth: 0, freeMonth: currentMonthKey(), credits: 0 };
    if (entitlement.freeMonth !== currentMonthKey()) {
      entitlement = { freeUsedThisMonth: 0, freeMonth: currentMonthKey(), credits: entitlement.credits || 0 };
    }
    entitlement.credits = (entitlement.credits || 0) + purchase.credits;
    await store.setJSON(entitlementKey, entitlement);
    await store.setJSON(purchaseKey, { ...purchase, restored: true });

    return { statusCode: 200, body: JSON.stringify({ restored: purchase.credits }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not restore: ' + err.message }) };
  }
};
