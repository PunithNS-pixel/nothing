# Nothing Coffee — run the full-stack store

## Requirements

- Docker Engine + Docker Compose v2 (or Docker Desktop)
- At least **6 GB free RAM** recommended; more is better for OpenSearch, Kafka, Prometheus, etc.
- Free local ports: 8080 (store), 8000 (direct API), 9090 (Prometheus), 3001 (Grafana), 15672 (RabbitMQ), 9200 (OpenSearch), 9092 (Kafka)
- On Linux, OpenSearch can require `sudo sysctl -w vm.max_map_count=262144`.

## 1. Configure

```bash
cp .env.example .env
openssl rand -hex 32
```

Paste the generated random value into `JWT_SECRET` in `.env`. Replace `ADMIN_PASSWORD` with a secure, unique password (at least 12 characters). Optionally replace `ADMIN_EMAIL`. Do not commit `.env`.

## 2. Start the system

```bash
docker compose up -d --build
# The `migrate` job runs automatically; API/workers depend on it finishing.
docker compose ps
# Seed the four Nothing products with demo prices + stock:
docker compose exec api python -m scripts.seed
# View the event flow:
docker compose logs -f outbox consumer notifications
```

Open **http://localhost:8080**. Your storefront, authentication, cart, orders, newsletter, and search all use `/api/...` on the same origin. Backend API docs are at **http://localhost:8080/api/docs**.

### Demo user journey

1. Open the home page; the coffee products load from PostgreSQL.
2. Select **Account**, create an account with an email and password of at least 12 characters, then sign in.
3. Use **Shop this flavor** or a product **↗** button to add a case.
4. In the cart, choose **Bengaluru**, **Mumbai**, or **Delhi** (cart and inventory are per city).
5. Select **Checkout**, confirm an **unpaid order**. The order is committed to PostgreSQL and stock is deducted atomically.
6. Select **My Account → My Orders** to see your order in PostgreSQL.
7. Select **Search** and try `mocha` or `vanila` in a stocked city. Search is served by **OpenSearch**, indexed from **Kafka** events. There may be a short delay after startup until the worker indexes products.
8. Check the log stream from `outbox`, `consumer`, and `notifications` to see the event delivery. **RabbitMQ** carries confirmation jobs; the demo notification worker logs confirmations, it does not email customers.

### Monitoring

- Grafana: http://localhost:3001 (login from `GRAFANA_ADMIN_PASSWORD`, user `admin`)
- Prometheus: http://localhost:9090
- RabbitMQ admin: http://localhost:15672 (local-only guest login)
- Local OpenSearch: http://localhost:9200
- API /health: http://localhost:8080/api/health/ready

### APIs

All API calls use the same origin `/api` prefix through Nginx. The underlying FastAPI application exposes `/auth/...`, `/products`, `/cart`, `/orders`, `/search`, and `/newsletter`. `Idempotency-Key` is required at checkout. Customer operations require a bearer JWT. Swagger lists each endpoint and schema.

### Stop and preserve data

```bash
docker compose down
```

**Data-loss warning** — only use this to delete your entire local database and queue/search state:

```bash
docker compose down -v
```

### Run tests

With Python 3.12 and dependencies from requirements.txt installed:

```bash
PYTHONPATH=. python -m pytest -q
node --check web/app.js
```

## Aiven deployment

The included `infra/terraform` contains provisioning scaffolding for Aiven PostgreSQL, Kafka, and OpenSearch. Review provider and service-plan availability, apply infrastructure to your account, and set `DATABASE_URL`, Kafka TLS/SASL settings, and `OPENSEARCH_*` variables using the real Aiven connection data. Files under `infra` document the TLS environment keys. **Do not point a production instance at the local plaintext Kafka/OpenSearch defaults.** Aiven free-tier and plan entitlements may change: verify in your account. RabbitMQ, Grafana, and Prometheus are local Docker services here, not automatically provisioned by the included Aiven Terraform.

## Commercial deployment limitations

**This is a working-oriented hackathon integration, not a certified production-ready store.** These features are NOT integrated: payment collection/capture/refunds, tax calculation, shipping address/delivery, actual email dispatch, GDPR/privacy consent/opt-out and email verification, password-reset workflow, MFA, web-application firewall and production TLS certificates, CDN, scalable cluster orchestration/HA/failover/backup restoration, distributed tracing, secrets management, SLO alerts, full load/security testing, and external penetration testing. Do not advertise it as accepting paid orders, expose admin and metrics endpoints publicly, or take real payments before implementing those requirements.

The frontend keeps short-lived access and rotating refresh tokens in **sessionStorage**. For a public deployment, replace this with a hardened **same-site HttpOnly secure-cookie/BFF session** pattern, CSRF protection as applicable, a stricter CSP, and verified TLS at the edge. The store currently generates **unpaid orders** and reserves stock; establish a payment/fulfillment business workflow before processing real purchases.

Product prices are **sample INR amounts**, not authoritative coffee product prices, and caffeine/ingredient claims and images come from the submitted frontend demo. Review and replace brand/legal/food claims with verified information before launch.
