# Public launch readiness checklist

This project is **not approved for public paid orders**. Complete and independently verify each area before a production launch.

- [ ] Use licensed/approved coffee imagery and confirm all ingredient, caffeine, medical, commercial and food-label claims with appropriate experts.
- [ ] Add a PCI-compliant payment provider (server-side order/payment state machine, signed webhook verification, payment confirmation, refunds, reconciliation, dispute handling and idempotency).
- [ ] Add shipping addresses, delivery serviceability, shipping rates, taxes, order cancellation, returns and customer notifications.
- [ ] Replace sessionStorage auth with an HttpOnly Secure SameSite cookie/BFF session. Add CSRF protections, MFA/password resets/email verification and login abuse controls.
- [ ] Put gateway behind HTTPS with correct proxy trusted-host handling, TLS/HSTS, CSP and WAF. Restrict admin routes and observability access to internal networks.
- [ ] Move secrets to secret management. Use unique per-environment credentials, rotate secrets, and do not share local RabbitMQ/PostgreSQL credentials with production.
- [ ] Provision managed Aiven PostgreSQL, Kafka and OpenSearch with TLS and least-privilege users. Verify actual service plan quotas, connection limits, storage/retention and regional settings.
- [ ] Use production HA/scaling infrastructure for API, event workers, message brokers, observability and ingress; design outbox row claiming if adding publisher replicas.
- [ ] Configure PITR/backups, restoration drills, log retention, inventory reconciliation, consumer dead-letter queues/retries, lag/health alerts and a migration rollback policy.
- [ ] Add functional and load tests against a complete running Docker/Aiven environment; prove concurrent last-unit stock purchases never oversell and duplicate checkout keys do not double-charge or double-decrement.
- [ ] Add tracing, meaningful SLOs, availability alerts, long-running metrics and vulnerability scanning/SBOM/dependency pinning/image signatures.
- [ ] Add privacy notices, consent/opt-out and retention/deletion for newsletter records; protect personal information and investigate applicable Indian law and regulations.
- [ ] Validate financial/business pricing and invoicing rules; all bundled INR values are examples only.
- [ ] Add formal disaster recovery and operational runbooks, deploy-to-staging and rollback procedures, independent security review and penetration testing.

Currently integrated: live catalog, server-backed accounts, server-backed cart, atomic unpaid orders, order history, Kafka outbox, OpenSearch search, RabbitMQ queue/log sink, newsletter storage, Prometheus/Grafana dev monitoring and Terraform Aiven scaffolding.
