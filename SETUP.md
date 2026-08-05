# The Grant Index — setup

A PWA that searches grants/scholarships live via Claude, with a free monthly
tier and a one-time Stripe purchase to unlock more searches. No native app
store involved, no terminal required anywhere in this guide — everything
below is done by clicking through websites.

## What's in here

```
public/                 the site itself (what Netlify serves)
  index.html
  manifest.json          PWA manifest
  sw.js                   service worker (installability + offline shell)
  icons/                  app icons
netlify/functions/       server-side code (your API keys live here, never in the browser)
  search-grants-background.js   runs the actual (slow) search, writes result to Netlify Blobs
  check-search-result.js        fast lookup the app polls until the search is done
  check-entitlement.js          reports the caller's real free-search/credit balance
  create-checkout-session.js    starts a Stripe purchase
  verify-checkout-session.js    confirms a purchase before granting credits
netlify.toml             routes /api/* to the functions above
package.json             lists the "stripe" dependency the functions need
```

## 1. Push the code to GitHub (no terminal)

1. Unzip the project on your computer.
2. Open the unzipped folder so you can see what's inside (`public`,
   `netlify`, `package.json`, etc.).
3. Go to **github.com/new**, create a new **empty** repo — leave "add a
   README" unchecked.
4. On the empty repo's page, click the link for uploading an existing file.
5. Drag everything **inside** the unzipped folder onto that page — the
   files themselves, not the outer `grant-index-app` folder. If you drag
   the folder itself, everything ends up nested one level too deep and
   Netlify won't find `netlify.toml` where it expects it.
6. Type a commit message like "Grant Index v1" and click "Commit changes."

## 2. Deploy to Netlify and get your app's web address

Do this before touching Stripe — Stripe's signup asks for a website URL,
and this is the fastest way to have a real one.

1. **app.netlify.com** → Add new site → Import an existing project →
   GitHub → select the repo you just pushed.
2. Netlify should auto-detect the build settings from `netlify.toml`
   (publish directory `public`, functions directory `netlify/functions`) —
   confirm and deploy. The site will go live even though the functions
   won't fully work yet (no keys configured), which is fine for now.
3. Netlify gives you a free address immediately, something like
   `random-words-193847.netlify.app`.
4. Worth doing now: Site settings → Domain management → Options → Edit
   site name → change it to something like `grant-index`, so the address
   reads `grant-index.netlify.app`. Free, instant, and better than a
   random string for something you're about to hand to a payment
   processor and eventually to real users.

## 3. Create the Stripe product and get your keys

1. Sign in at **dashboard.stripe.com**, or create an account. If asked for
   a website, use the Netlify address from step 2.
2. Make sure you're in **test mode** — there's a toggle near the top of
   the dashboard. Stay in test mode for everything below until step 6.
3. Go to **Product catalog** in the left sidebar → **+ Add product**.
   Name it something like "20 Grant Index Searches," set a one-time price
   (e.g. $4.99), save it.
4. Click into that product to open its detail page. Under the **Pricing**
   section you'll see the price you just created, with an ID next to it
   starting with `price_...` — click the copy icon next to it. That's
   your **Price ID**. (There's also a **Product ID** starting with
   `prod_...` nearby — don't grab that one, it won't work here.)
5. Go to **Developers → API keys** (left sidebar). Copy the **Secret
   key** — starts with `sk_test_` while you're in test mode.

You should now have two values copied: a `price_...` ID and an
`sk_test_...` key.

## 4. Add your keys to Netlify

1. On your site in Netlify: Site settings → Environment variables → Add
   a variable.
2. Add these four, one at a time:

   | Key | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your Anthropic key |
   | `STRIPE_SECRET_KEY` | the `sk_test_...` key from step 3 |
   | `STRIPE_PRICE_ID` | the `price_...` ID from step 3 |
   | `GRANT_CREDITS_PER_PURCHASE` | `20` (optional — this is the default anyway) |

3. Netlify may show the scope option grayed out on "same value for all
   deploy contexts" — that's normal if you don't have any other deploy
   contexts (branches, previews) active. Whatever single field is
   editable is the one that matters; just fill that in.
4. **Trigger a redeploy** after adding these — Deploys tab → Trigger
   deploy. Variables added after a deploy don't apply to it retroactively;
   they only take effect on the next build.

## 5. Update the displayed price (to match what you set in Stripe)

There's one line in the code that shows the price on the "buy more
searches" button — it's just text, not connected to the real Stripe
price, so if you didn't use $4.99 for 20 searches, update it to match.
To edit it without installing anything locally:

1. On your repo's GitHub page, open `public/index.html`.
2. Click the pencil (edit) icon, top right of the file view.
3. Use your browser's find-on-page (Ctrl+F / Cmd+F) to search for
   `PACK_PRICE_LABEL` — it's near the top of the `<script>` section:
   ```js
   const PACK_PRICE_LABEL = '$4.99 for 20 more searches';
   ```
4. Edit the text between the quotes to match your actual Stripe price.
5. Scroll down, commit the change directly on the `main` branch. Netlify
   will automatically redeploy since it's connected to this repo.

## 6. Test the whole loop before touching real money

- Run a couple of free searches, confirm results render.
- Try the category chips and advanced filters, confirm they change what
  comes back.
- Burn through the 3 free searches, confirm the paywall shows up.
- Click "Buy," complete checkout with Stripe's test card
  (`4242 4242 4242 4242`, any future expiry date, any CVC), confirm you
  land back on the site with credits added.
- On your phone, open the deployed URL and check that "Add to Home
  Screen" (iOS Safari) or the install prompt (Android Chrome) shows up
  and actually works.

## 7. Go live

Once everything above works: in Stripe, switch out of test mode, repeat
step 3 for live mode (new product/price, new secret key — Stripe keeps
test and live completely separate), and update `STRIPE_SECRET_KEY` and
`STRIPE_PRICE_ID` in Netlify (step 4) to the live values. Trigger another
redeploy. That's the only change needed — nothing else in the code knows
or cares about the difference.

## 8. Optional: a real domain instead of `*.netlify.app`

Site settings → Domain management → Add a custom domain.

---

## What's in v1

- Live search with optional advanced filters (degree level, residency, age,
  business type/industry) that the backend treats as hard eligibility
  constraints, not just hints.
- Category filter chips (Business, Education & Personal Development, Home,
  Arts & Culture, Health & Wellness, Community, Research & Science) —
  multi-select, restricts the search to only those categories. Leaving
  everything unchecked searches all categories.
- For broad topics, the model runs multiple differently-angled searches
  (by demographic, by funding type) before compiling the list, instead of
  one generic query.
- Save/bookmark results into a separate "Saved" tab.
- One-click "+ Cal" button per result — downloads an `.ics` file for that
  deadline (skipped automatically for results with no fixed date, like
  "Rolling").
- Client-side sort of the current results by deadline or amount, no extra
  API call.
- Result cap is 8 per search, by design — see the chat history for the
  cost/relevance reasoning if you revisit this later.
- Search runs as a Netlify **background function** rather than a normal
  one, and the app polls for the result every ~1.5 seconds until it's
  ready. This exists because a single Claude call with web search can
  legitimately take longer than Netlify's standard function timeout
  (10-30 seconds depending on plan) — background functions get up to 15
  minutes instead. A search can now take up to about a minute; the
  loading text says so on purpose.

## Known limitations of this version (fine for validating demand, worth
fixing before you scale)

- **Free searches and paid credits are now enforced server-side**, tracked
  by IP address in Netlify Blobs (`check-entitlement.js`,
  `search-grants-background.js`, `verify-checkout-session.js`) — not by
  `localStorage`. Clearing site data or using a private window no longer
  resets anyone's count; the number shown in the app is a live read from
  the server, not a client-side guess.
  Configurable via `FREE_SEARCHES_PER_MONTH` (default 3).
  The real tradeoff: this is IP-based, not account-based, so everyone on
  the same network (a household, an office, a coffee shop) shares one pool
  of free searches and one pool of purchased credits. That's a genuine
  fairness quirk — someone's purchased credits could look "gone" from a
  different wifi network, or a roommate could use up a shared free search.
  Fixing that properly means real accounts (email/login), which is a
  bigger project than this. **Saved grants still live in `localStorage`**
  only, unrelated to this — that one's just a nice-to-have that didn't need
  the same fix, since there's no cost or fairness question attached to it.
- **No accounts.** Entitlement is now tied to an IP, not a person — see
  above. Real accounts would fix both the IP-sharing quirk and the
  saved-grants-per-device limitation in one project, whenever it's worth
  the investment.
- **Basic rate limiting is in place** — a global daily search cap
  (`MAX_SEARCHES_PER_DAY`, default 200) and a per-IP daily cap
  (`MAX_SEARCHES_PER_IP_PER_DAY`, default 25), both optional environment
  variables you can tune in Netlify if the defaults feel wrong. This is
  separate from entitlement — it's a blunt cost backstop that applies even
  to legitimately-entitled traffic (e.g. a sudden spike of many different
  real users all using their free search the same day), not a fairness
  mechanism. It's an approximate limiter (not perfectly precise under heavy
  concurrent traffic) — good enough to bound worst-case cost, not a
  billing-grade guarantee. Also set a hard monthly spending limit directly
  in the Anthropic Console (platform.claude.com → Limits) — that's a
  backstop that holds even if there's a bug in this code, which nothing
  in the app itself can promise.
- **Purchased credits can be manually recovered on a new network/device.**
  After a purchase, the buyer sees a "purchase code" (their Stripe session
  ID) with instructions to save it. If entitlement ever looks wrong from a
  different IP, they paste that code into the "Restore" field on the
  paywall to move their credits over. One-time use per code, so it's a
  safety valve, not a sync mechanism — doesn't touch the underlying
  IP-sharing tradeoff, just gives a buyer a way out of it if it bites them.
- **Identical searches are now cached** for `SEARCH_CACHE_HOURS` (default
  12) — same topic, filters, and categories (case/whitespace-insensitive,
  order-insensitive on categories) serves the stored result instead of
  paying for a new Anthropic call. Costs the user a search from their
  entitlement either way; only the cost to you is skipped on a hit. Also
  means a cache hit resolves almost instantly instead of taking up to a
  minute, since there's no real search to wait on.
- **Search job results and cached search results in Netlify Blobs aren't
  automatically cleaned up.** Each search leaves a small JSON record behind
  under its job ID, and each unique search leaves a cache entry. Harmless
  at low volume, but worth adding a cleanup step if this gets real traffic.

## Turning this into an installable "app" (no App Store needed)

Once deployed, visiting the Netlify URL on a phone shows an "Add to Home
Screen" (iOS Safari) or an install prompt (Android Chrome). It behaves
like a native app icon and launches full-screen, with no Apple/Google
review process involved.
