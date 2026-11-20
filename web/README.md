# NOTHING Energy storefront (API-connected)

This is the user-provided Energy design with live FastAPI integrations. The store must be served through the Docker gateway at `http://localhost:8080`, not opened directly as `file://` or a standalone static server.

All images in `assets/` are the uploaded transparent WebP product images. The original hi-res PNGs are omitted from GitHub to limit repository size; no image is fetched from a third party.

Register/sign in, choose a city, add one of the five editions or the separately stocked mixed pack, checkout (unpaid demo), view orders, search with OpenSearch, subscribe to newsletters, and sign in as admin to view users/orders and change stock. Payments and actual email delivery are not connected.
