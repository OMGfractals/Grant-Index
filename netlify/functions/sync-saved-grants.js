const { connectLambda, getStore } = require('@netlify/blobs');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_SAVED_GRANTS = 300;

function validEmail(raw) {
  return typeof raw === 'string' && EMAIL_RE.test(raw.trim()) ? raw.trim().toLowerCase() : null;
}

exports.handler = async (event) => {
  connectLambda(event);
  const store = getStore({ name: 'saved-grants' });

  if (event.httpMethod === 'GET') {
    const email = validEmail(event.queryStringParameters?.email);
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid email.' }) };
    }
    try {
      const record = await store.get(`saved:${email}`, { type: 'json' });
      return { statusCode: 200, body: JSON.stringify({ grants: record?.grants || [] }) };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not load saved grants: ' + err.message }) };
    }
  }

  if (event.httpMethod === 'POST') {
    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
    }

    const email = validEmail(payload.email);
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid email.' }) };
    }
    if (!Array.isArray(payload.grants)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'grants must be an array.' }) };
    }
    if (payload.grants.length > MAX_SAVED_GRANTS) {
      return { statusCode: 400, body: JSON.stringify({ error: `You can save up to ${MAX_SAVED_GRANTS} grants.` }) };
    }

    try {
      await store.setJSON(`saved:${email}`, { grants: payload.grants, updatedAt: Date.now() });
      return { statusCode: 200, body: JSON.stringify({ status: 'ok', count: payload.grants.length }) };
    } catch (err) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Could not save: ' + err.message }) };
    }
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
};
