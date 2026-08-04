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
  search-grants.js        calls Anthropic with your real key
  create-checkout-session.js   starts a Stripe purchase
  verify-checkout-session.js   confirms a purchase before granting credits
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

## Known limitations of this version (fine for validating demand, worth
fixing before you scale)

- **Free-tier count, purchased credits, and saved grants all live in
  `localStorage`.** They're scoped to one browser on one device — clearing
  site data or switching devices resets the free count and loses saved
  items. The real fix later is moving all three to a small database keyed
  by account (email or similar) instead of trusting the client.
- **No accounts.** Nothing is tied to a person — just a browser.
- **Rate limiting is not implemented.** Nothing currently stops someone
  from hammering `/api/search-grants` directly (bypassing the UI) and
  running up your Anthropic bill. Worth adding IP-based throttling before
  wide release.

## Turning this into an installable "app" (no App Store needed)

Once deployed, visiting the Netlify URL on a phone shows an "Add to Home
Screen" (iOS Safari) or an install prompt (Android Chrome). It behaves
like a native app icon and launches full-screen, with no Apple/Google
review process involved.
