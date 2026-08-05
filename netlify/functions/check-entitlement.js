const { connectLambda, getStore } = require('@netlify/blobs');

const FREE_SEARCHES_PER_MONTH = parseInt(process.env.FREE_SEARCHES_PER_MONTH || '3', 10);

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

// Try a strong-consistency read first (so this shows the true latest state,
// not a moment-old cached one); fall back rather than error if this
// platform context doesn't support it.
async function getConsistentRecord(storeName, key) {
  try {
    const strongStore = getStore({ name: storeName, consistency: 'strong' });
    return await strongStore.get(key, { type: 'json' });
  } catch {
    const fallbackStore = getStore({ name: storeName });
    return await fallbackStore.get(key, { type: 'json' });
  }
}

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const clientIp = event.headers?.['x-nf-client-connection-ip'] || event.headers?.['client-ip'] || 'unknown';
  const key = `entitlement:${clientIp}`;

  try {
    let record = (await getConsistentRecord('entitlements', key)) || { freeUsedThisMonth: 0, freeMonth: currentMonthKey(), credits: 0 };
    if (record.freeMonth !== currentMonthKey()) {
      record = { freeUsedThisMonth: 0, freeMonth: currentMonthKey(), credits: record.credits || 0 };
    }
    const freeRemaining = Math.max(0, FREE_SEARCHES_PER_MONTH - record.freeUsedThisMonth);

    return {
      statusCode: 200,
      body: JSON.stringify({
        freeRemaining,
        credits: record.credits || 0,
        totalRemaining: freeRemaining + (record.credits || 0)
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not check entitlement: ' + err.message }) };
  }
};
