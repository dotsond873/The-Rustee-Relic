# Rustee Relic store manager

Private, mobile-friendly catalog manager with email/password sign-in, product editing, image uploads, sold-out marking, and deletion. It also runs the storefront's Stripe checkout (see **Online checkout** below). Orders, receipts and refunds are managed in the Stripe Dashboard.

The public Render static site stays as it is. Run this directory as a separate Render **Web Service**. Its root URL is the admin login; `/admin` also works. GitHub stores catalog updates and photos durably, and the existing static site publishes commits to `main`. No catalog or image data relies on the service's temporary filesystem.

## Render setup

1. Merge this change into `main`.
2. Create a Web Service from `dotsond873/The-Rustee-Relic`.
3. Set Root Directory to `admin-service`, runtime to Node, Build Command to `npm install`, and Start Command to `npm start`.
4. Select Free if desired. Free services sleep after inactivity; opening the admin can take about a minute. The public store remains on static hosting.
5. Set **Auto-Deploy to Off** on this admin service. Otherwise, each saved product/photo could restart the admin and sign you out. Leave auto-deploy enabled on the public storefront.
6. Add these **private environment variables in Render**, never in GitHub files or chat:

| Variable | Value |
| --- | --- |
| `ADMIN_EMAIL` | Your chosen sign-in email |
| `ADMIN_PASSWORD` | A unique password, at least 16 characters |
| `GITHUB_TOKEN` | Fine-grained GitHub token, restricted to this repository, with Contents read/write permission |

7. Deploy and open the new service URL to sign in. No custom domain or DNS changes are needed.

The service fails closed until all variables are set. Login is one configured owner account; there is no public registration, email delivery, reset-email flow, or second-factor authentication. To reset the password, change `ADMIN_PASSWORD` and restart/redeploy the service. Sessions expire after eight hours or any service restart. Login attempts are limited to 20 per 15 minutes across the service.

Use a token belonging to an account allowed to write to `main`. If branch protection requires pull requests, direct publishing will fail; use a compatible publishing workflow before deployment. Rotate the token before its expiry; revoke it if the service is retired. GitHub/API and Render usage limits still apply. Uploaded photos become public repository files; do not upload private documents. Deleted products remain recoverable in Git history; images are retained to avoid breaking other listings.

## Editing

Existing imported metadata is preserved. Categories come from the existing storefront category list. The owner can add or edit titles, descriptions, prices, stock, SKU, category, pickup note, and photo URLs; upload JPEG/PNG/WebP images up to 5 MB each; mark sold; or delete a listing with confirmation. Saved finds on customers' devices do not reserve inventory. Catalog changes are not synchronized with Etsy.

The editor loads the latest GitHub catalog and uses GitHub's file SHA to prevent overwriting concurrent changes. A conflict leaves edits visible: copy them, close the editor, reload products, then apply them again. Photo uploads commit immediately and may not preview until the static deployment completes. After saving, allow a few minutes for Render to publish. Deployment failures must be resolved in the public site's Render deploy logs.

## Local validation

`npm test` runs auth, CSRF, conflict, validation, preservation, upload rejection and logout checks using a mocked GitHub API. Local HTTP does not support the production Secure cookie, so use HTTPS for interactive login testing. Run `node --check server.mjs` and `node --check public/admin.js` for syntax checks.

## Online checkout

The storefront is static, so this service creates Stripe Checkout sessions for it. Shoppers build a cart on the site, choose shipping or pickup, and pay on Stripe's hosted page. Card details never touch this service or the site.

How it behaves:

- **Prices and stock** are read from `storefront/products.json` on GitHub when checkout starts. Nothing sent by the browser sets a price.
- **Shipping** is a $12.50 flat rate per order to U.S. addresses (`SHIPPING_CENTS` in `checkout.mjs`). **Local pickup** in Decatur is free.
- **Pickup-only items** are the ones with "Local pickup only (cannot be shipped)" ticked in the editor. An order containing one can only be picked up.
- **Sales tax** is calculated by Stripe Tax. Stripe Tax must be switched on in the Stripe Dashboard (with your tax registration added) or session creation fails. Set `STRIPE_AUTOMATIC_TAX=false` to check out without tax.
- **Holds**: starting checkout holds the items for about 31 minutes so two shoppers cannot buy the same piece. Holds live in memory and are lost if the service restarts.
- **After payment** Stripe calls the webhook, which reduces the quantity in the catalog and commits it, so the item shows as sold once the site republishes. Stripe retries are recorded once.

### Setup

1. Add these **private environment variables in Render** on this service, never in GitHub files or chat:

| Variable | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe secret key. Use the `sk_test_...` key first; switch to `sk_live_...` to take real payments |
| `STRIPE_WEBHOOK_SECRET` | Signing secret (`whsec_...`) of the webhook endpoint created in step 2 |
| `STRIPE_AUTOMATIC_TAX` | Optional. `false` turns Stripe Tax off |
| `STORE_URL` | Optional. Defaults to `https://therusteerelic.com` |
| `STORE_ORIGINS` | Optional. Comma-separated sites allowed to start checkout. Defaults to the store with and without `www` |

2. In the Stripe Dashboard, add a webhook endpoint at `https://<this-service>.onrender.com/stripe/webhook` for the events `checkout.session.completed`, `checkout.session.async_payment_succeeded` and `checkout.session.expired`. Test mode and live mode have separate endpoints and separate signing secrets.
3. Deploy this service manually (auto-deploy stays off).
4. Put this service's address in `storefront/config.json` as `"checkoutApi": "https://<this-service>.onrender.com"` and merge to `main`. While that value is empty, or `STRIPE_SECRET_KEY` is missing, the store hides the cart and shows the "coming soon" wording.

With a test key the cart shows "Test mode: no real payments are taken." Pay with card `4242 4242 4242 4242`, any future expiry and any CVC.

### Limits to know

- On Render's free tier the service sleeps. The store wakes it when a visitor arrives, but the cart can take up to a minute to appear and holds are cleared by each sleep. A paid instance avoids both.
- For pickup orders Stripe calculates tax from the buyer's billing address, not the Decatur pickup location. Check with your tax adviser whether that suits you.
- If two people do pay for the same one-of-a-kind item (possible after a restart), the service log names the order; refund the second buyer in Stripe.
- Refunds and cancellations do not restock items. Set the quantity back in the editor.
- `GET /checkout/status`, `POST /checkout/session` and `POST /stripe/webhook` are public by design. Everything under `/api/` still requires the owner sign-in.
