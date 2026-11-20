#!/usr/bin/env bash
set -euo pipefail
API=${API:-http://localhost:8000}
EMAIL="customer-$(date +%s)@example.com"
echo 'Register...'
curl -fsS -X POST "$API/auth/register" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"DemoPassword1234!\"}"; echo
TOKEN=$(curl -fsS -X POST "$API/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"DemoPassword1234!\"}" | python -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
echo 'OpenSearch query (initial indexing may take time):'
curl -fsS "$API/search?q=mocha&city=Bengaluru"; echo
PRODUCT=$(curl -fsS "$API/products?size=1" | python -c 'import json,sys;print(json.load(sys.stdin)["items"][0]["id"])')
curl -fsS -X POST "$API/cart/items" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"product_id\":\"$PRODUCT\",\"city\":\"Bengaluru\",\"quantity\":1}"; echo
echo 'Checkout:'
curl -fsS -X POST "$API/orders/checkout" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -H "Idempotency-Key: demo-$(date +%s)-$$" -d '{"city":"Bengaluru"}'; echo
