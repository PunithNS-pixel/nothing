# Nothing Market — full-stack retail demo

A retail storefront for products across India: **electronics, fashion, home & living, grocery, and beauty**.

**GitHub branch:** `backend`. Existing coffee records are retained in PostgreSQL to avoid deleting users' data, but the retail catalog hides the legacy Coffee category.

## Architecture

```text
Browser storefront (Nothing Market)
       |
       +--> Spring Boot API (JWT cookie)
                 |
                 +--> PostgreSQL: customers, addresses, carts, orders, stock, transactional outbox
                 +--> Kafka outbox publisher -> Kafka topic nothing.events
                          |
                          +--> consumer -> OpenSearch product index updated
                          +--> order event -> RabbitMQ notification queue (log-only worker)
                 +--> OpenSearch: fuzzy name/description + category/city/price filters
                 +--> Micrometer /actuator/prometheus -> Prometheus -> Grafana
```

**Checkout correctness:** the order service reserves stock using a conditional PostgreSQL UPDATE inside the transaction and refuses overselling. The Kafka event is emitted from the outbox asynchronously; inventory is already reduced before commit, not deferred to the consumer. This avoids committing an order for stock you don't have.

## First run — local Docker

From the repository root:

```powershell
Copy-Item backend\.env.example backend\.env
notepad backend\.env
docker compose -f backend/compose.yml --env-file backend/.env up --build -d
docker compose -f backend/compose.yml --env-file backend/.env ps
```

Use strong random JWT secret and passwords. Default frontend: **http://localhost:8000**, backend API: **http://localhost:8090**, metrics: **http://localhost:8091**. Port values can be overridden with APP_HTTP_PORT and APP_METRICS_PORT. The frontend API URL is also configurable in the browser's localStorage key `nothing-api-url` (default 8090).

The development-only `SEED_RETAIL_CATALOG=true` adds 14 sample products to empty/migrated databases and emits product-change events. It does not delete existing data. Existing Coffee seed is disabled.

## Aiven services (required for hackathon submission)

1. Provision **Aiven PostgreSQL**, **Aiven Apache Kafka** and **Aiven OpenSearch** in your team's Aiven project.
2. Create a Kafka topic named `nothing.events`, with service credentials that can produce and consume.
3. Copy `backend/.env.aiven.example` to `backend/.env.aiven` and set all fields using the connection details in the Aiven console.
4. The JDBC URL must have `?sslmode=require` (or stricter certificate verification). Aiven Kafka uses `SASL_SSL` and `SCRAM-SHA-256` by default; set the full `AIVEN_KAFKA_SASL_JAAS_CONFIG`. OpenSearch requires an HTTPS endpoint and credentials.
5. Stop the local Compose stack (without `-v`) before starting the Aiven stack to avoid port collisions.
6. Start the Aiven stack:

```powershell
docker compose -f backend/compose.yml --env-file backend/.env down
docker compose -f backend/compose.aiven.yml --env-file backend/.env.aiven up --build -d
```

**Do not upload Aiven credentials, .env files, CA keys or Terraform state to GitHub.** For hosted deployment, use HTTPS behind a reverse proxy and set `JWT_COOKIE_SECURE=true`; configure FRONTEND_URL to your HTTPS origin.

## User journey

- Browse live catalog: `GET /api/store/catalog` (PostgreSQL).
- Search with typos, city, category and price filters: `GET /api/search/products?q=bluetoth&category=Electronics&city=Bengaluru` (OpenSearch).
- Sign up / sign in: `POST /api/auth/signup`, `POST /api/auth/signin`.
- Update per-user cart: `POST /api/cart/create` (PostgreSQL, immediately on every add/remove).
- Restore saved cart after login: `GET /api/carts`.
- Save delivery address: `POST /api/addresses`.
- COD checkout: `POST /api/order/users/payments/COD`.
- View your order history: `GET /api/customer/orders`.
- Verify outbox events:
  `docker exec backend-postgres-1 psql -U nothing -d nothing -c "select topic,event_key,published_at from nothing_outbox order by created_at desc limit 10;"`
  (this last command is for **local Compose only**).

Customer account passwords are stored as BCrypt hashes. Shopping carts are user-scoped in PostgreSQL; guest carts are browser-local until login. The frontend uses the backend-calculated price for checkout.

## Monitoring

Prometheus at http://localhost:9090 scrapes `app:8081/actuator/prometheus`. Grafana at http://localhost:3000 has a provisioned Nothing dashboard showing request rate, 5xx rate, JVM memory and Kafka lag. RabbitMQ is a notification queue; real email/SMS delivery isn't yet implemented.

## Deployment limitations

This is **a hackathon demo**, not a production-certified store. Features still needed for public production: verified online-payment webhooks, durable email/SMS notification provider, database migrations strategy and backups, CSRF protection for cookie auth, rate limiting, checkout idempotency and cancellation flows, inventory per-city warehouse (current city is a product-level attribute), distributed tracing, private network rules, horizontal-scale performance validation, and live Aiven end-to-end tests. Terraform examples are provided in `backend/infrastructure/terraform`, but no infrastructure is automatically provisioned without your Aiven project token/plan settings.

The GitHub CI workflow compiles, runs backend tests against an isolated PostgreSQL service, and validates frontend JavaScript syntax.
