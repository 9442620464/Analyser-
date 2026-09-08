import { Router } from 'express';
import { requireAuth, tenantId } from '../lib/auth.js';
import { encryptJson } from '../lib/crypto.js';
import { prisma } from '../lib/prisma.js';
import { googleAuthUrl, exchangeGoogleCode } from '../integrations/google.js';
import { metaAuthUrl, exchangeMetaCode } from '../integrations/meta.js';
import { wooAuthorizeUrl } from '../integrations/woocommerce.js';
import { env } from '../config/env.js';
import jwt from 'jsonwebtoken';

export const connectionsRouter = Router();
connectionsRouter.use(requireAuth);

connectionsRouter.get('/', async (_req, res) => {
  const rows = await prisma.connection.findMany({ where: { tenantId: tenantId(res) }, select: { id: true, provider: true, status: true, displayName: true, externalId: true, scopes: true, lastSyncedAt: true, lastError: true } });
  res.json(rows);
});

// One-click WooCommerce connect: redirect the store owner to their own wp-admin, where a single
// "Approve" button generates and sends back API credentials. No copy-pasting of keys required.
connectionsRouter.get('/woocommerce/start', (req, res) => {
  const raw = String(req.query.baseUrl || '');
  let url;
  try { url = new URL(raw); } catch { return res.status(400).json({ error: 'Enter your store address, e.g. https://yourstore.com' }); }
  if (!/^https?:$/.test(url.protocol)) return res.status(400).json({ error: 'Store address must start with http:// or https://' });
  const state = jwt.sign({ tenantId: tenantId(res), baseUrl: url.origin }, env.JWT_SECRET, { expiresIn: '15m' });
  res.redirect(wooAuthorizeUrl(url.origin, {
    appName: 'StoreBuddy AI',
    userId: state,
    returnUrl: `${env.APP_URL}/dashboard?woocommerce=pending`,
    callbackUrl: `${env.APP_URL}/api/connections/woocommerce/callback`,
    scope: 'read'
  }));
});

// Fallback for stores that block /wc-auth/ (e.g. some security plugins) or aren't reachable
// for the server-to-server callback above. Requires manually generated API keys.
connectionsRouter.post('/woocommerce/manual', async (req, res) => {
  const { baseUrl, consumerKey, consumerSecret, displayName } = req.body ?? {};
  let url;
  try { url = new URL(String(baseUrl)); } catch { return res.status(400).json({ error: 'Enter a valid store URL.' }); }
  if (!/^https?:$/.test(url.protocol)) return res.status(400).json({ error: 'WooCommerce URL must use HTTPS (HTTP is allowed only for local development).' });
  const row = await prisma.connection.upsert({
    where: { tenantId_provider: { tenantId: tenantId(res), provider: 'WOOCOMMERCE' } },
    create: { tenantId: tenantId(res), provider: 'WOOCOMMERCE', displayName: displayName || url.hostname, status: 'CONNECTED', encryptedData: encryptJson({ baseUrl: url.origin, consumerKey, consumerSecret }) },
    update: { displayName: displayName || url.hostname, status: 'CONNECTED', encryptedData: encryptJson({ baseUrl: url.origin, consumerKey, consumerSecret }) }
  });
  res.json({ id: row.id, provider: row.provider, status: row.status, displayName: row.displayName });
});

connectionsRouter.get('/google/start', (_req, res) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_REDIRECT_URI) return res.status(503).json({ error: 'Google OAuth is not configured.' });
  const state = jwt.sign({ tenantId: tenantId(res), provider: 'google' }, env.JWT_SECRET, { expiresIn: '10m' });
  res.redirect(googleAuthUrl(env.GOOGLE_CLIENT_ID, env.GOOGLE_REDIRECT_URI, state));
});

connectionsRouter.get('/meta/start', (_req, res) => {
  if (!env.META_APP_ID || !env.META_REDIRECT_URI) return res.status(503).json({ error: 'Meta OAuth is not configured.' });
  const state = jwt.sign({ tenantId: tenantId(res), provider: 'meta' }, env.JWT_SECRET, { expiresIn: '10m' });
  res.redirect(metaAuthUrl(env.META_APP_ID, env.META_REDIRECT_URI, state));
});


export async function googleCallback(code: string, state: string) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) throw new Error('Google OAuth is not configured.');
  const claims = jwt.verify(state, env.JWT_SECRET) as { tenantId: string; provider: string };
  const token = await exchangeGoogleCode(code, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
  return { tenantId: claims.tenantId, token };
}

export async function metaCallback(code: string, state: string) {
  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_REDIRECT_URI) throw new Error('Meta OAuth is not configured.');
  const claims = jwt.verify(state, env.JWT_SECRET) as { tenantId: string; provider: string };
  const token = await exchangeMetaCode(code, env.META_APP_ID, env.META_APP_SECRET, env.META_REDIRECT_URI);
  return { tenantId: claims.tenantId, token };
}

// WooCommerce POSTs the generated key/secret here directly from the store (server-to-server),
// not from the store owner's browser, so this must not require our own session cookie.
export async function wooCommerceCallback(body: { user_id?: string; consumer_key?: string; consumer_secret?: string; key_permissions?: string }) {
  const { user_id, consumer_key, consumer_secret } = body ?? {};
  if (!user_id || !consumer_key || !consumer_secret) throw new Error('Incomplete WooCommerce authorization payload.');
  const claims = jwt.verify(user_id, env.JWT_SECRET) as { tenantId: string; baseUrl: string };
  await prisma.connection.upsert({
    where: { tenantId_provider: { tenantId: claims.tenantId, provider: 'WOOCOMMERCE' } },
    create: { tenantId: claims.tenantId, provider: 'WOOCOMMERCE', displayName: new URL(claims.baseUrl).hostname, status: 'CONNECTED', encryptedData: encryptJson({ baseUrl: claims.baseUrl, consumerKey: consumer_key, consumerSecret: consumer_secret }) },
    update: { status: 'CONNECTED', lastError: null, encryptedData: encryptJson({ baseUrl: claims.baseUrl, consumerKey: consumer_key, consumerSecret: consumer_secret }) }
  });
  return { tenantId: claims.tenantId };
}
