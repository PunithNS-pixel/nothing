# Google Cloud deployment — NOTHING Marketplace HTTPS demonstration

The current deployment source is GitHub `main`. This repository includes a runnable
**Google Compute Engine single-VM demo** in `backend/compose.gce.yml`, with an automated
Mac deployment script in `scripts/deploy-gce.sh`.

## What is deployed

- One **Ubuntu 24.04 VM** in Google Compute Engine, default `asia-south1-a`,
  machine `e2-standard-4` (4 vCPU, 16 GB), 80 GB persistent boot disk.
- One Docker Compose network containing PostgreSQL 16, Spring Boot, Kafka,
  OpenSearch, RabbitMQ, the static Nginx frontend and Caddy.
- A reserved **static public IPv4** and **HTTPS** using automatic Caddy
  certificate issuance/renewal. Only **TCP ports 80 and 443** are exposed by the
  application; database, broker, app 8080 and management 8081 have no host ports.
- **Secure JWT cookies**, server-authoritative coupon/stock checkout, and
  asynchronous order confirmation retries. Local offers/catalog demo seeding.
- Persistent Docker volumes for PostgreSQL, RabbitMQ, OpenSearch and Caddy.
  Kafka is a single-node demo broker; this VM is **not multi-host HA**.

The deployment script uses your own authenticated Google Cloud CLI to create
billable resources. **No direct Google Cloud connector is available through this
chat**, so nobody can truthfully claim your VM has already been started without
running the script in your account.

## Prerequisites on your Mac

Your Google Cloud **project ID** (not the display name, which may be "My First
Project"), an enabled **billing account**, permissions to create Compute
Engine VMs, firewalls and reserved IPs, and the Google Cloud CLI.

Install and authenticate:

```bash
brew update && brew install --cask gcloud-cli
gcloud init
gcloud auth login
gcloud config get-value project
```

Google Cloud currently documents the `gcloud-cli` Homebrew cask.
Google may require a billing method or prepaid balance; **the script never
bypasses billing or enables a free forever deployment**. The default VM,
boot disk and static IP incur ongoing charges while active/reserved.

Make sure the correct GitHub code is on your Mac:

```bash
git fetch --prune origin
git switch main
git pull --ff-only origin main
test -f backend/.env || cp backend/.env.example backend/.env
```

Your `backend/.env` can contain *local* credentials. On the **first** GCE deployment,
the script generates a **different** strong PostgreSQL password, RabbitMQ password
and JWT secret into the Git-ignored **`backend/.env.gce`**. It preserves that
file on later updates so your stored orders remain accessible. Keep both files
private and never commit them. The script securely transfers the GCE env over
Google Cloud SSH/SCP to the VM. OAuth refresh tokens and secrets are **never
stored in VM metadata or printed to logs**.

If `MAIL_PROVIDER=gmail-api` is enabled and OAuth credentials are complete,
the existing sender configuration is copied from the local env. Incomplete
Gmail API or SMTP credentials cause notifications to be disabled until fixed.
The previously shared Google OAuth client secrets must be rotated first.
This does not complete OAuth authorization or prove real email delivery.

## One-command infrastructure and rollout

**This provisions billable resources.** From the repository root, run:

```bash
export GCP_PROJECT="$(gcloud config get-value project)"
export GCP_ZONE="asia-south1-a"
DEPLOY_CONFIRM=YES bash scripts/deploy-gce.sh
```

The script enables Compute Engine API, reserves a static IPv4 address,
creates a minimal web-only VPC firewall rule, creates/reuses an Ubuntu VM
without a privileged service account, installs Docker Engine + Compose,
checks out the latest `main`, transfers the private GCE env by SSH,
runs `docker compose up -d --build`, and verifies a real HTTPS request.

Unless you supply `SITE_DOMAIN`, the URL is generated from the reserved IP
using **`<IPv4>.sslip.io`** (e.g. `https://203.0.113.10.sslip.io/`).
This free third-party DNS mapping is convenient for an **ephemeral hackathon
demo** but isn't a brand-owned domain or guaranteed long-term DNS service.
Caddy's Let's Encrypt issuance can be delayed or rate-limited. You can
instead set `SITE_DOMAIN=store.your-owned-domain.example` after creating a
matching DNS **A record** pointing to the reserved public IPv4. To discover the
IP before the first deployment, use:

```bash
gcloud compute addresses create nothing-market-ip --region=asia-south1 --project="$GCP_PROJECT"
gcloud compute addresses describe nothing-market-ip --region=asia-south1 --project="$GCP_PROJECT" --format="value(address)"
```

If the static IP already exists, use only the second command. Then configure
your DNS and run the deploy script with `SITE_DOMAIN=your.domain.example`.

## Validate that it really works

The deploy script reports **HTTPS deployment verified** only if an HTTPS
request to `/api/store/offers` actually succeeds. On your Mac:

```bash
curl -fsS "https://<YOUR-DEPLOYED-HOSTNAME>/api/store/offers" | python3 -m json.tool
curl -fsS "https://<YOUR-DEPLOYED-HOSTNAME>/api/store/catalog" | python3 -m json.tool
```

Open the HTTPS homepage, check Better Deals and product catalog, and use a
**test COD order** to verify a real PostgreSQL stock decrease. For notifications,
check the buyer's `ORDERS → CONFIRMATION EMAIL STATUS`; `SENT` means accepted
by Gmail/SMTP, not a guarantee of inbox delivery. Never enter real payment data
or real customer addresses into an unverified demonstration.

To inspect containers without publishing management ports:

```bash
gcloud compute ssh nothing-market-demo --zone=asia-south1-a --project="$GCP_PROJECT" --command='cd ~/nothing-marketplace && sudo docker compose -f backend/compose.gce.yml --env-file backend/.env ps'
```

For recent app/Caddy logs (do not share environment variables):

```bash
gcloud compute ssh nothing-market-demo --zone=asia-south1-a --project="$GCP_PROJECT" --command='cd ~/nothing-marketplace && sudo docker compose -f backend/compose.gce.yml --env-file backend/.env logs --tail=100 app caddy'
```

`backend/compose.gce.yml` is a **separate** project from your Mac's
`backend/compose.yml` and `backend/compose.ha.yml`. It creates its own
empty PostgreSQL database on the VM and seeds demo catalog/offers. It does **not**
migrate the orders/users in your laptop's database. To preserve and migrate
real data safely, plan and test a PostgreSQL backup/restore separately.

## Updating and redeploying

After updating `main`, rerun the same deployment script. It reuses the
existing static IP, VM and `backend/.env.gce`, and rebuilds application
containers without deleting database volumes. Don't run `docker compose down -v`.
If you intentionally change the public hostname, update the GCE env by rerunning
the script with `SITE_DOMAIN`.

## Production-readiness warning

This is intended for a supervised **hackathon demo** only. The application
currently disables Spring Security CSRF protections while using JWT cookie
authentication, has no automated Stripe settlement/refunds for all edge cases,
and its single host is a single point of failure. The VM also runs single
Kafka/RabbitMQ/OpenSearch instances, without robust backups, paging, global
DDoS/WAF protections or high availability. **Do not process real payments or
production personal data on this configuration.** Stripe test-mode keys only
are accepted by the GCE env generator. Google Cloud firewalls protect host
ports; independently review the VPC's existing SSH firewall rules and use
OS Login/IAP or a narrowed source address where appropriate.

For production, move PostgreSQL and brokers to managed private services,
implement CSRF defenses, add real disaster recovery/backup schedules,
configure your own domain and sender authentication, enforce IAM least privilege,
add observability and harden checkout reconciliation first.

## Cost control and teardown

The VM, persistent boot disk and reserved IPv4 incur charges. To pause
compute, run:

```bash
gcloud compute instances stop nothing-market-demo --zone=asia-south1-a --project="$GCP_PROJECT"
```

The disk and reserved IP can still incur charges while stopped. For permanent
deletion **after exporting needed database data**, run:

```bash
gcloud compute instances delete nothing-market-demo --zone=asia-south1-a --project="$GCP_PROJECT"
gcloud compute addresses delete nothing-market-ip --region=asia-south1 --project="$GCP_PROJECT"
gcloud compute firewall-rules delete nothing-market-web --project="$GCP_PROJECT"
```

Deleting the VM **deletes its boot disk and Docker volumes by default**, so
database/order contents are lost without a backup. These commands do not
automatically delete your local files or `backend/.env.gce`.

References: [Google Compute Engine VM](https://docs.cloud.google.com/compute/docs/instances/create-start-instance),
[secure Compute Engine networking](https://docs.cloud.google.com/solutions/connecting-securely),
[Google Cloud CLI on macOS](https://docs.cloud.google.com/sdk/docs/downloads-homebrew),
[Caddy HTTPS](https://caddyserver.com/docs/automatic-https).
