# Nothing Coffee — Spring Boot backend

Java 21 / Spring Boot 3.2.5. Integrated with the existing `nothing-coffee/` frontend in this repository.

## Development setup

1. Install Docker Compose.
2. Copy `backend/.env.example` to `backend/.env` and replace all placeholder credentials.
3. Generate a Base64 encoded random 32+ byte JWT key using a cryptographically secure tool.
4. Run from the repository root: `docker compose -f backend/compose.yml --env-file backend/.env up --build`.
5. Open the storefront at http://localhost:8000 and backend API at http://localhost:8080/api/public/products.
6. Open Grafana at http://localhost:3000 and Prometheus at http://localhost:9090.

Run `mvn test` and verify the Kafka, PostgreSQL and OpenSearch connections before deployment.

## APIs

- `GET /api/public/products?pageSize=100` — database catalog
- `GET /api/search/products?q=cofee` — OpenSearch fuzzy query
- `POST /api/auth/signup`, `POST /api/auth/signin` — user registration/login
- `POST /api/cart/create` — set authenticated cart
- `POST /api/addresses` — create shipping address
- `POST /api/order/users/payments/COD` — cash-on-delivery order using verified server stock

## Infrastructure

Development Compose starts local PostgreSQL, Kafka, OpenSearch, RabbitMQ, Prometheus and Grafana. Hackathon judges require connecting to the **three actual Aiven services**: provision them using the Terraform examples and replace local credentials/endpoints in the environment. No provider credentials belong in Git.

## Security / limitations

- Legacy development passwords, JWT keys and hard-coded demo user accounts have not been carried forward.
- Do not treat this integration as production ready without full Maven, Docker and live Aiven tests.
- Non-COD payments are blocked until a server-verified Stripe webhook is implemented.
- PostgreSQL checkout has an atomic quantity check, but checkout idempotency and reservation expiry still need completion.
- RabbitMQ currently logs a queued notification; actual email/SMS delivery is not configured.
- City inventory is not implemented; OpenSearch city field remains empty.
- Existing models and migration from the legacy database require staging verification.

This code is based on user-supplied existing e-commerce backend code, with new integration layers. Audit dependencies and permissions before deployment.
