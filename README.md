# Nothing — coffee storefront and backend

This repository contains the existing animated Nothing Coffee storefront in [nothing-coffee/](nothing-coffee/) and the integrated Java 21 Spring Boot service in [backend/](backend/).

## Run locally

Copy `backend/.env.example` to `backend/.env`, set strong unique secrets, then:

```bash
docker compose -f backend/compose.yml --env-file backend/.env up --build
```

- Frontend: http://localhost:8000
- REST API: http://localhost:8080/api/public/products
- OpenSearch API: http://localhost:8080/api/search/products?q=cofee
- Grafana: http://localhost:3000

The four demo coffee products are seeded only by the local Docker Compose environment. Customers can create accounts and place cash-on-delivery orders; non-COD payments are intentionally disabled until a verified payment webhook is available.

**Status:** Code is pushed for integration review; a successful Maven/Docker/live-Aiven test run has not yet been established. Read backend/README.md for deployment limitations. Do not expose this prototype as a production store.
