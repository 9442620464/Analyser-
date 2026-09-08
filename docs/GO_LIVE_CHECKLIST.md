# StoreBuddy AI go-live checklist

The codebase is now server-backed, but production activation still needs third-party credentials and platform-side configuration.

## Required secrets

- OpenAI API key
- PostgreSQL connection string
- 32-byte base64 encryption key
- Strong JWT secret
- Google OAuth client ID/secret
- Google Ads developer token
- Meta App ID/secret

## Provider setup

### WooCommerce
Create a REST API key with the least privilege required. StoreBuddy uses the v3 REST API. Configure WooCommerce webhooks for order/product/customer events to the StoreBuddy webhook URL and use a separate signing secret.

### Google Analytics 4
Create a Google Cloud project, enable the Analytics Data API, create OAuth credentials, and request only the read scopes needed. Store the selected GA4 property ID per tenant.

### Google Ads
Complete Google Ads API access, OAuth, and developer-token setup. Store each customer's 10-digit client customer ID per tenant. Current production endpoint in the adapter is Google Ads API v25; keep the version configurable and review Google's release/sunset schedule during upgrades.

### Meta Ads
Create/configure a Meta app, request the required Marketing API permissions, complete OAuth, and store the tenant's ad-account ID. The Insights adapter is server-side.

## Security before public launch

Use HTTPS everywhere, managed secrets, a production identity provider, email verification and password recovery, rate limits, CSRF protection for cookie-authenticated mutations, encrypted refresh tokens, audit logs, idempotent webhooks, retries with exponential backoff, durable background jobs, tenant-level authorization tests, and automated database backups.

## UI/data completeness

The supplied dashboard layout contains many static demo charts/tables. The new server endpoints establish the real data layer, but each visual needs a dedicated normalized metric endpoint before the dashboard can claim every number is live. Do not present demo values as live production data.
