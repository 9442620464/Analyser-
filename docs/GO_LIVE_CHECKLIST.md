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

## Admin panel (/admin)

A separate platform-operator panel, independent of the merchant-facing dashboard, at `/admin` (login at `/admin/login`). Covers tenants, plan/revenue (via Stripe), AI token cost, and WhatsApp cost. To bring it fully live:

- **Create your own admin login**: set `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` in `.env` and run `npm run db:seed`. This account is separate from merchant accounts (`isPlatformAdmin` on `User`) and isn't tied to any single tenant.
- **Stripe**: set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_STARTER`/`_GROWTH`/`_PRO` (your actual Price IDs). Point a Stripe webhook at `POST /api/webhooks/stripe` for `checkout.session.completed`, `customer.subscription.*`, and `invoice.paid`. The webhook handler expects `client_reference_id` or `metadata.tenantId` on the Checkout Session / Subscription to know which tenant a payment belongs to — set one of those when you create the Checkout Session, otherwise it falls back to matching on `stripeCustomerId` already stored on the tenant, which is chicken-and-egg for the very first payment.
- **WhatsApp Business API**: configure once at `/admin` → WhatsApp (Business Account ID, Phone Number ID, Access Token, App Secret, Webhook Verify Token). Point Meta's webhook subscription at `GET/POST /api/webhooks/whatsapp` using the same verify token. This is one shared platform number for all merchants — StoreBuddy tells tenants apart by matching the sender's phone number against `WhatsAppRecipient`, so a merchant's number needs to be added there (no UI for that yet — add rows directly for now, or build a small "add a WhatsApp number" merchant-side settings field next).
- **AI/WhatsApp cost figures are estimates, not billing truth.** They're computed from `Admin → Pricing` rates you set yourself (both default to $0), multiplied by actual token counts / message counts StoreBuddy already logs. Keep those rates in sync with your real OpenAI and Meta invoices, or the cost totals will read low/zero.
- **WhatsApp conversation-based billing is approximated**: Meta charges per 24-hour conversation window, not per message, and the rate varies by country/category. This build logs the configured per-conversation rate against every outbound Q&A reply rather than only the first message in a window — treat it as a rough estimate, not an exact cost.
- **Not yet built**: a merchant-facing UI to register their own WhatsApp number; a Checkout flow (this build assumes you already send merchants to Stripe Checkout elsewhere and only consumes the resulting webhooks); rate limiting/abuse protection on the WhatsApp Q&A webhook (a flood of inbound messages will trigger a matching flood of paid OpenAI + WhatsApp sends).
- The pre-existing WooCommerce webhook signature issue (secret is read from a client-supplied header rather than one stored server-side) is still open — see prior notes. Worth fixing before relying on that webhook for anything security-sensitive.
