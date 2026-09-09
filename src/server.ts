import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import cron from 'node-cron';
import { env } from './config/env.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { connectionsRouter, googleCallback, metaCallback, wooCommerceCallback } from './routes/connections.js';
import { webhookRouter } from './routes/webhooks.js';
import { adminRouter } from './routes/admin.js';
import { prisma } from './lib/prisma.js';
import { requireAuth, requirePlatformAdmin, tenantId } from './lib/auth.js';
import { syncWooCommerce } from './services/dashboard.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(pinoHttp());
app.use(cookieParser());
app.use('/api/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.get('/health', async (_req, res) => {
  try { await prisma.$queryRaw`SELECT 1`; res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});
app.use('/api/auth', authRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/connections', connectionsRouter);
app.get('/api/connections/google/callback', async (req, res) => { try { const r=await googleCallback(String(req.query.code||''), String(req.query.state||'')); await Promise.all((['GA4','GOOGLE_ADS'] as const).map(provider=>prisma.connection.upsert({where:{tenantId_provider:{tenantId:r.tenantId,provider}},create:{tenantId:r.tenantId,provider,displayName:provider==='GA4'?'Google Analytics 4':'Google Ads',status:'CONNECTED',encryptedData:JSON.stringify(r.token)},update:{status:'CONNECTED',encryptedData:JSON.stringify(r.token),lastError:null}}))); res.redirect('/dashboard'); } catch(e){ res.status(400).send(`<h1>Google connection failed</h1><pre>${String(e)}</pre>`); }});
app.get('/api/connections/meta/callback', async (req, res) => { try { const r=await metaCallback(String(req.query.code||''), String(req.query.state||'')); await prisma.connection.upsert({where:{tenantId_provider:{tenantId:r.tenantId,provider:'META_ADS'}},create:{tenantId:r.tenantId,provider:'META_ADS',displayName:'Meta Ads',status:'CONNECTED',encryptedData:JSON.stringify(r.token)},update:{status:'CONNECTED',encryptedData:JSON.stringify(r.token),lastError:null}}); res.redirect('/dashboard'); } catch(e){ res.status(400).send(`<h1>Meta connection failed</h1><pre>${String(e)}</pre>`); }});
// Called directly by the merchant's WooCommerce store (server-to-server), not by their browser.
app.post('/api/connections/woocommerce/callback', async (req, res) => { try { await wooCommerceCallback(req.body ?? {}); res.status(200).json({ ok: true }); } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : String(e) }); } });
app.use('/api/webhooks', webhookRouter);
app.use('/api/admin', adminRouter);

app.get('/api/me', requireAuth, async (_req, res) => {
  const user = await prisma.user.findUnique({ where: { id: res.locals.auth.userId }, select: { id: true, email: true, name: true } });
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId(res) } });
  res.json({ user, tenant });
});

app.get('/login', (_req, res) => res.sendFile(path.join(process.cwd(), 'public', 'login.html')));
app.get('/dashboard', requireAuth, (_req, res) => res.sendFile(path.join(process.cwd(), 'public', 'dashboard.html')));
app.get('/admin/login', (_req, res) => res.sendFile(path.join(process.cwd(), 'public', 'admin-login.html')));
app.get('/admin', requirePlatformAdmin, (_req, res) => res.sendFile(path.join(process.cwd(), 'public', 'admin.html')));
app.get('/', (_req, res) => res.redirect('/dashboard'));
app.use(express.static(path.join(process.cwd(), 'public'), { index: false }));

cron.schedule('*/15 * * * *', async () => {
  const tenants = await prisma.tenant.findMany({ select: { id: true }, where: { connections: { some: { provider: 'WOOCOMMERCE', status: { in: ['CONNECTED', 'NEEDS_ATTENTION'] } } } } });
  for (const tenant of tenants) {
    try { await syncWooCommerce(tenant.id); } catch { /* status/error already recorded */ }
  }
});

const server = app.listen(env.PORT, () => console.log(`StoreBuddy server listening on ${env.APP_URL}`));

async function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down.`);
  server.close(async () => { await prisma.$disconnect(); process.exit(0); });
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
