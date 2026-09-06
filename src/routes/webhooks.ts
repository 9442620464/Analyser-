import { Router } from 'express';
import { verifyWooWebhook } from '../integrations/woocommerce.js';
import { prisma } from '../lib/prisma.js';

export const webhookRouter = Router();

webhookRouter.post('/woocommerce/:tenantId', async (req, res) => {
  const tenantId = req.params.tenantId;
  const connection = await prisma.connection.findFirst({ where: { tenantId, provider: 'WOOCOMMERCE' } });
  const secret = req.header('X-StoreBuddy-Webhook-Secret');
  if (!connection || !secret) return res.status(404).end();
  // Production should store a dedicated webhook signing secret separately from API credentials.
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  const signature = req.header('X-WC-Webhook-Signature');
  if (!verifyWooWebhook(raw, signature, secret)) return res.status(401).json({ error: 'Invalid webhook signature' });
  res.status(202).json({ accepted: true });
});
