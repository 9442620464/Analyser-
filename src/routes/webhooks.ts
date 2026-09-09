import { Router } from 'express';
import type Stripe from 'stripe';
import { verifyWooWebhook } from '../integrations/woocommerce.js';
import { verifyStripeWebhook, planIdForPrice } from '../integrations/stripe.js';
import { verifyWhatsAppSignature, verifyWebhookChallenge, parseInboundMessages, sendWhatsAppText } from '../integrations/whatsapp.js';
import { getWhatsAppConfig, getPricingConfig } from '../lib/platformSettings.js';
import { dashboardForTenant } from '../services/dashboard.js';
import { answerStoreQuestion } from '../services/openai.js';
import { prisma } from '../lib/prisma.js';

export const webhookRouter = Router();

// --- Stripe: source of truth for plan + revenue, per your setup. ---
async function resolveTenantForCustomer(customerId: string, metadataTenantId?: string | null) {
  if (metadataTenantId) {
    const byMeta = await prisma.tenant.findUnique({ where: { id: metadataTenantId } });
    if (byMeta) return byMeta;
  }
  return prisma.tenant.findUnique({ where: { stripeCustomerId: customerId } });
}

webhookRouter.post('/stripe', async (req, res) => {
  let event: Stripe.Event;
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
    event = verifyStripeWebhook(raw, req.header('Stripe-Signature'));
  } catch (e) {
    return res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid Stripe signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.client_reference_id || session.metadata?.tenantId;
        if (tenantId && session.customer) {
          await prisma.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId: String(session.customer), stripeSubscriptionId: session.subscription ? String(session.subscription) : undefined } });
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const tenant = await resolveTenantForCustomer(String(sub.customer), sub.metadata?.tenantId);
        if (tenant) {
          const price = sub.items.data[0]?.price;
          await prisma.tenant.update({
            where: { id: tenant.id },
            data: {
              stripeSubscriptionId: sub.id,
              subscriptionStatus: sub.status.toUpperCase() as any,
              planId: planIdForPrice(price?.id) ?? tenant.planId,
              currentPeriodEnd: sub.items.data[0] ? new Date(sub.items.data[0].current_period_end * 1000) : tenant.currentPeriodEnd,
              trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null
            }
          });
        }
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        const tenant = await resolveTenantForCustomer(String(invoice.customer), (invoice as any).subscription_details?.metadata?.tenantId);
        if (tenant) {
          await prisma.invoice.upsert({
            where: { stripeInvoiceId: invoice.id! },
            create: { tenantId: tenant.id, stripeInvoiceId: invoice.id!, amountPaidCents: invoice.amount_paid, currency: invoice.currency, status: 'paid', paidAt: new Date((invoice.status_transitions?.paid_at ?? invoice.created) * 1000) },
            update: { amountPaidCents: invoice.amount_paid, status: 'paid', paidAt: new Date((invoice.status_transitions?.paid_at ?? invoice.created) * 1000) }
          });
        }
        break;
      }
    }
    res.status(200).json({ received: true });
  } catch (e) {
    // Stripe retries on non-2xx, so log and still ack rather than risk a retry storm on our own bug.
    console.error('Stripe webhook handling error:', e);
    res.status(200).json({ received: true, warning: 'Handler error was logged.' });
  }
});

// --- WhatsApp: subscription handshake + inbound message Q&A ---
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
