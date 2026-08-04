// Runs server-side only. ANTHROPIC_API_KEY lives in Netlify's environment
// variables and is never sent to the browser.

const ALLOWED_CATEGORIES = [
  'Business', 'Education', 'Home', 'Arts & Culture',
  'Health & Wellness', 'Community', 'Research & Science'
];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let topic, degree, residency, age, industry, categories;
  try {
    ({ topic, degree, residency, age, industry, categories } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  topic = (topic || '').trim();
  degree = (degree || '').trim();
  residency = (residency || '').trim();
  age = (age || '').trim();
  industry = (industry || '').trim();
  categories = Array.isArray(categories)
    ? categories.filter((c) => ALLOWED_CATEGORIES.includes(c)).slice(0, ALLOWED_CATEGORIES.length)
    : [];

  if (!topic) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing topic' }) };
  }
  if (topic.length > 200 || degree.length > 100 || residency.length > 100 || age.length > 30 || industry.length > 100) {
    return { statusCode: 400, body: JSON.stringify({ error: 'One of the search fields is too long' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured (missing ANTHROPIC_API_KEY)' }) };
  }

  const filterLines = [];
  if (degree) filterLines.push(`Degree level: ${degree}`);
  if (residency) filterLines.push(`Residency / location: ${residency}`);
  if (age) filterLines.push(`Applicant age: ${age}`);
  if (industry) filterLines.push(`Business type / industry: ${industry}`);
  const filterText = filterLines.length
    ? `\n\nApplicant filters (treat as hard eligibility constraints — only return opportunities the applicant plausibly qualifies for given these):\n${filterLines.join('\n')}`
    : '';

  const categoryText = categories.length
    ? `\n\nOnly include opportunities that fit these categories: ${categories.join(', ')}. Exclude anything outside these categories, even if it otherwise seems like a strong match.`
    : '';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system:
          "You are a grants and scholarships research assistant. Use web search to find CURRENT, REAL, non-repayable funding opportunities — grants, scholarships, fellowships, and awards only. Never include loans, loan forgiveness programs, or repayable financing of any kind. Prioritize opportunities with open or upcoming application windows over ones long expired. When applicant filters (degree level, residency, age, business type/industry) are provided, treat them as hard eligibility constraints — exclude anything the applicant plausibly does not qualify for given those constraints, and reflect the specific matching constraint in that entry's eligibility field. For broad topics, run at most 2 searches covering different angles (for example, by demographic or by funding type) instead of relying on a single generic query, and make sure the final list reflects that variety rather than returning several near-duplicate general-purpose listings. Work efficiently — this response must complete quickly, so do not run more than 2 searches total under any circumstances. Respond with ONLY a raw JSON array (no markdown code fences, no preamble, no commentary) of up to 8 objects. Each object must have exactly these keys: name (string), organization (string), category (one of exactly: 'Business', 'Education', 'Home', 'Arts & Culture', 'Health & Wellness', 'Community', 'Research & Science', 'General' — Education covers formal degree programs as well as continuing education, personal development, and skills training such as certifications and teacher trainings; General is only for entries that genuinely don't fit any other category), amount (short string, e.g. '$2,500' or 'Varies'), deadline (short string, e.g. 'March 15, 2027' or 'Rolling'), eligibility (one sentence), description (one to two sentences on what it funds and why it matches the topic), url (a real, verifiable URL to the official listing — omit the entire entry rather than inventing a URL you are not confident is real). If fewer than 8 genuine matches exist, return fewer rather than padding the list.",
        messages: [{ role: 'user', content: `Find grants, scholarships, and fellowships related to: ${topic}${filterText}${categoryText}` }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.error?.message || `Anthropic API error (${response.status})`;
      return { statusCode: 502, body: JSON.stringify({ error: message }) };
    }

    const textBlocks = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    const clean = textBlocks.replace(/```json|```/g, '').trim();

    let results;
    try {
      results = JSON.parse(clean);
    } catch {
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not parse search results — try a more specific subject.' }) };
    }

    if (!Array.isArray(results)) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Unexpected response shape from search.' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ results }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Search request failed: ' + err.message }) };
  }
};
