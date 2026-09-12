import { Router } from 'express';
import { verifyWooWebhook } from '../integrations/woocommerce.js';
import { verifyWhatsAppSignature, verifyWebhookChallenge, parseInboundMessages, sendWhatsAppText } from '../integrations/whatsapp.js';
import { getWhatsAppConfig, getPricingConfig } from '../lib/platformSettings.js';
import { dashboardForTenant } from '../services/dashboard.js';
import { answerStoreQuestion } from '../services/openai.js';
import { prisma } from '../lib/prisma.js';

export const webhookRouter = Router();

// --- WhatsApp: subscription handshake + inbound message Q&A ---
// Meta's webhook for the shared Business number is registered against THIS app's public URL,
// not the admin app -- the admin app only edits the credentials, this app uses them to talk to
// merchants. Credentials are read from PlatformSetting, a table owned/migrated by the admin repo
// but shared via the same database.
webhookRouter.get('/whatsapp', async (req, res) => {
  const config = await getWhatsAppConfig();
  if (!config) return res.status(404).end();
  const challenge = verifyWebhookChallenge(req.query as Record<string, string>, config.webhookVerifyToken);
  if (challenge === null) return res.status(403).end();
  res.status(200).send(challenge);
});

webhookRouter.post('/whatsapp', async (req, res) => {
  const config = await getWhatsAppConfig();
  if (!config) return res.status(404).end();
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  if (!verifyWhatsAppSignature(raw, req.header('X-Hub-Signature-256'), config.appSecret)) return res.status(401).end();

  res.status(200).end(); // ack immediately; Meta expects a fast 200 regardless of downstream work
  const payload = JSON.parse(raw.toString('utf8'));
  for (const msg of parseInboundMessages(payload)) {
    try {
      const recipient = await prisma.whatsAppRecipient.findUnique({ where: { phoneNumber: msg.from } });
      if (!recipient) continue; // unknown number -- not a recognized merchant contact
      await prisma.whatsAppMessage.create({ data: { tenantId: recipient.tenantId, direction: 'INBOUND', type: 'QA', toNumber: msg.from, body: msg.text, status: 'DELIVERED', providerMessageId: msg.messageId } });

      const data = await dashboardForTenant(recipient.tenantId);
      const answer = await answerStoreQuestion(recipient.tenantId, msg.text, { tenant: data.tenant, metrics: data.metrics, insights: data.insights });
      const pricing = await getPricingConfig();
      const sent = await sendWhatsAppText(config, msg.from, answer);
      await prisma.whatsAppMessage.create({ data: { tenantId: recipient.tenantId, direction: 'OUTBOUND', type: 'QA', toNumber: msg.from, body: answer, status: 'SENT', providerMessageId: sent.providerMessageId, estimatedCostUsd: pricing.whatsappPerConversationUsd } });
    } catch (e) {
      console.error('WhatsApp inbound handling error:', e);
    }
  }
});

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
