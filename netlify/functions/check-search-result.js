const { connectLambda, getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  connectLambda(event);

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const jobId = event.queryStringParameters && event.queryStringParameters.jobId;
  if (!jobId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing jobId' }) };
  }

  const store = getStore({ name: 'search-jobs', consistency: 'strong' });

  try {
    const result = await store.get(jobId, { type: 'json' });
    if (!result) {
      return { statusCode: 200, body: JSON.stringify({ status: 'pending' }) };
    }
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ status: 'error', error: 'Could not check result: ' + err.message }) };
  }
};
