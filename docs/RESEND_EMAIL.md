# Resend transactional email — NOTHING Marketplace

**Resend sends email; it does not host your storefront or the Java backend.**
Vercel can host the static storefront, but Spring Boot/PostgreSQL/Kafka/
RabbitMQ/OpenSearch still require persistent hosting. This integration sends
**account verification OTPs** and **order confirmation receipts** from the
existing backend using the **Resend HTTPS Email API**.

## Setup in your Resend account

1. Create/sign in to your Resend account at <https://resend.com/>.
2. Add a domain under <https://resend.com/domains>. Verify the domain by
   adding the DNS records that Resend displays (including DKIM/SPF as
   directed). Use a domain you control. The quickstart sender
   `onboarding@resend.dev` has testing restrictions; do not use it for
   ordinary marketplace buyers.
3. Generate an API key at <https://resend.com/api-keys> with **Sending
   access**. Do not paste the key into ChatGPT, GitHub, terminal screenshots,
   browser devtools or public logs. Use the backend's ignored private
   `backend/.env`, not Vercel client-side variables.
4. Choose an address on your verified domain, e.g. `orders@yourdomain.com`,
   as `EMAIL_FROM`.

Add or update the following **locally**, in `backend/.env`:

```dotenv
MAIL_PROVIDER=resend
RESEND_API_KEY=YOUR_PRIVATE_RESEND_API_KEY
EMAIL_FROM=orders@your-verified-domain.com
MAIL_NOTIFICATIONS_ENABLED=true
MAIL_HEALTH_ENABLED=false
```

If `backend/.env` does not exist yet, initialize it with:

```bash
test -f backend/.env || cp backend/.env.example backend/.env
```

Keep existing database/JWT/RabbitMQ/Stripe settings intact. No Google OAuth
or SMTP configuration is necessary when `MAIL_PROVIDER=resend`.

## Start the existing backend

From repository root on macOS, with `main` checked out:

```bash
git fetch --prune origin
git switch main
git pull --ff-only origin main
docker compose -f backend/compose.yml --env-file backend/.env config --quiet
docker compose -f backend/compose.yml --env-file backend/.env up -d --build
```

If you already run the three-replica Docker profile, use
`backend/compose.ha.yml` with `--scale app=3`. Do not start both profiles,
switch your database connection, or run `docker compose down -v`; they have
different PostgreSQL volume identities.

The Aiven and Google Compute Engine Compose profiles also forward
`RESEND_API_KEY` from their respective private backend env files. The
GCE private env preparer validates Resend configuration and disables
unconfigured notification sending rather than falsely indicating that
transactional emails will work.

## What is integrated

- **Signup email OTP:** On `POST /api/auth/signup` the backend sends the
  six-digit verification message to the requested mailbox using Resend.
  Registration remains pending until the recipient verifies it. The
  resend-code endpoint also uses the same provider.
- **Order email:** COD orders and Stripe orders confirmed by the existing
  signed webhook are queued in PostgreSQL, then dispatched by RabbitMQ and
  the durable fallback scheduler. The existing server-generated HTML and
  plaintext confirmation includes items, quantities, INR totals, discounts,
  order ID and delivery address.
- **Retries and idempotency:** Each order confirmation sets a stable
  `Idempotency-Key: nothing-order-confirmation-<orderId>` in its request.
  Resend retains idempotency keys for **24 hours**; this helps prevent
  duplicate sends after a temporary network outage or process crash.
  Long-delayed retries beyond that window may still duplicate a message,
  so delivery is not mathematically exactly-once.
- **Credential and privacy controls:** All Resend requests happen on the
  Spring backend, not in browser JavaScript. Unrecognized sender addresses
  are refused, API errors do not include response bodies or keys in logs,
  and missing key/sender configuration prevents the sender from starting.

The backend marks email `SENT` when Resend **accepts the API request**, not
when a customer actually receives it. Check Resend's email dashboard to
verify final delivery, bounce and rejection events.

## Test real end-to-end sending

1. Open your existing marketplace, sign up with a mailbox you own, and check
   for an OTP from your verified sender. Complete the email verification.
2. Sign in, put one product in your cart, and place a **Cash on Delivery test
   order**.
3. Confirm the receipt arrives and matches the actual order. Check
   **Orders → Confirmation Email Status** and the Resend dashboard.
4. For failure diagnostics (no secrets), use:

```bash
docker compose -f backend/compose.yml --env-file backend/.env logs --tail=100 app
```

If messages remain `PENDING`, check domain verification, sender address,
API-key permission and Resend account quotas. Do **not** paste credentials
or full `docker compose config` output into chat; environment output can
contain secrets.

## Hosting remains separate

For Vercel, use [the existing storefront deployment guide](DEPLOY_VERCEL.md)
with project root `nothing-coffee` and a public HTTPS Spring Boot API
origin. Adding Resend alone **will not create a Vercel deployment or a
public store URL**.

Documentation: [Resend REST email API](https://resend.com/docs/api-reference/emails/send-email),
[verify a domain](https://resend.com/docs/dashboard/domains/introduction),
[idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).
