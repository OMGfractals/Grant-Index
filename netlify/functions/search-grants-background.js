// Background function — Netlify runs this asynchronously and does not wait
// for it to finish before responding to the caller (that response is empty
// and ignored). Results are written to Netlify Blobs under the given jobId;
// the client retrieves them by polling check-search-result.js.
//
// This exists because a single Claude call with web search enabled can
// legitimately take longer than a standard serverless function's timeout
// (10-30 seconds depending on plan) — background functions get up to 15
// minutes, which comfortably covers it.

const crypto = require('crypto');
const { connectLambda, getStore } = require('@netlify/blobs');

const ALLOWED_CATEGORIES = [
  'Business', 'Education', 'Home', 'Arts & Culture',
  'Health & Wellness', 'Community', 'Research & Science'
];

const MAX_SEARCHES_PER_DAY = parseInt(process.env.MAX_SEARCHES_PER_DAY || '200', 10);
const MAX_SEARCHES_PER_IP_PER_DAY = parseInt(process.env.MAX_SEARCHES_PER_IP_PER_DAY || '25', 10);
const FREE_SEARCHES_PER_MONTH = parseInt(process.env.FREE_SEARCHES_PER_MONTH || '3', 10);
const SEARCH_CACHE_HOURS = parseFloat(process.env.SEARCH_CACHE_HOURS || '12');
const SEARCH_CACHE_MS = SEARCH_CACHE_HOURS * 60 * 60 * 1000;

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

// Approximate limiter — read-then-write isn't atomic, so under heavy
// concurrent load it can slightly over- or under-count. That's fine here:
// the goal is bounding worst-case cost, not billing-grade precision.
async function checkAndIncrement(store, key, max) {
  const current = (await store.get(key, { type: 'json' })) || 0;
  if (current >= max) return false;
  await store.setJSON(key, current + 1);
  return true;
}

// Same search inputs should hit the same cache entry regardless of case,
// whitespace, or the order filters/categories were supplied in.
function buildCacheKey(topic, degree, residency, age, industry, categories) {
  const norm = (s) => (s || '').trim().toLowerCase();
  const sortedCats = [...categories].map(norm).sort().join(',');
  const raw = [norm(topic), norm(degree), norm(residency), norm(age), norm(industry), sortedCats].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

exports.handler = async (event) => {
  connectLambda(event);
  const store = getStore({ name: 'search-jobs' });

  let jobId, topic, degree, residency, age, industry, categories;
  try {
    ({ jobId, topic, degree, residency, age, industry, categories } = JSON.parse(event.body || '{}'));
  } catch {
    return; // malformed request — nothing to write a result for
  }
  if (!jobId) return;

  const writeError = (message) => store.setJSON(jobId, { status: 'error', error: message });

  topic = (topic || '').trim();
  degree = (degree || '').trim();
  residency = (residency || '').trim();
  age = (age || '').trim();
  industry = (industry || '').trim();
  categories = Array.isArray(categories)
    ? categories.filter((c) => ALLOWED_CATEGORIES.includes(c)).slice(0, ALLOWED_CATEGORIES.length)
    : [];

  if (!topic) return writeError('Missing topic');
  if (topic.length > 200 || degree.length > 100 || residency.length > 100 || age.length > 30 || industry.length > 100) {
    return writeError('One of the search fields is too long');
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return writeError('Server is not configured (missing ANTHROPIC_API_KEY)');

  const clientIp = event.headers?.['x-nf-client-connection-ip'] || event.headers?.['client-ip'] || 'unknown';

  // ---- Entitlement (the actual paywall). Checked before the cache lookup
  // and consumed either way — a cache hit still counts as "a search" from
  // the user's side, it's just free for us to serve. ----
  const entitlementStore = getStore({ name: 'entitlements' });
  const entitlementKey = `entitlement:${clientIp}`;
  let entitlement = (await entitlementStore.get(entitlementKey, { type: 'json' }))
    || { freeUsedThisMonth: 0, freeMonth: currentMonthKey(), credits: 0 };
  if (entitlement.freeMonth !== currentMonthKey()) {
    entitlement = { freeUsedThisMonth: 0, freeMonth: currentMonthKey(), credits: entitlement.credits || 0 };
  }

  if (entitlement.freeUsedThisMonth < FREE_SEARCHES_PER_MONTH) {
    entitlement.freeUsedThisMonth += 1;
  } else if (entitlement.credits > 0) {
    entitlement.credits -= 1;
  } else {
    return store.setJSON(jobId, { status: 'paywall' });
  }
  await entitlementStore.setJSON(entitlementKey, entitlement);

  // ---- Result cache — check before spending anything on a real search.
  // Skips both the abuse rate limit below and the Anthropic call entirely
  // on a hit, since a cached response costs nothing. ----
  const cacheStore = getStore({ name: 'search-cache' });
  const cacheKey = buildCacheKey(topic, degree, residency, age, industry, categories);

  const cached = await cacheStore.get(cacheKey, { type: 'json' });
  if (cached && (Date.now() - cached.cachedAt) < SEARCH_CACHE_MS) {
    await store.setJSON(jobId, { status: 'done', results: cached.results });
    return;
  }

  // ---- Abuse-prevention rate limits — only reached on a cache miss, since
  // only a cache miss is about to cost real API money. ----
  const rateLimitStore = getStore({ name: 'rate-limits' });
  const day = todayKey();

  const withinGlobalLimit = await checkAndIncrement(rateLimitStore, `global:${day}`, MAX_SEARCHES_PER_DAY);
  if (!withinGlobalLimit) {
    return writeError('This app has hit its search limit for today. Please try again tomorrow.');
  }

  const withinIpLimit = await checkAndIncrement(rateLimitStore, `ip:${clientIp}:${day}`, MAX_SEARCHES_PER_IP_PER_DAY);
  if (!withinIpLimit) {
    return writeError("You've reached today's search limit. Please try again tomorrow.");
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
        max_tokens: 3500,
        system:
          "You are a grants and scholarships research assistant. Use web search to find CURRENT, REAL, non-repayable funding opportunities — grants, scholarships, fellowships, and awards only. Never include loans, loan forgiveness programs, or repayable financing of any kind. Prioritize opportunities with open or upcoming application windows over ones long expired. When applicant filters (degree level, residency, age, business type/industry) are provided, treat them as hard eligibility constraints — exclude anything the applicant plausibly does not qualify for given those constraints, and reflect the specific matching constraint in that entry's eligibility field. For broad topics, run a couple of searches covering different angles (for example, by demographic or by funding type) instead of relying on a single generic query, and make sure the final list reflects that variety rather than returning several near-duplicate general-purpose listings. Respond with ONLY a raw JSON array (no markdown code fences, no preamble, no commentary) of up to 8 objects. Each object must have exactly these keys: name (string), organization (string), category (one of exactly: 'Business', 'Education', 'Home', 'Arts & Culture', 'Health & Wellness', 'Community', 'Research & Science', 'General' — Education covers formal degree programs as well as continuing education, personal development, and skills training such as certifications and teacher trainings; General is only for entries that genuinely don't fit any other category), amount (short string, e.g. '$2,500' or 'Varies'), deadline (short string, e.g. 'March 15, 2027' or 'Rolling'), eligibility (one sentence), description (one to two sentences on what it funds and why it matches the topic), url (a real, verifiable URL to the official listing — omit the entire entry rather than inventing a URL you are not confident is real). If fewer than 8 genuine matches exist, return fewer rather than padding the list.",
        messages: [{ role: 'user', content: `Find grants, scholarships, and fellowships related to: ${topic}${filterText}${categoryText}` }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.error?.message || `Anthropic API error (${response.status})`;
      return writeError(message);
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
      return writeError('Could not parse search results — try a more specific subject.');
    }

    if (!Array.isArray(results)) {
      return writeError('Unexpected response shape from search.');
    }

    await store.setJSON(jobId, { status: 'done', results });
    await cacheStore.setJSON(cacheKey, { results, cachedAt: Date.now() });
  } catch (err) {
    await writeError('Search request failed: ' + err.message);
  }
};
