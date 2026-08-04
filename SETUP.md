# The Grant Index — setup

A PWA that searches grants/scholarships live via Claude, with a free monthly
tier and a one-time Stripe purchase to unlock more searches. No native app
store involved — installable straight from the browser.

## What's in here

```
public/                 the site itself (what Netlify serves)
  index.html
  manifest.json          PWA manifest
  sw.js                   service worker (installability + offline shell)
  icons/                  app icons
netlify/functions/       server-side code (your API keys live here, never in the browser)
  search-grants.js        calls Anthropic with your real key
  create-checkout-session.js   starts a Stripe purchase
  verify-checkout-session.js   confirms a purchase before granting credits
netlify.toml             routes /api/* to the functions above
package.json             lists the "stripe" dependency the functions need
```

## 1. Create the Stripe product

1. Sign in at dashboard.stripe.com (or create an account).
2. Products → Add product. Name it something like "20 Grant Index Searches."
   One-time price, e.g. $4.99. Save it.
3. Copy the **Price ID** (starts with `price_`) — you'll need it below.
4. Developers → API keys → copy your **Secret key** (starts with `sk_live_`
   once you're out of test mode, `sk_test_` while testing).

Test in Stripe's test mode first (test secret key + Stripe's test card
4242 4242 4242 4242) before flipping to live keys.

## 2. Push this to GitHub

Netlify deploys functions cleanly from a connected Git repo — much less
friction than manual zip uploads, and it gives you redeploys on every push.

```
cd grant-index-app
git init
git add .
git commit -m "Grant Index v1"
```

Create a new repo on GitHub, then:

```
git remote add origin <your repo URL>
git push -u origin main
```

## 3. Connect it to Netlify

1. Netlify → Add new site → Import an existing project → pick the repo.
2. Build settings: publish directory `public`, functions directory
   `netlify/functions` (netlify.toml already sets these — Netlify should
   pick them up automatically).
3. Site settings → Environment variables — add:
   - `ANTHROPIC_API_KEY` — your Anthropic key
   - `STRIPE_SECRET_KEY` — the Stripe secret key from step 1
   - `STRIPE_PRICE_ID` — the Stripe price ID from step 1
   - `GRANT_CREDITS_PER_PURCHASE` — optional, defaults to 20
4. Deploy.

## 4. Update the displayed price

`public/index.html` has one line near the top of the `<script>` block:

```js
const PACK_PRICE_LABEL = '$4.99 for 20 more searches';
```

This is just the text shown on the button — the real charge is whatever you
set on the Stripe price. Keep these two in sync by hand.

## 5. Test end to end

- Run a few free searches (limit is 3/month, set by `FREE_LIMIT` in
  `index.html`) to confirm results render.
- Let it hit the paywall, click through checkout with Stripe's test card,
  confirm you land back on the site with credits added.
- Switch Stripe to live mode and swap in the live secret key when you're
  ready to charge real cards.

## What's in v1

- Live search with optional advanced filters (degree level, residency, age,
  business type/industry) that the backend treats as hard eligibility
  constraints, not just hints.
- Category filter chips (Business, Education & Personal Development, Home,
  Arts & Culture, Health & Wellness, Community, Research & Science) —
  multi-select, restricts the search to only those categories. Leaving
  everything unchecked searches all categories, same as before this existed.
- For broad topics, the model now runs multiple differently-angled searches
  (by demographic, by funding type) before compiling the list, instead of
  one generic query — aimed at the "8 results for 'small business' all look
  the same" problem, not just showing more of the same results.
- Save/bookmark results into a separate "Saved" tab.
- One-click "+ Cal" button per result — downloads an `.ics` file for that
  deadline (skipped automatically for results with no fixed date, like
  "Rolling").
- Client-side sort of the current results by deadline or amount, no extra
  API call.

## Known limitations of this version (fine for validating demand, worth
fixing before you scale)

- **Free-tier count, purchased credits, and saved grants all live in
  `localStorage`.** They're scoped to one browser on one device — clearing
  site data or switching devices resets the free count and loses saved
  items. For a low-priced utility this is an acceptable v1 tradeoff; the
  real fix is moving all three to a small database keyed by account (email
  or similar) instead of trusting the client.
- **No accounts.** Nothing is tied to a person — just a browser. Search
  history and credits don't follow someone across devices.
- **Rate limiting is not implemented.** Nothing currently stops someone
  from hammering `/api/search-grants` directly (bypassing the UI) and
  running up your Anthropic bill. Worth adding IP-based throttling in the
  function before wide release.

## Turning this into an installable "app" (no App Store needed)

Once deployed, visiting the Netlify URL on a phone shows an "Add to Home
Screen" (iOS Safari) or an install prompt (Android Chrome) — that's the PWA
manifest and service worker doing their job. It behaves like a native app
icon and launches full-screen, with no Apple/Google review process
involved.
