# NOTHING Marketplace on Vercel — frontend and external API

Vercel can deploy the static `nothing-coffee/` storefront. The Java Spring
Boot app, PostgreSQL, Kafka, RabbitMQ and OpenSearch **must be hosted
separately** on a persistent runtime. Do not mistake a public static home
page for a working checkout.

## Import GitHub on Vercel

1. Open <https://vercel.com/new> and import
   [PunithNS-pixel/nothing](https://github.com/PunithNS-pixel/nothing).
2. Configure the Vercel project with **Production Branch: `main`**,
   **Root Directory: `nothing-coffee`**, and **Framework: Other**.
   Do not use repo root or `backend`. The static entrypoint is
   `nothing-coffee/index.html`; no Node or Next.js build is required.
3. Set **MARKETPLACE_BACKEND_ORIGIN** to your *existing, reachable public
   HTTPS backend origin*, for example `https://api.example.org`. Do
   not include `/api`, a trailing path, credentials or query string.
   Do not set it to `http://localhost:8090` or your Vercel frontend
   domain. This variable is a routing configuration, not a secret.
4. Deploy. The configuration in `nothing-coffee/vercel.mjs`
   proxies `/api/*` and `/images/*` to that backend origin.
   The frontend uses same-origin URLs and its JavaScript need not change.
   The production Vercel build intentionally fails without a real
   backend origin rather than publishing a misleading broken checkout.

If you have no backend URL yet, deploy the full backend separately first.
[The Google Compute Engine demo guide](DEPLOY_GOOGLE_CLOUD.md) shows one
VM-based option. It has costs and is only suitable for supervised testing.

## Updating backend redirects

After receiving a `https://your-project.vercel.app` site URL, set the
backend's private `FRONTEND_URL`, `STRIPE_SUCCESS_URL` and
`STRIPE_CANCEL_URL` to the actual Vercel HTTPS hostname (keeping the
correct query strings for Stripe). Do not put a Stripe secret or Gmail
refresh token into your Vercel project. Those remain in the backend's
private `.env` / secrets manager.

If using `backend/compose.gce.yml`, its frontend and Stripe redirect
settings now read the values from its private Compose `.env`.
`SITE_DOMAIN` remains the VM's own hostname for its HTTPS certificate.
Recreate the app container after changing those variables. Do not delete
Docker volumes: existing PostgreSQL orders depend on them.

## Verification

Run the following tests **on the Vercel domain**, not localhost:

```bash
curl -fsS "https://YOUR-PROJECT.vercel.app/"
curl -fsS "https://YOUR-PROJECT.vercel.app/api/store/offers"
curl -fsS "https://YOUR-PROJECT.vercel.app/api/store/catalog"
```

The catalog/offers endpoints must return **JSON from the Spring Boot app**,
not an HTML fallback or Vercel 404. Next, verify login, cart, discounts,
COD test checkout and an emailed order confirmation using a verified
Gmail API sender. If API calls fail, check the backend's HTTPS reachability,
the Vercel routing variable and the backend logs.

For CLI-based deployment from macOS:

```bash
git fetch --prune origin
git switch main
git pull --ff-only origin main
npm install -g vercel
cd nothing-coffee
vercel login
vercel link
vercel --prod
```

Link the project, set `MARKETPLACE_BACKEND_ORIGIN` for production in
Vercel Settings → Environment Variables, and redeploy. The full stack
does **not** run in Vercel's static hosting environment.

**Security:** This is a hackathon demo, not production commerce. The
existing Spring Security configuration disables CSRF while using
authentication cookies; payment settlement and refund safeguards are not
fully production-hardened. Do not enable live Stripe keys or process real
personal information until that is fixed.
