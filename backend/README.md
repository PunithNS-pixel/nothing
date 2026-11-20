# Nothing Market — backend and administration

This backend belongs to the **Nothing Market multi-category retail store**. See the root README for the complete architecture and customer journey.

## Database administrator access

The local PostgreSQL container is configured with database `nothing` and user `nothing`, whose password is the private `LOCAL_DB_PASSWORD` in `backend/.env`. This is a database connection account and is **not the storefront admin login**.

The quickest administrative shell from repository root:

```powershell
docker compose -f backend/compose.yml --env-file backend/.env exec postgres psql -U nothing -d nothing
```

Inside psql, `\dt` lists tables; `SELECT count(*) FROM users;` counts user records. Use `\q` to exit. Do not show password hashes or personal information in demo screenshots.

For an optional local-only visual database interface, set unique `PGADMIN_EMAIL` / `PGADMIN_PASSWORD` in your private `backend/.env`, then run:

```powershell
docker compose -f backend/compose.yml --env-file backend/.env --profile dbadmin up -d pgadmin
```

Open http://localhost:5050 and sign in with `PGADMIN_EMAIL` and `PGADMIN_PASSWORD`. In pgAdmin choose **Add New Server**:

- Name: `Nothing Market Local`
- Connection hostname: `postgres` (service hostname within Docker networking)
- Port: `5432`
- Maintenance database: `nothing`
- Username: `nothing`
- Password: the private `LOCAL_DB_PASSWORD`

The pgAdmin web port is bound to `127.0.0.1`, not publicly exposed. Its own credentials do not grant access to PostgreSQL without the separate DB connection credentials. Do not expose pgAdmin to the public internet.

When using the Aiven deployment profile, start the optional `pgadmin` service using `backend/compose.aiven.yml` and `backend/.env.aiven`. Enter the **Aiven PostgreSQL host, port, database, user and password** from the Aiven console, and configure SSL mode **Require** in the pgAdmin server connection settings. Do **not** enter `postgres` as the host for an Aiven connection.

## Automated local integration checks

Run the read-only PowerShell diagnostics:

```powershell
powershell -ExecutionPolicy Bypass -File backend/scripts/verify-integrations.ps1
```

This checks Compose, PostgreSQL queries, application catalog, fuzzy and substring OpenSearch responses, Kafka topics and outbox delivery evidence, RabbitMQ broker health, Prometheus target status and Grafana health. It does not place test orders or delete data. It cannot verify Aiven simply by seeing local Compose containers: check the Aiven console and start the Aiven Compose profile separately.

To verify the order-to-Kafka-to-OpenSearch flow, place a test COD order, then re-run the diagnostics and compare order, outbox, consumed and inventory counts. Production checks should include authenticated browser testing and failure-recovery drills.

## Terraform

```powershell
cd backend/infrastructure/terraform
terraform init
terraform validate
terraform plan
```

Terraform requires an authorized Aiven API token and project configuration; `terraform validate` checks definitions but does not verify cloud resources have been provisioned. Terraform state can contain secrets; use a secure remote state backend. Prefer environment variables for your API token over committing Terraform variable files.

## Security boundaries

- Customer accounts, retailer approval and the store administrator account are application-level identities.
- PostgreSQL administrative access is privileged database access, not part of the public website.
- Aiven PostgreSQL `avnadmin` is a service-scoped database account, not a machine root or an Aiven organization admin.
- Credentials must remain in private `.env` files. Never paste them in issues, chat or commits.
