# NOTHING Energy — Aiven Hackathon Store

**Status:** a Docker-ready, frontend-agnostic **e-commerce demonstration** with the provided NOTHING Energy animated storefront. It supports real (unpaid) orders and stock updates. **Not a fully production-validated retail deployment.** No payment provider, real email delivery, shipping or tax engine is included.

[Frontend source](web/) · [Architecture](ARCHITECTURE.md) · [API Swagger](http://localhost:8080/api/docs) · [Production checklist](PRODUCTION_CHECKLIST.md)

## What is implemented

| Part | Backend implementation and proof |
| --- | --- |
| Frontend | Uploaded NOTHING Energy five-can design; responsive animations, cart drawer, account/search/orders/admin dialogs; real product images |
| Authentication & RBAC | Argon2 password hashing; access JWT; refresh token rotation and logout; admin-only APIs |
| Retailers | Business GSTIN with structure+checksum check, unique pending application, admin-controlled approval/rejection/suspension and audit note; approved 15% (configurable) server-calculated checkout pricing, serialized with profile approval or suspension via row locking |
| PostgreSQL | Users, retailer profiles, refresh tokens, six SKUs, per-city inventory, carts, orders/items, audit log, newsletter subscribers and outbox; foreign keys, uniqueness and check constraints |
| Transaction safety | Atomic checkout; sorted `SELECT FOR UPDATE` stock and product row locks, per-customer cart lock, idempotency key; purchase-price snapshot and inventory deduction in one DB transaction |
| Kafka | Transactional outbox → Kafka `store.events` topic; consumer dispatches events and tracks processed IDs |
| OpenSearch | Fuzzy search (`watermelan`), filters by city, category and price; consumer updates index on product/inventory events |
| RabbitMQ | Durable notification queue; notification consumer logs demo confirmations (not email sending) |
| Prometheus | `/api/metrics` counts requests and duration; target scraped by Prometheus |
| Grafana | Provisioned monitoring dashboard, port 3001 |
| Terraform | Aiven PostgreSQL, Kafka, OpenSearch service resource definitions; requires your Aiven project and credentials |

## Quick start: fully local Docker services

**Install:** Docker Desktop with Compose v2 (at least ~8 GB allocated), Git, Python 3. On Linux, if OpenSearch fails, set `sudo sysctl -w vm.max_map_count=262144`.

```bash
# branch only; neither main nor backend is changed
git clone -b feat/nothing https://github.com/PunithNS-pixel/nothing.git
cd nothing
cp .env.example .env
openssl rand -hex 32
# Edit .env and replace JWT_SECRET with the printed 64-character value.
# Set ADMIN_PASSWORD to a private 12+ character strong password.
# Optionally change ADMIN_EMAIL and GRAFANA_ADMIN_PASSWORD.
docker compose up -d --build
docker compose ps
docker compose exec -T api python -m scripts.seed
```

The seed now rebuilds the OpenSearch index as well as producing Kafka events. A failed index rebuild is reported without corrupting PostgreSQL; retry manually as below. **Old deployments use a new `store-products-v2` OpenSearch index for substring matching.** Do not run `docker compose down -v` unless you intend to erase data.

- **Storefront:** <http://localhost:8080>
- **Swagger:** <http://localhost:8080/api/docs>
- **API readiness (PostgreSQL):** <http://localhost:8080/api/health/ready>
- **Prometheus:** <http://localhost:9090>
- **Grafana:** <http://localhost:3001> (username `admin`, password from `.env`)
- **RabbitMQ:** <http://localhost:15672> (local-only management, `guest`/`guest`)
- **OpenSearch (local):** <http://localhost:9200>

### Hackathon demonstration checklist

1. Register using **ACCOUNT** (password at least 12 characters), sign in.
2. Choose a city in the cart: **Bengaluru, Mumbai, Delhi**.
3. Add **Original**, **Sugar Free**, **Green Edition**, **Pink Edition**, **Red Edition** or **Five-Flavor Mix**. Prices and product IDs come from PostgreSQL, not the browser.
4. Checkout to create an **unpaid demo order** and atomically deduct stock. **No money is charged**.
5. Open ACCOUNT → MY ORDERS; orders remain after browser refresh or app restart.
6. SEARCH: try `free` (matches Sugar Free), `watermelan` (matches Red Edition), filter category `Energy Drinks`, city and price. Results are returned by **OpenSearch**, not PostgreSQL.
7. Admin: sign in using your `.env` admin email and password; select ACCOUNT → ADMIN DASHBOARD to view customers/recent orders, update stock, move orders through `placed → processing → shipped → delivered`. Admin routes enforce RBAC on the server.
8. **RETAILERS** next to ACCOUNT: sign into an ordinary account first, submit legal business name and checksum-valid 15-character GSTIN; account remains pending until admin reviews. Admin dashboard → RETAILER APPLICATIONS lets staff approve/reject/suspend with a recorded review note. After approval, checkout uses **server-side** `RETAILER_DISCOUNT_PERCENT` (default 15%); client-submitted prices are ignored. The account can view the status, and prices are restored to retail if suspended. **The GST portal is not queried by the app: an authorized admin must confirm actual taxpayer identity/status independently** before clicking APPROVE.
9. Inspect outbox → Kafka → search/notification flow with the commands below.

The separately stocked Five-Flavor Mix is a **prepacked SKU**, not five individual SKUs automatically deducted from component inventories.

## Self-verification commands (local Docker)

```bash
# 1. Health and running containers
docker compose ps
curl -fsS http://localhost:8080/api/health/ready

# 2. Products from PostgreSQL
curl -fsS 'http://localhost:8080/api/products?size=100' | python3 -m json.tool

# 3. Real OpenSearch typo tolerance, city/category/price filtering
curl -fsSG http://localhost:8080/api/search --data-urlencode 'q=watermelan' --data-urlencode 'city=Bengaluru' --data-urlencode 'category=Energy Drinks' --data-urlencode 'max_price=200' | python3 -m json.tool
curl -fsSG http://localhost:8080/api/search --data-urlencode 'q=free' --data-urlencode 'city=Bengaluru' | python3 -m json.tool
curl -fsS http://localhost:8080/api/health/search | python3 -m json.tool
curl -fsS http://localhost:9200/_cat/indices?v

# If search is unavailable / index missing or stale, rebuild from the authoritative database
# Do not delete the postgres data volume; inspect the consumer as well.
docker compose logs --tail=100 opensearch consumer api
docker compose exec -T api python -m scripts.reindex
curl -fsSG http://localhost:8080/api/search --data-urlencode 'q=free' | python3 -m json.tool

# 4. Database, stock, outbox, orders (write operations are via API only)
docker compose exec -T postgres psql -U store -d store -c 'SELECT sku,name,price,active FROM products ORDER BY sku;'
docker compose exec -T postgres psql -U store -d store -c 'SELECT event_type, COUNT(*) AS total, COUNT(published_at) AS published FROM outbox GROUP BY 1;'
docker compose exec -T postgres psql -U store -d store -c 'SELECT id,user_id,status,city,total FROM orders ORDER BY created_at DESC LIMIT 10;'
docker compose exec -T postgres psql -U store -d store -c 'SELECT sku,city,quantity FROM inventory JOIN products ON products.id=inventory.product_id ORDER BY sku,city;'

# 5. Kafka topic, worker logs, RabbitMQ notifications
docker compose exec -T kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:29092 --describe --topic store.events
docker compose logs --tail=100 outbox consumer notifications
docker compose exec -T rabbitmq rabbitmqctl list_queues name messages consumers

# 6. Metrics, Prometheus, Grafana
curl -fsS http://localhost:8080/api/metrics | grep store_http_requests_total
curl -fsSG http://localhost:9090/api/v1/query --data-urlencode 'query=up' | python3 -m json.tool
curl -fsS http://localhost:3001/api/health

# 7. Scripted registered-user checkout; then concurrent last-unit test
bash scripts/demo.sh
docker compose exec -T api python -m scripts.concurrency_check

# 8. Retailer table and approval events
docker compose exec -T postgres psql -U store -d store -c 'SELECT business_name, gstin, status, reviewed_at FROM retailer_profiles ORDER BY created_at DESC LIMIT 20;'
docker compose exec -T postgres psql -U store -d store -c "SELECT event_type, count(*) FROM outbox WHERE event_type = 'retailer.reviewed' GROUP BY event_type;"

# 9. Combined smoke checks
bash scripts/verify.sh
```

**OpenSearch diagnosis for "Search unavailable":** `docker compose ps opensearch consumer` → `docker compose logs opensearch consumer api` → `curl -fsS http://localhost:9200/_cluster/health` → `docker compose exec -T api python -m scripts.reindex` → `curl -fsSG http://localhost:8080/api/search --data-urlencode 'q=free'`. If the service itself is down, index rebuilding won't help: review memory/disk and `vm.max_map_count` first. OpenSearch is the query engine; the API does not substitute an SQL `LIKE` query.

**Interpreting results:** PostgreSQL must return committed orders and decreased stock, outbox rows get `published_at`, Kafka topic exists, OpenSearch returns Red Edition for `watermelan`, RabbitMQ queue and notifier logs show confirmation tasks, Grafana `/api/health` is accessible, and Prometheus scrapes an `up` metric. Search indexing is eventually consistent; a brief delay is expected.

If `bash scripts/demo.sh` fails, inspect `docker compose logs --tail=200 api migrate kafka opensearch outbox consumer`.

## Optional: use Aiven for the three required backend services

**Local Docker service containers are not Aiven.** If you must show Aiven cloud instances to judges, provision/obtain real Aiven PostgreSQL, Apache Kafka and OpenSearch services, then connect via TLS. Aiven publishes [free-tier details](https://aiven.io/free-tier) and [Terraform instructions](https://aiven.io/docs/tools/terraform). Plan/region support can vary per account; the Terraform example is a template, not a guarantee of a free service in every region.

**Terraform (requires Terraform CLI and Aiven credentials):**

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit project and supported cloud_name/plan for your Aiven account.
# Export AIVEN_TOKEN using your Aiven API token; never commit token or tfstate.
export AIVEN_TOKEN='<your-private-aiven-api-token>'
terraform init
terraform fmt -check
terraform validate
terraform plan
terraform apply
cd ../..
```

Then download Aiven CA certificate and Kafka client cert/key as permitted by your selected Aiven plan, save under `./secrets/`, and connect:

```bash
mkdir -p secrets && chmod 700 secrets
cp .env.aiven.example .env
# Edit DATABASE_URL (URL-encode credentials), KAFKA_BOOTSTRAP_SERVERS,
# KAFKA_SECURITY_PROTOCOL (SSL or SASL_SSL), OPENSEARCH_URL, username/password,
# JWT_SECRET, ADMIN_PASSWORD, and certificate paths as appropriate.
docker compose -f compose.aiven.yaml up -d --build
docker compose -f compose.aiven.yaml exec -T api python -m scripts.seed
```

Aiven Kafka may use TLS client certificate or SASL auth based on your service config. Use the appropriate settings from Aiven's service connection information. **Aiven mode has not been deployed or verified from this environment**. Some Aiven Free plans have resource and service restrictions, so check limits before provisioning.

To check that the required services are *actually* on Aiven, use `docker compose -f compose.aiven.yaml ps` (no local Postgres/Kafka/OpenSearch service containers) and inspect `DATABASE_URL`, Kafka bootstrap servers, and OpenSearch URL **without printing passwords**. Then perform the SQL, Kafka and search checks against their Aiven endpoints. The local `verify.sh` currently assumes the local containers for checking Kafka/PostgreSQL and is for **local mode** only.

## Automated CI verification

On each push to `feat/nothing`, GitHub Actions runs a **Full-stack Docker + Terraform verification** workflow. Its integration job builds the complete local Compose stack, seeds products, checks PostgreSQL/Kafka/OpenSearch/RabbitMQ/Grafana/Prometheus, performs a real unpaid checkout, and runs a two-customer last-unit stock race. The Terraform job runs `terraform init` and `terraform validate` without creating any Aiven services. To repeat it yourself, open GitHub **Actions → Full-stack Docker + Terraform verification → Run workflow**, then inspect each job's logs.

## Technical boundaries

- **Transactions:** Kafka/Opensearch/RabbitMQ processing is asynchronous (eventual consistency). PostgreSQL is source of truth; the outbox reduces lost-event risk. It is not one distributed ACID transaction.
- **Retailer verification:** offline GSTIN syntax and Luhn check cannot prove registration is active. Admin must manually check the official GST portal and record the review; automatic government-verified approval needs a separately authorized verification integration. Tax invoices are not implemented.
- **Admin:** dashboard and REST APIs are RBAC protected; admin data must not be exposed to customers. The dashboard shows recent 25 records; API uses pagination.
- **Security:** credentials never committed. Browser session tokens currently reside in `sessionStorage`, which is not ideal for production XSS resistance; production should use audited HttpOnly session-cookie/BFF auth and CSRF defenses, TLS, secret manager, alerting, hardened RabbitMQ/Kafka/OpenSearch configs.
- **Commercial launch:** no payment capture, refunds, taxes, shipment tracking, customer email verification or actual email delivery; checkout is explicitly **unpaid**, even though it immediately reduces inventory. Do not deploy as a public paid store without these additions.
- **Running tests:** `PYTHONPATH=. python -m pytest -q` for unit/API contract tests (SQLite-backed tests do *not* prove PostgreSQL row locking); `docker compose exec -T api python -m scripts.concurrency_check` for actual concurrent checkout.
- **Resource costs:** free Aiven plans may be subject to suspension, quotas or platform-specific restrictions.

Keep `.env`, `./secrets/`, Terraform `.tfstate*` and certs out of Git. `.env.example` contains placeholders and local-only development passwords and must never be copied unchanged to production.

### Retailer REST endpoints (Swagger /api/docs)

| Method and path | Access | Purpose |
| --- | --- | --- |
| `POST /auth/register`, `POST /auth/login` | Public | Create customer account, sign in |
| `GET /retailers/me` | Customer JWT | See own GSTIN and application status |
| `POST /retailers/apply` | Customer JWT | Register business name and checksum-valid GSTIN; pending review |
| `GET /retailers/prices` | Any signed-in account | Base and effective per-SKU prices; no discount until approved |
| `GET /admin/retailers` | Admin JWT | Paginated retailer applications; private GSTIN records |
| `PATCH /admin/retailers/{id}/review` | Admin JWT | Approve/reject/suspend with `review_note` (minimum 10 characters) |
| `POST /orders/checkout` | Customer JWT | Atomic stock and *server-calculated* approved wholesale prices |

Retailer applications never change an account's `admin` role; user-controlled parameters cannot grant pricing privileges. User-facing search remains public retail prices; signed-in approved retailers see their effective price from the secured pricing endpoint. Do not enter real customer GSTINs in a public test log, GitHub issue, or screenshot. After changing the discount environment variable, restart the API (it uses cached settings) and test a new unpaid order.


## Troubleshooting **HTTP 502** after updating/recreating Docker containers

The static website loading at port 8080 does **not** prove the backend is reachable. Nginx can still serve HTML while failing to proxy requests. The API deliberately responds with **503** when OpenSearch is unavailable; **502** commonly indicates Nginx couldn't connect to the API container (for example, when its IP changed and a running Nginx cached the old address). The updated gateway resolves the API hostname with Docker DNS (`127.0.0.11`) and refreshes the address when containers change.

Run this from the project root:

```bash
git pull --ff-only origin feat/nothing
docker compose up -d --build --force-recreate gateway api
docker compose ps
bash scripts/check-search.sh
```

The diagnostic compares Nginx and direct API responses and checks the OpenSearch cluster and the `free` product query; it does not print secrets. If **gateway=502, direct API=200**, the issue is gateway DNS/routing. If **direct API isn't 200**, inspect `docker compose logs --tail=150 api migrate`. If **direct API search=503**, check OpenSearch then run `docker compose exec -T api python -m scripts.reindex` after the service is healthy. Never erase your database volume just to fix search. If your computer has another Compose project still using port 8080, stop it before running this project.

The GitHub Docker integration workflow now also deliberately **recreates the API container without recreating Nginx**, then checks gateway health and the real OpenSearch search results. This guards against a recurrence of stale upstream DNS.


## Stripe hosted Checkout (optional — separate from COD/unpaid)

Stripe checkout is **disabled by default**, and no live payment keys are embedded in the repository. Your Stripe account must be eligible; new India-based Stripe merchant accounts remain **invite-only**. The project can be tested with Stripe test-mode keys and the Stripe CLI, but an actual Stripe merchant account and webhook credentials must be supplied and verified by you.

### Setup for test payments

1. Obtain `sk_test_...` from your Stripe Dashboard (test mode).
2. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli) on your Mac, run `stripe login`, then in a separate terminal run:
   ```bash
   stripe listen --forward-to http://localhost:8080/api/payments/stripe/webhook
   ```
   Copy the webhook signing secret `whsec_...` printed by the CLI.
3. Add these keys **only** to your private `.env`:
   ```dotenv
   STRIPE_SECRET_KEY=sk_test_YOUR_REAL_TEST_SECRET
   STRIPE_WEBHOOK_SECRET=whsec_YOUR_CLI_WEBHOOK_SECRET
   PUBLIC_BASE_URL=http://localhost:8080
   ```
4. Rebuild: `docker compose up -d --build`, and run `docker compose run --rm migrate` (the migration also runs automatically as a dependency).
5. Refresh the website and sign in. Add Energy products and click **PAY WITH STRIPE**. Use a card from [Stripe's testing guide](https://docs.stripe.com/testing); no live money is collected in test mode. The separate **UNPAID / COD** button still creates an unpaid order.
6. Stripe redirects you back to the website. The browser return is *not proof of payment*: only a signed `checkout.session.completed` webhook with `payment_status=paid` marks the order paid. Check **Account → My Orders** and `docker compose logs -f api stripe-reconciler outbox consumer`.

The Stripe worker polls stuck/expired sessions, checks actual provider status, and restores inventory on verified expiry/failure. If a provider request may have succeeded but its session ID was not persisted, stock remains reserved for manual reconciliation rather than being released unsafely. The payment process uses idempotency keys and PostgreSQL row locking, with backend-calculated prices (including approved retailer discounts). The integration has mocked payment tests; a live hosted Stripe test Checkout cannot be certified until your Stripe credentials and reachable webhook are configured.

**New API routes:** `GET /payments/stripe/config`, `POST /payments/stripe/checkout`, `GET /payments/stripe/orders/{order_id}`, `POST /payments/stripe/orders/{order_id}/cancel`, and `POST /payments/stripe/webhook`. The webhook accepts raw Stripe-signed requests, not a customer JWT.

For live deployment use a public HTTPS `PUBLIC_BASE_URL`, register `https://YOUR_DOMAIN/api/payments/stripe/webhook` in Stripe Dashboard with event types `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and replace the CLI signing secret with that endpoint's secret. **Refunds, chargebacks, full payment reconciliation/alerting, taxes, GST-compliant invoices, actual cash collection, and a security review remain required for production.**

