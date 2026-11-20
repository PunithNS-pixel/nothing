# Nothing Coffee — integrated full-stack store

A full-stack e-commerce demo integrating the Nothing Coffee storefront with a FastAPI backend, PostgreSQL, Kafka, OpenSearch, RabbitMQ, Prometheus, Grafana, and Terraform scaffolding.

> **Status:** Hackathon/demo integration, not a production-certified commerce system. Checkout creates **unpaid orders**; payment collection, real emails, shipping and tax integrations are not implemented. The bundle passed static checks, but complete multi-service end-to-end behavior has not been verified in this environment.

## Run locally

**Prerequisites:** Docker Desktop / Docker Engine with Compose v2, 6 GB+ available RAM, and free ports 8080, 8000, 3001, 9090, 15672, 9200, 9092. On Linux, OpenSearch may require `sudo sysctl -w vm.max_map_count=262144`.

```bash
git clone --branch feat/nothing-coffee-fullstack https://github.com/PunithNS-pixel/nothing.git
cd nothing
cp .env.example .env
openssl rand -hex 32
# Edit .env: use the generated JWT_SECRET and a strong ADMIN_PASSWORD.
docker compose up -d --build
docker compose ps
docker compose exec api python -m scripts.seed
```

Open **http://localhost:8080** (store) and **http://localhost:8080/api/docs** (Swagger).

**Demo:** create an account (12+ character password), browse coffee products, add to cart, choose Bengaluru/Mumbai/Delhi for city inventory, place an **unpaid** order, view **My Orders**, and test fuzzy search with "vanila". Events flow PostgreSQL outbox → Kafka → consumer → OpenSearch and RabbitMQ notification jobs. Notification worker only logs confirmations.

```bash
docker compose logs -f outbox consumer notifications
```

| Service | Local URL |
| --- | --- |
| Store | http://localhost:8080 |
| API / Swagger | http://localhost:8080/api/docs |
| API health | http://localhost:8080/api/health/ready |
| Grafana | http://localhost:3001 |
| Prometheus | http://localhost:9090 |
| RabbitMQ management | http://localhost:15672 |

Grafana uses `admin` plus `GRAFANA_ADMIN_PASSWORD` from `.env`. Local RabbitMQ defaults are for development only.

## Development

```bash
docker compose logs --tail=100 api outbox consumer notifications
PYTHONPATH=. python -m pytest -q
node --check web/app.js
docker compose down        # keep data
docker compose down -v     # WARNING: deletes local database/queues
```

The `migrate` service runs before the API automatically. The seed script inserts four demo products. If the site isn't reachable, inspect `docker compose ps` and `docker compose logs --tail=100 gateway api migrate`.

## Architecture and Aiven

- **PostgreSQL:** products, customers, cart, orders, city-wise stock and transactional outbox. Inventory is deducted **atomically within checkout** to prevent overselling.
- **Kafka:** domain events from committed changes, processed asynchronously.
- **OpenSearch:** indexed search with typo tolerance and filtering; search refreshes after events.
- **RabbitMQ:** durable notification tasks (logged in the demo, not emailed).
- **Prometheus/Grafana:** local API telemetry, dashboards.
- **Terraform:** `infra/terraform` Aiven provisioning *scaffold* for PostgreSQL, Kafka and OpenSearch. Managed services and TLS credentials must be configured separately; the supplied Docker stack uses local services.

### Project structure

```text
web/                 Nothing Coffee storefront and API integration
app/                 FastAPI routes, auth, models and search
workers/             Kafka outbox/consumer; RabbitMQ notifications
alembic/             Database schema migrations
scripts/             Seed/demo commands
tests/               Contract tests
infra/               Nginx, Prometheus, Grafana and Aiven Terraform
compose.yaml         Docker Compose development stack
.env.example         Environment template (do not commit .env)
```

See **QUICKSTART.md**, **ARCHITECTURE.md** and **PRODUCTION_CHECKLIST.md** for further details.

## Security and limitations

Do **not** commit `.env`, credentials, certificates or private keys. For production, add TLS, secure cookie/BFF auth with CSRF protection, payment provider and webhook verification, taxes, shipping, email verification/recovery, real transactional emails, HA/backup/restore, alerting, load tests, secrets management and independent security review. Local Compose settings (including plaintext Kafka, disabled OpenSearch security and RabbitMQ guest) are **not production settings**. Product prices are demo INR values.

## Initial code import

The integration branch may temporarily include `.source/` and a bootstrap workflow while the source archive is expanded. When materialization finishes, the source files live at the repository root. If a workflow is disabled, extract `.source/nothing-coffee-source.tar.xz` into the repository root manually (after decoding the stored archive, if necessary) and remove `.source/`.
