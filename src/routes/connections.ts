import { Router } from 'express';
import { requireAuth, tenantId } from '../lib/auth.js';
import { encryptJson } from '../lib/crypto.js';
import { prisma } from '../lib/prisma.js';
import { googleAuthUrl, exchangeGoogleCode } from '../integrations/google.js';
import { metaAuthUrl, exchangeMetaCode } from '../integrations/meta.js';
import { env } from '../config/env.js';
import jwt from 'jsonwebtoken';

export const connectionsRouter = Router();
connectionsRouter.use(requireAuth);

connectionsRouter.get('/', async (_req, res) => {
  const rows = await prisma.connection.findMany({ where: { tenantId: tenantId(res) }, select: { id: true, provider: true, status: true, displayName: true, externalId: true, scopes: true, lastSyncedAt: true, lastError: true } });
  res.json(rows);
});

connectionsRouter.post('/woocommerce', async (req, res) => {
  const { baseUrl, consumerKey, consumerSecret, displayName } = req.body ?? {};
  const url = new URL(String(baseUrl));
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
