#!/usr/bin/env bash
# Run on your Mac. Create/reuse one billable Google Compute Engine demo VM.
# Only the HTTPS frontend is internet-facing; database/brokers stay private.
set -euo pipefail

cd "$(dirname "$0")/.."

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
for command in gcloud python3 git curl; do
  command -v "$command" >/dev/null 2>&1 || fail "Missing $command. Install Google Cloud CLI / Python 3 first."
done

GCP_PROJECT="${GCP_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
GCP_ZONE="${GCP_ZONE:-asia-south1-a}"
GCP_REGION="${GCP_REGION:-${GCP_ZONE%-?}}"
GCP_VM="${GCP_VM:-nothing-market-demo}"
GCP_NETWORK="${GCP_NETWORK:-default}"
GCP_IP_NAME="${GCP_IP_NAME:-nothing-market-ip}"
GCP_FIREWALL="${GCP_FIREWALL:-nothing-market-web}"
GCP_TAG="nothing-market-web"
GCP_MACHINE="${GCP_MACHINE:-e2-standard-4}"

[[ "$GCP_PROJECT" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || fail "Set GCP_PROJECT to your Google Cloud PROJECT ID."
[[ "$GCP_ZONE" =~ ^[a-z0-9-]+-[a-z]$ ]] || fail "Invalid GCP_ZONE"
[[ "$GCP_REGION" =~ ^[a-z0-9-]+$ ]] || fail "Invalid GCP_REGION"
[[ "$GCP_VM" =~ ^[a-z]([a-z0-9-]*[a-z0-9])?$ ]] || fail "Invalid GCP_VM"
test -f backend/.env || fail "Create backend/.env from backend/.env.example first."
test -f backend/compose.gce.yml || fail "Pull latest main branch to get backend/compose.gce.yml"
test -n "$(gcloud auth list --filter='status:ACTIVE' --format='value(account)' 2>/dev/null)" ||
  fail "Run gcloud auth login on your Mac first."

printf 'Project: %s\nZone: %s\nMachine: %s\n' "$GCP_PROJECT" "$GCP_ZONE" "$GCP_MACHINE"
printf 'Deployment is a SINGLE-VM DEMO, not a production-safe financial system.\n'
printf 'Creating a VM, persistent disk and static IP WILL incur Google Cloud charges.\n'
[[ "${DEPLOY_CONFIRM:-}" == "YES" ]] ||
  fail "To authorize billing resources, rerun with DEPLOY_CONFIRM=YES"

gcloud services enable compute.googleapis.com --project="$GCP_PROJECT"

if ! gcloud compute addresses describe "$GCP_IP_NAME" --region="$GCP_REGION" \
    --project="$GCP_PROJECT" >/dev/null 2>&1; then
  gcloud compute addresses create "$GCP_IP_NAME" --region="$GCP_REGION" --project="$GCP_PROJECT"
fi
IP="$(gcloud compute addresses describe "$GCP_IP_NAME" --region="$GCP_REGION" \
    --project="$GCP_PROJECT" --format='value(address)')"
[[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
  fail "Could not retrieve a static IPv4 address"
SITE_DOMAIN="${SITE_DOMAIN:-$IP.sslip.io}"
[[ "$SITE_DOMAIN" =~ ^[A-Za-z0-9.-]+$ && "$SITE_DOMAIN" == *.* ]] ||
  fail "Invalid SITE_DOMAIN. Set only the hostname, without https://"

# The default IP.sslip.io name works without purchasing a domain, but depends
# on a third-party DNS service. Use your own A record for a stable real hostname.
echo "Planned HTTPS address: https://$SITE_DOMAIN/"
python3 scripts/prepare-gce-env.py --source backend/.env \
  --target backend/.env.gce --domain "$SITE_DOMAIN"

if ! gcloud compute firewall-rules describe "$GCP_FIREWALL" --project="$GCP_PROJECT" \
    >/dev/null 2>&1; then
  gcloud compute firewall-rules create "$GCP_FIREWALL" \
    --project="$GCP_PROJECT" --network="$GCP_NETWORK" --direction=INGRESS \
    --action=ALLOW --rules=tcp:80,tcp:443 --source-ranges=0.0.0.0/0 \
    --target-tags="$GCP_TAG" --description="HTTPS storefront only"
fi
if ! gcloud compute instances describe "$GCP_VM" --zone="$GCP_ZONE" \
    --project="$GCP_PROJECT" >/dev/null 2>&1; then
  gcloud compute instances create "$GCP_VM" --zone="$GCP_ZONE" --project="$GCP_PROJECT" \
    --machine-type="$GCP_MACHINE" --boot-disk-size=80GB --boot-disk-type=pd-balanced \
    --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
    --network="$GCP_NETWORK" --address="$IP" --tags="$GCP_TAG" \
    --no-service-account --no-scopes
else
  echo "Reusing the existing VM. Refusing to change its machine, disk, network or firewall settings."
  LIVE_IP="$(gcloud compute instances describe "$GCP_VM" --zone="$GCP_ZONE" \
    --project="$GCP_PROJECT" --format='value(networkInterfaces[0].accessConfigs[0].natIP)')"
  [[ "$LIVE_IP" == "$IP" ]] ||
    fail "The existing VM uses IP $LIVE_IP, not $IP. Refusing to deploy to the wrong VM."
fi

echo "Installing Docker and updating the remote main branch."
gcloud compute scp scripts/bootstrap-gce-vm.sh "$GCP_VM:bootstrap-gce-vm.sh" \
  --zone="$GCP_ZONE" --project="$GCP_PROJECT"
gcloud compute ssh "$GCP_VM" --zone="$GCP_ZONE" --project="$GCP_PROJECT" \
  --command="bash ~/bootstrap-gce-vm.sh"

echo "Uploading the private env over SSH (never to GitHub or VM metadata)."
gcloud compute scp backend/.env.gce "$GCP_VM:nothing-gce.env.incoming" \
  --zone="$GCP_ZONE" --project="$GCP_PROJECT"

gcloud compute ssh "$GCP_VM" --zone="$GCP_ZONE" --project="$GCP_PROJECT" \
  --command="set -e; install -m 600 ~/nothing-gce.env.incoming ~/nothing-marketplace/backend/.env; rm -f ~/nothing-gce.env.incoming; cd ~/nothing-marketplace; sudo docker compose -f backend/compose.gce.yml --env-file backend/.env config --quiet; sudo docker compose -f backend/compose.gce.yml --env-file backend/.env up -d --build; sudo docker compose -f backend/compose.gce.yml --env-file backend/.env ps"

echo "Checking real HTTPS readiness (Caddy may need public ACME DNS verification)."
for attempt in $(seq 1 24); do
  if curl -fsS --connect-timeout 4 --max-time 12 "https://$SITE_DOMAIN/api/store/offers" \
    >/dev/null 2>&1; then
    echo "HTTPS deployment verified: https://$SITE_DOMAIN/"
    echo "Check catalog: https://$SITE_DOMAIN/api/store/catalog"
    exit 0
  fi
  sleep 10
done
echo "Containers were started but public HTTPS verification is not yet passing."
echo "Check your A record if using a custom domain, Google firewall ports 80/443, and Caddy logs."
echo "VM name: $GCP_VM  zone: $GCP_ZONE  static IP: $IP"
exit 1
