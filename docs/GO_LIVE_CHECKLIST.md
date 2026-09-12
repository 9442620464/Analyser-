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

## WhatsApp Q&A webhook (this repo)

This app answers inbound WhatsApp messages using the shared Business API credentials configured
in `storebuddy-admin`. Notes specific to what runs here:

- **AI/WhatsApp cost figures are estimates, not billing truth.** They're computed from pricing
  rates set in `storebuddy-admin` → Pricing (both default to $0), multiplied by actual token
  counts / message counts this app logs. Keep those rates in sync with your real OpenAI and
  Meta invoices, or the cost totals over there will read low/zero.
- **WhatsApp conversation-based billing is approximated**: Meta charges per 24-hour conversation
  window, not per message, and the rate varies by country/category. This build logs the
  configured per-conversation rate against every outbound Q&A reply rather than only the first
  message in a window — treat it as a rough estimate, not an exact cost.
- **Not yet built**: a merchant-facing UI to register their own WhatsApp number (`WhatsAppRecipient`
  rows must be added directly to the database for now); rate limiting/abuse protection on the
  WhatsApp Q&A webhook (a flood of inbound messages triggers a matching flood of paid OpenAI +
  WhatsApp sends).
- The pre-existing WooCommerce webhook signature issue (secret is read from a client-supplied
  header rather than one stored server-side) is still open — see prior notes. Worth fixing
  before relying on that webhook for anything security-sensitive.

## Platform admin panel

Moved to the separate `storebuddy-admin` repo — tenant list, Stripe billing sync, WhatsApp
Business API credential management, and AI/WhatsApp cost/pricing settings all live there now.
See that repo's own `docs/GO_LIVE_CHECKLIST.md`.
