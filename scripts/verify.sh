#!/usr/bin/env bash
set -euo pipefail
BASE="${API:-http://localhost:8080/api}"
CURL=(curl --fail-with-body --silent --show-error --max-time 15)
echo '[1/10] API readiness and Postgres'
"${CURL[@]}" "$BASE/health/ready"; echo
echo '[2/10] Catalog (PostgreSQL)'
"${CURL[@]}" "$BASE/products?size=20" | python3 -c 'import json,sys;d=json.load(sys.stdin); print([(x["sku"], x["price"]) for x in d["items"]]); assert len([x for x in d["items"] if x["sku"].startswith("ENERGY-")])==6'
echo '[3/10] Search (OpenSearch)'
for attempt in {1..20}; do
  if "${CURL[@]}" "$BASE/search?q=watermelan&city=Bengaluru&category=Energy%20Drinks" | python3 -c 'import json,sys;d=json.load(sys.stdin); print("matches:",[(x["name"],x["price"]) for x in d["items"]]);assert any("Red Edition"==x["name"] for x in d["items"])' 2>/dev/null;then break;fi
  if [ "$attempt" = 20 ]; then echo 'ERROR: OpenSearch did not index Red Edition';exit 1;fi
  sleep 3
done
echo '[3b/10] Search substring '"'"'free'"'"' must match Sugar Free in OpenSearch'
for attempt in {1..12}; do
  if "${CURL[@]}" "$BASE/search?q=free&city=Bengaluru&category=Energy%20Drinks" | python3 -c 'import json,sys;d=json.load(sys.stdin);assert any(x["name"]=="Sugar Free" for x in d["items"]); print("PASS: free → Sugar Free")' 2>/dev/null; then break; fi
  if [ "$attempt" = 12 ]; then echo 'ERROR: query free did not return Sugar Free'; echo 'Run: docker compose exec -T api python -m scripts.reindex';exit 1;fi
  sleep 2
done
echo '[3c/10] OpenSearch health report'
"${CURL[@]}" "$BASE/health/search";echo
echo '[4/10] Prometheus endpoint' 
"${CURL[@]}" "$BASE/metrics" | python3 -c 'import sys; s=sys.stdin.read(); assert "store_http_requests_total" in s; print("HTTP metrics OK")'
echo '[5/10] Kafka topic'; docker compose exec -T kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:29092 --describe --topic store.events
echo '[6/10] RabbitMQ queue'; docker compose exec -T rabbitmq rabbitmqctl list_queues name messages consumers | grep 'order.confirmations'
echo '[7/10] Grafana API'; curl -fsS http://localhost:3001/api/health;echo
echo '[8/10] Prometheus API'; curl -fsS 'http://localhost:9090/api/v1/query?query=up' | python3 -c 'import json,sys;d=json.load(sys.stdin);assert d["status"]=="success";print("prometheus query OK")'
echo '[9/10] Demonstrate register → cart → checkout → order verification'
export API="$BASE";bash scripts/demo.sh
echo '[10/10] Inspect publisher, consumer and notifier logs for committed events'
echo '  docker compose logs --tail=50 outbox consumer notifications'
echo 'All executable smoke checks passed. This does NOT verify hosted Aiven, payments, or production-level failover.'
