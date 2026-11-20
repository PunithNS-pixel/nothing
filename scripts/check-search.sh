#!/usr/bin/env bash
# Nothing Energy: diagnose browser 502 vs API 503 and OpenSearch index failures.
set -u
cd "$(dirname "$0")/.."
printf '\n=== Containers and services ===\n'
docker compose ps || { echo "Docker Compose is not running for this project"; exit 1; }
probe() {
  local title="$1" url="$2" status file
  file="$(mktemp)"
  status="$(curl --silent --show-error --max-time 12 -o "$file" -w '%{http_code}' "$url" 2>/dev/null || true)"
  printf '%-32s HTTP %s\n' "$title" "${status:-000}"
  if [[ "$status" != 200 ]]; then
    printf 'Response: '; head -c 280 "$file"; printf '\n'
  fi
  rm -f "$file"
  printf '%s' "$status"
}
printf '\n=== Routing and search ===\n'
gateway="$(probe 'Nginx gateway health' 'http://localhost:8080/api/health/ready')"
direct="$(probe 'Direct API health' 'http://localhost:8000/health/ready')"
cluster="$(probe 'Direct OpenSearch cluster' 'http://localhost:9200/_cluster/health')"
search="$(probe 'Search free through gateway' 'http://localhost:8080/api/search?q=free&city=Bengaluru')"
printf '\n=== Diagnosis ===\n'
if [[ "$gateway" == 502 && "$direct" == 200 ]]; then
  echo "Gateway cannot reliably reach API. Pull the new Nginx fix and restart gateway: docker compose up -d --force-recreate gateway"
elif [[ "$direct" != 200 ]]; then
  echo "Direct API is unavailable. Inspect: docker compose logs --tail=150 api migrate"
elif [[ "$search" != 200 && "$cluster" != 200 ]]; then
  echo "OpenSearch is down/unreachable; check memory and disk: docker compose logs --tail=150 opensearch"
elif [[ "$search" != 200 ]]; then
  echo "API is up but search failed: docker compose logs --tail=150 api opensearch consumer"
  echo "After OpenSearch is healthy: docker compose exec -T api python -m scripts.reindex"
else
  echo "Gateway, API and search responded 200. Confirm Sugar Free in the results:"
  curl -fsSG http://localhost:8080/api/search --data-urlencode 'q=free' --data-urlencode 'city=Bengaluru' | python3 -m json.tool
fi
if [[ "$gateway" != 200 || "$direct" != 200 || "$cluster" != 200 || "$search" != 200 ]]; then exit 1; fi
