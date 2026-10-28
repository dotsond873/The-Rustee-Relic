# Rustee Relic store manager

Private, mobile-friendly catalog manager with email/password sign-in, product editing, image uploads, sold-out marking, and deletion. No checkout or order management is included.

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
