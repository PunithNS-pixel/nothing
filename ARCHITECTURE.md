# Nothing Energy System Architecture

```
Updated Energy browser UI (five editions + separately stocked mix)
  → Nginx same-origin /api FastAPI, rate-limited auth
    → Argon2/JWT and admin role guard
    → PostgreSQL: users / carts / products / city stock / orders / audit / outbox
         checkout with row locks + ACID stock & orders + idempotency
         outbox worker sends committed event → Kafka topic store.events
         Kafka consumer → OpenSearch index updates
                        → RabbitMQ durable order.confirmations queue
                             → notifier (logs only, not email)
    → OpenSearch: fuzzy search with category, price, city filters
    → Prometheus: REST request counter/latency → Grafana dashboard
    → Terraform Aiven service provisioning skeleton
```

**Consistency:** every transaction writes order, order-item price snapshots, stock reductions, outbox events and audit log atomically; rollbacks undo all changes. `SELECT FOR UPDATE` locks prevent overselling of the final unit. Eventual consistency is expected for search. The separate mixed-pack SKU has its own inventory and does not consume component SKUs.

**Key tables:** `users`, `refresh_tokens`, `products`, `inventory`, `cart_items`, `orders`, `order_items`, `outbox`, `processed_events`, `audit_logs`, `newsletter_subscribers`.

**Control:** admin `/admin/users`, `/admin/orders`, `/admin/summary`, `/admin/audit`, `/admin/products/{id}`, `/admin/products/{id}/stock`, `/admin/orders/{id}/fulfillment`; all backend role-guarded.

**Failure modes:** Kafka offline → outbox queues; consumer repeats event → processed event IDs deduplicate reindex operations and queue publishes; OpenSearch offline → search 503 until recovered; RabbitMQ offline → consumer retries; database offline → checkout error, not a fake local order. Not a distributed exactly-once transaction. Production requires DB failover, backups, observability and reconciliation.
