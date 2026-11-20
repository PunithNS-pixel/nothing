# Nothing Energy Setup and Test Commands

See [README.md](README.md) for the full 8-step hackathon verification checklist and Aiven setup. For a clean **local demo**:

```bash
git clone --branch feat/nothing https://github.com/PunithNS-pixel/nothing.git
cd nothing
cp .env.example .env
openssl rand -hex 32
# Paste secret output as JWT_SECRET in .env; also set ADMIN_PASSWORD.
docker compose up -d --build
docker compose ps
docker compose exec -T api python -m scripts.seed
curl -fsS http://localhost:8080/api/health/ready
bash scripts/verify.sh
docker compose exec -T api python -m scripts.concurrency_check
```

**Frontend:** http://localhost:8080  · **Swagger API:** http://localhost:8080/api/docs · **Grafana:** http://localhost:3001

For Aiven cloud mode, use `compose.aiven.yaml` and `.env.aiven.example` following the README. `docker compose` local mode by itself does not fulfill the Aiven-hosted deployment requirement.

Troubleshooting: use `docker compose logs --tail=200 api migrate kafka opensearch` and `docker compose ps` if the app does not come up. Ensure Docker has adequate memory. Seed is idempotent and does not overwrite existing admin passwords.
