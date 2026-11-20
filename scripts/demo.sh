#!/usr/bin/env bash
set -euo pipefail
API=${API:-http://localhost:8080/api}
EMAIL="customer-$(date +%s)@example.com"
echo 'Register...'
curl -fsS -X POST "$API/auth/register" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"DemoPassword1234!\"}"; echo
TOKEN=$(curl -fsS -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"DemoPassword1234!\"}" | python -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
echo 'OpenSearch query (initial indexing may take time):'
curl -fsS "$API/search?q=watermelan&city=Bengaluru&category=Energy%20Drinks"; echo
PRODUCT=$(curl -fsS "$API/products?size=100" | python -c 'import json,sys;print(next(x["id"] for x in json.load(sys.stdin)["items"] if x["sku"]=="ENERGY-ORIGINAL"))')
curl -fsS -X POST "$API/cart/items" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"product_id\":\"$PRODUCT\",\"city\":\"Bengaluru\",\"quantity\":1}"; echo
echo 'Checkout:'
curl -fsS -X POST "$API/orders/checkout" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H "Idempotency-Key: demo-$(date +%s)-$$" -d '{"city":"Bengaluru"}'; echo

echo 'Orders for this user:'
curl -fsS "$API/orders" -H "Authorization: Bearer $TOKEN";echo
echo 'PostgreSQL outbox and worker status:'
docker compose exec -T postgres psql -U store -d store -c "SELECT event_type, COUNT(*) total,COUNT(published_at) published FROM outbox GROUP BY event_type ORDER BY event_type;"
