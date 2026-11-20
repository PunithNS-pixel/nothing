# Architecture and integration map

```text
Browser: static Nothing Coffee HTML/CSS/JS
   │  same-origin /api/*
   ▼
Nginx gateway (serves static files, throttles API/auth)
   │
FastAPI
 ├── PostgreSQL (users, catalog, city inventory, cart, orders,
 │                 refresh sessions, newsletter, audit + outbox)
 ├── /search ────────────────► OpenSearch
 └── transaction outbox ──► publisher ─► Kafka
                                         │
                                   Kafka consumer
                                    │       │
                             index product   send order.placed to
                             in OpenSearch   RabbitMQ confirmations queue
                                                │
                                          notification worker
                                         (logs; no email adapter)

FastAPI /metrics ─► Prometheus ─► Grafana
Terraform (infra/terraform) ─► Aiven service provisioning scaffolding
```

## Storefront → backend integration

| Browser interaction | API | Persistent effect |
|---|---|---|
| Page load | `GET /api/products` plus `GET /api/products/:id` | Catalog + authoritative city stock from PostgreSQL |
| Register | `POST /api/auth/register` | User record; Argon2 password hash |
| Login | `POST /api/auth/login` | JWT access token + rotating refresh token |
| Account session | `GET /api/auth/me`, `POST /api/auth/refresh`, `/auth/logout` | Session state, token revocation |
| Add or update cart | `POST /api/cart/items`, `DELETE /api/cart/items/:id?city=...` | Per-user, per-city cart |
| Cart view | `GET /api/cart` | PostgreSQL cart |
| Checkout | `POST /api/orders/checkout`, `Idempotency-Key` | Atomic order and locked stock decrement |
| My orders | `GET /api/orders` | Order history |
| Search | `GET /api/search?q=...&city=...&category=Coffee` | OpenSearch index from Kafka consumer |
| Newsletter | `POST /api/newsletter` | PostgreSQL subscriber record (no outbound mail) |

## Checkout consistency

The API locks the customer row and inventory rows inside a PostgreSQL transaction. Order insertion, cart clearing, stock decrement, inventory events and order event all commit together. Outbox publisher sends committed events to Kafka at least once. Consumer deduplicates event IDs. Search eventually reflects inventory changes. Successful checkout returns an unpaid `placed` order; it does **not** charge or schedule shipment.

## Important architectural constraints

- Monolithic REST API + separate asynchronous workers; scale independently with design review and a production orchestration layer.
- The outbox publisher is single-instance by default; multiple replicas need row claiming/leases to avoid duplicate publications (events are deduplicated downstream, but unnecessary replay increases load).
- OpenSearch search results can briefly lag transactional stock.
- Kafka, RabbitMQ, OpenSearch local Compose are single-node development examples, not fault-tolerant production clusters.
- This repository does not configure distributed production secrets, backup restoration, certificate issuance, payment providers or shipping carriers.
