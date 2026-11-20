# NOTHING Energy — Aiven Hackathon Store

**Status:** a Docker-ready, frontend-agnostic **e-commerce demonstration** with the provided NOTHING Energy animated storefront. It supports real (unpaid) orders and stock updates. **Not a fully production-validated retail deployment.** No payment provider, real email delivery, shipping or tax engine is included.

[Frontend source](web/) · [Architecture](ARCHITECTURE.md) · [API Swagger](http://localhost:8080/api/docs) · [Production checklist](PRODUCTION_CHECKLIST.md)

## What is implemented

| Part | Backend implementation and proof |
| --- | --- |
| Frontend | Uploaded NOTHING Energy five-can design; responsive animations, cart drawer, account/search/orders/admin dialogs; real product images |
| Authentication & RBAC | Argon2 password hashing; access JWT; refresh token rotation and logout; admin-only APIs |
| PostgreSQL | Users, refresh tokens, six SKUs, per-city inventory, carts, orders/items, audit log, newsletter subscribers and outbox; foreign keys, uniqueness and check constraints |
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

After first seed wait a few seconds for Kafka -> OpenSearch index propagation. Do not run `docker compose down -v` unless you intend to erase data.

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
6. SEARCH: try `watermelan`, filter category `Energy Drinks`, city and price. Results are returned by **OpenSearch**, not PostgreSQL.
7. Admin: sign in using your `.env` admin email and password; select ACCOUNT → ADMIN DASHBOARD to view customers/recent orders, update stock, move orders through `placed → processing → shipped → delivered`. Admin routes enforce RBAC on the server.
8. Inspect outbox → Kafka → search/notification flow with the commands below.

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
curl -fsS http://localhost:9200/_cat/indices?v

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

# 8. Combined smoke checks
bash scripts/verify.sh
```

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

## Technical boundaries

- **Transactions:** Kafka/Opensearch/RabbitMQ processing is asynchronous (eventual consistency). PostgreSQL is source of truth; the outbox reduces lost-event risk. It is not one distributed ACID transaction.
- **Admin:** dashboard and REST APIs are RBAC protected; admin data must not be exposed to customers. The dashboard shows recent 25 records; API uses pagination.
- **Security:** credentials never committed. Browser session tokens currently reside in `sessionStorage`, which is not ideal for production XSS resistance; production should use audited HttpOnly session-cookie/BFF auth and CSRF defenses, TLS, secret manager, alerting, hardened RabbitMQ/Kafka/OpenSearch configs.
- **Commercial launch:** no payment capture, refunds, taxes, shipment tracking, customer email verification or actual email delivery; checkout is explicitly **unpaid**, even though it immediately reduces inventory. Do not deploy as a public paid store without these additions.
- **Running tests:** `PYTHONPATH=. python -m pytest -q` for unit/API contract tests (SQLite-backed tests do *not* prove PostgreSQL row locking); `docker compose exec -T api python -m scripts.concurrency_check` for actual concurrent checkout.
- **Resource costs:** free Aiven plans may be subject to suspension, quotas or platform-specific restrictions.

Keep `.env`, `./secrets/`, Terraform `.tfstate*` and certs out of Git. `.env.example` contains placeholders and local-only development passwords and must never be copied unchanged to production.
