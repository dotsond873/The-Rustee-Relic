# The Rustee Relic

Vintage finds, antiques, collectibles and used fishing gear.

## Storefront

The rebuilt store is in `storefront/`. It is plain HTML, CSS and JavaScript, with no build step or backend required. Netlify is configured to publish only that directory. If the existing Netlify site has a saved base directory or build command, clear those overrides and use `storefront` as its publish directory.

Features: 243 imported Etsy listings; search; category filters; price/name sorting; pagination; full descriptions; multi-photo galleries; shareable product links; browser-local saved favorites. Checkout is intentionally not enabled. Saved finds do not reserve inventory.

Serve `storefront/` using any static HTTP server. Opening `index.html` directly as a local file may block loading the JSON catalog.

## Catalog maintenance

Run from the repository root:

```sh
python scripts/import-etsy.py /path/to/EtsyListingsDownload.csv
```

`storefront/products.json` retains original Etsy fields in each product's `source` object. Categories are inferred from titles and can be reviewed/edited in JSON. Prices and quantities are copied from the export, not synchronized with Etsy. The 13 exported variation fields currently describe item attributes (primarily condition); they are displayed as details without fabricating variant-specific prices or stock. Photo URLs currently reference Etsy's image CDN and depend on those URLs remaining available.

The imported catalog has no checkout, shipping-rate, tax, or live-inventory integration. Confirm inventory and fulfillment before enabling orders. The grandfather clock description states that local pickup is preferred and freight requires discussion; that wording is preserved.

## Earlier application

The existing `frontend/` and `backend/` directories contain the previous photo-compositing application. They are retained for recovery but are not used by the rebuilt Netlify storefront. Do not deploy that backend to serve this catalog.
