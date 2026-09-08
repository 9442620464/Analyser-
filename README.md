# StoreBuddy AI — production-oriented SaaS foundation

This folder converts the supplied static StoreBuddy command-center dashboard into a server-backed, multi-tenant SaaS foundation. The existing visual dashboard is preserved as `public/dashboard.html` and now sits behind authentication and API endpoints.

## Included

- Multi-tenant PostgreSQL schema with users, memberships, stores, connections, metrics, insights, alert settings, and sync runs.
- Secure HTTP-only cookie authentication for the initial SaaS surface.
- Server-side OpenAI integration using the Responses API and strict structured JSON output for insight generation.
- WooCommerce REST integration with encrypted server-side credential storage and webhook verification.
- Google OAuth foundation plus GA4 Data API and Google Ads API adapters.
- Meta OAuth foundation plus Ads Insights adapter.
- Fifteen-minute WooCommerce sync scheduler and sync audit records.
- Dockerfile + PostgreSQL docker-compose for local/staging bootstrapping.
- `.env.example` with all required server-side configuration points.

## Local setup

1. Copy `.env.example` to `.env` and set a real `JWT_SECRET`, `DATABASE_URL`, and `CONNECTION_ENCRYPTION_KEY`.
2. Complete the secure OpenAI API key setup in ChatGPT, then place the resulting key in the server environment as `OPENAI_API_KEY`. Never place an OpenAI secret in browser JavaScript.
3. Start PostgreSQL with `docker compose up -d postgres`.
4. Run `npm install`, `npm run db:push`, and `npm run db:seed`.
5. Start with `npm run dev`.
6. Open `http://localhost:3000/login`.

## Go-live sequence

Use managed PostgreSQL and Redis/queue infrastructure, put the Node app behind HTTPS, set strong secrets in the hosting platform, configure OAuth redirect URLs for the production domain, register WooCommerce webhook delivery URLs, and run database migrations as part of deployment.

## Integration notes

WooCommerce is implemented end-to-end at the credential and sync layer. Google and Meta require provider-side app configuration and approval/permissions before customer OAuth can be completed. The SaaS must keep provider refresh/access tokens encrypted at rest and only decrypt them in server-side integration code.
