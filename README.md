# StoreBuddy AI — merchant app (storebuddy-user)

The merchant-facing half of StoreBuddy AI: login, dashboard, and data-source connections
(WooCommerce, Google Analytics + Ads, Meta Ads), plus the WhatsApp Q&A webhook that answers a
merchant's questions about their own store.

**This is one of two repos.** The platform-operator panel (tenant list, Stripe billing sync,
WhatsApp Business API credentials, AI/WhatsApp cost tracking) lives in a separate repo,
`storebuddy-admin`. Both repos connect to the **same PostgreSQL database** — this repo's
`prisma/schema.prisma` is a hand-kept mirror of the one in `storebuddy-admin`, which owns
migrations. See the schema file's header comment before touching it.

## Included here

- Multi-tenant auth (email/password, HTTP-only cookie sessions) for merchant accounts only —
  no platform-admin concept in this app at all.
- Dashboard API + the existing visual dashboard (`public/dashboard.html`).
- WooCommerce one-click connect (`/wc-auth/v1/authorize`) with a manual API-key fallback,
  encrypted credential storage, and a 15-minute sync scheduler.
- Google OAuth + GA4/Google Ads adapters, Meta OAuth + Ads Insights adapter.
- WhatsApp inbound Q&A webhook: reads the shared Business API credentials (entered via the
  admin app, stored encrypted in the shared `PlatformSetting` table), matches an inbound
  sender's number to a tenant, answers using that tenant's own dashboard data via OpenAI, and
  logs both directions plus estimated cost to `WhatsAppMessage`.

## Local setup

1. Start `storebuddy-admin` first — it owns the shared Postgres container and runs migrations.
2. Copy `.env.example` to `.env`. `DATABASE_URL` and `CONNECTION_ENCRYPTION_KEY` **must match**
   the values in `storebuddy-admin`'s `.env` exactly (same database, same encryption key for
   the WhatsApp credentials this app decrypts).
3. `npm install && npm run db:generate && npm run db:seed`
4. `npm run dev`, then open `http://localhost:3000/login`.

## What points where

- WooCommerce webhooks (per-merchant store events): this app's `/api/webhooks/woocommerce/:tenantId`.
- WhatsApp webhook (Meta's subscription, inbound merchant Q&A): this app's `/api/webhooks/whatsapp`.
- Google/Meta OAuth redirect URIs: this app's `/api/connections/{google,meta}/callback`.
- Stripe webhook and billing sync: **not here** — see `storebuddy-admin`.
