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

## Deployment requirements

Deploy the repository root with an empty base directory, no build command, and `storefront` as the publish directory, as defined in `netlify.toml`. This store does not need Node, React, Python, MongoDB, an AI provider, or API keys to build or run.

The previous photo-compositing application has been removed from the current source. It is recoverable from Git history. Its former frontend/backend directories must not be used as deployment roots. Existing host-level base directory or build overrides must be cleared if they still select the old app.
