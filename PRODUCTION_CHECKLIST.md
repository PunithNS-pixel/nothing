# Production Readiness — NOT YET COMPLETE

Implemented for the demo: hashed user passwords, JWT access and rotating refresh tokens, role-restricted admin APIs, database constraints, per-user carts, transactional inventory deduction, idempotent retries, durable PostgreSQL outbox, Kafka consumer with processed event IDs, OpenSearch fuzzy filtering, RabbitMQ durable queue, local Prometheus/Grafana, Terraform Aiven provisioning templates, CI contract tests, local checkout smoke script and concurrency test script.

To complete **before accepting real money**: live Aiven connections and validation; payment provider and webhook idempotency; payment/stock reservation expiry; cancellation/refund/return workflow and inventory reconciliation; tax and shipping integrations; transactional email provider; email verification and password reset; public HTTPS and WAF; replace sessionStorage bearer tokens with hardened HttpOnly/BFF session and CSRF protection; secure RabbitMQ credentials and TLS; Kafka/OpenSearch production security configuration; PG backups/restore drills/HA; detailed health/lag dashboards and alerting; topic retention/partition planning; encrypted secrets management; load/concurrency tests against managed PostgreSQL; deployment/rollback automation; distributed tracing; privacy and retention practices; accessibility and responsive browser QA.

**Local Docker modes intentionally use development-only unsecured internal components.** Local tests and CI syntax/API tests are not sufficient proof of an end-to-end live deployment. Aiven Free plans provide limited resources and may not meet production-scale HA requirements.

## Retailer workflow security
- [ ] Independently verify legal name, active GSTIN and business match via official portal (manual admin review in demo). External verification provider integration and records retention require policy review.
- [ ] Enforce wholesale purchase eligibility, minimum quantity, tax invoices, GST place-of-supply rules, returns and refund treatments.
- [ ] Rotate static JWT secret into KMS, use HttpOnly/SameSite cookies and CSRF protection, secure admin MFA and immutable audit logs.
- [ ] Review GSTIN PII retention, encryption, access controls, audit notes and regulatory requirements.
- [ ] Integration-test Aiven TLS connections and monitor search index drift, Kafka lag, RabbitMQ dead-letter queues, backup restorability.

### Stripe checkout added
- [x] Hosted Checkout Session created server-side, signed webhook validation and idempotent paid/failed transitions, database stock reservation and transactional expiry release, admin/retailer price calculations, local test walkthrough
- [ ] Configure Stripe account keys and webhook secret privately, register reachable HTTPS webhook and test with real Stripe test mode (the connected environment cannot access your Stripe account)
- [ ] Implement refund/reversal/dispute handling, daily Stripe reconciliation, alerting for ambiguous failed API calls, country-specific GST/payment compliance and subscription/billing policies if needed
