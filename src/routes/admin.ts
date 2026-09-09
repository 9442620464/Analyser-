import { Router } from 'express';
import { requirePlatformAdmin } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { adminOverview, adminRevenueTrend, adminTenantList, adminTenantDetail } from '../services/adminMetrics.js';
import { getWhatsAppConfig, setWhatsAppConfig, getPricingConfig, setPricingConfig } from '../lib/platformSettings.js';
import { sendWhatsAppText } from '../integrations/whatsapp.js';
import { getStripeClient, planIdForPrice } from '../integrations/stripe.js';

export const adminRouter = Router();
adminRouter.use(requirePlatformAdmin);

adminRouter.get('/overview', async (_req, res) => {
  const [overview, revenueTrend] = await Promise.all([adminOverview(), adminRevenueTrend(30)]);
  res.json({ ...overview, revenueTrend });
});

adminRouter.get('/tenants', async (req, res) => {
  const { search, page, pageSize } = req.query;
  const result = await adminTenantList({ search: search ? String(search) : undefined, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined });
  res.json(result);
});

adminRouter.get('/tenants/:id', async (req, res) => {
  const detail = await adminTenantDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'Tenant not found' });
  res.json(detail);
});

// WhatsApp config: accessToken/appSecret are write-only over the API (never echoed back in full)
// so they don't sit in browser memory/devtools any longer than the moment they're typed.
adminRouter.get('/settings/whatsapp', async (_req, res) => {
  const config = await getWhatsAppConfig();
  if (!config) return res.json({ configured: false });
  res.json({
    configured: true,
    businessAccountId: config.businessAccountId,
    phoneNumberId: config.phoneNumberId,
    apiVersion: config.apiVersion,
    accessToken: config.accessToken ? '••••••••' : '',
    appSecret: config.appSecret ? '••••••••' : '',
    webhookVerifyToken: config.webhookVerifyToken ? '••••••••' : ''
  });
});

adminRouter.put('/settings/whatsapp', async (req, res) => {
  const { businessAccountId, phoneNumberId, accessToken, appSecret, webhookVerifyToken, apiVersion } = req.body ?? {};
  const existing = await getWhatsAppConfig();
  const next = {
    businessAccountId: businessAccountId || existing?.businessAccountId || '',
    phoneNumberId: phoneNumberId || existing?.phoneNumberId || '',
    // Masked placeholder means "keep the existing secret" -- only overwrite on a real new value.
    accessToken: accessToken && accessToken !== '••••••••' ? accessToken : existing?.accessToken || '',
    appSecret: appSecret && appSecret !== '••••••••' ? appSecret : existing?.appSecret || '',
    webhookVerifyToken: webhookVerifyToken && webhookVerifyToken !== '••••••••' ? webhookVerifyToken : existing?.webhookVerifyToken || '',
    apiVersion: apiVersion || existing?.apiVersion
  };
  if (!next.businessAccountId || !next.phoneNumberId || !next.accessToken || !next.appSecret || !next.webhookVerifyToken) {
    return res.status(400).json({ error: 'businessAccountId, phoneNumberId, accessToken, appSecret, and webhookVerifyToken are all required.' });
  }
  await setWhatsAppConfig(next);
  res.json({ ok: true });
});

adminRouter.post('/settings/whatsapp/test', async (req, res) => {
  const { toNumber, message } = req.body ?? {};
  const config = await getWhatsAppConfig();
  if (!config) return res.status(400).json({ error: 'Configure WhatsApp settings first.' });
  if (!toNumber) return res.status(400).json({ error: 'toNumber is required, e.g. 15551234567 (E.164 without the +).' });
  try {
    const result = await sendWhatsAppText(config, String(toNumber), String(message || 'This is a test message from StoreBuddy AI.'));
    res.json({ ok: true, providerMessageId: result.providerMessageId });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

adminRouter.get('/settings/pricing', async (_req, res) => { res.json(await getPricingConfig()); });
adminRouter.put('/settings/pricing', async (req, res) => {
  const { aiInputPer1kUsd, aiOutputPer1kUsd, whatsappPerConversationUsd } = req.body ?? {};
  await setPricingConfig({
    aiInputPer1kUsd: aiInputPer1kUsd ?? {},
    aiOutputPer1kUsd: aiOutputPer1kUsd ?? {},
    whatsappPerConversationUsd: Number(whatsappPerConversationUsd ?? 0)
  });
  res.json({ ok: true });
});

// Pulls live subscription state from Stripe for one tenant, in case a webhook was missed.
adminRouter.post('/tenants/:id/stripe-sync', async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!tenant?.stripeSubscriptionId) return res.status(400).json({ error: 'This tenant has no Stripe subscription on file.' });
  try {
    const sub = await getStripeClient().subscriptions.retrieve(tenant.stripeSubscriptionId);
    const price = sub.items.data[0]?.price;
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        subscriptionStatus: sub.status.toUpperCase() as any,
        planId: planIdForPrice(price?.id) ?? tenant.planId,
        currentPeriodEnd: new Date(sub.items.data[0].current_period_end * 1000)
      }
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});
