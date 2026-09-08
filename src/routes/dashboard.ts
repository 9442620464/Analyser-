import { Router } from 'express';
import { requireAuth, tenantId } from '../lib/auth.js';
import { dashboardForTenant, generateAiInsights, syncWooCommerce } from '../services/dashboard.js';
import { prisma } from '../lib/prisma.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/', async (_req, res) => res.json(await dashboardForTenant(tenantId(res))));

dashboardRouter.post('/sync/woocommerce', async (_req, res) => {
  try { res.json(await syncWooCommerce(tenantId(res))); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : String(error) }); }
});

dashboardRouter.post('/insights/generate', async (_req, res) => {
  try { res.json({ insights: await generateAiInsights(tenantId(res)) }); }
  catch (error) { res.status(502).json({ error: error instanceof Error ? error.message : String(error) }); }
});

dashboardRouter.post('/insights/:id/dismiss', async (req, res) => {
  const updated = await prisma.insight.updateMany({ where: { id: req.params.id, tenantId: tenantId(res) }, data: { dismissedAt: new Date() } });
  res.json({ ok: updated.count === 1 });
});
