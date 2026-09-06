# StoreBuddy AI architecture

Browser → Express API → tenant-aware service layer → PostgreSQL
                         ↘ provider adapters (WooCommerce / GA4 / Google Ads / Meta)
                         ↘ OpenAI Responses API
                         ↘ scheduled sync worker

The browser never receives provider client secrets or the OpenAI API key. Every authenticated API request is resolved to a tenant through the membership stored in PostgreSQL.

## Data flow

1. Customer signs in.
2. Connection credentials are stored encrypted.
3. Scheduled syncs call the provider APIs server-side and write normalized daily metrics.
4. Webhooks are accepted for event-driven WooCommerce updates.
5. Dashboard APIs read only the current tenant's records.
6. AI insight generation sends normalized store metrics to OpenAI and stores structured findings.

## Production hardening still required before a public launch

- Replace the simple bootstrap login with a full identity provider / email verification / password reset flow.
- Add CSRF protection for browser state-changing endpoints if cookie auth remains same-site.
- Add rate limits and abuse controls on auth and AI endpoints.
- Add Redis/BullMQ or another durable queue for high-volume sync workloads.
- Implement refresh-token rotation and provider-specific token refreshers.
- Add encrypted webhook signing secrets as a separate credential type.
- Add background retry/backoff, idempotency keys, provider pagination, and historical backfills.
- Add billing/subscription enforcement, usage metering, audit logs, organization switching, and role-based UI controls.
