import { prisma } from './prisma.js';
import { encryptJson, decryptJson } from './crypto.js';

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  if (!row) return undefined;
  return row.encrypted ? decryptJson<T>(row.valueJson) : (JSON.parse(row.valueJson) as T);
}

export async function setSetting(key: string, value: unknown, opts: { encrypted?: boolean } = {}): Promise<void> {
  const encrypted = opts.encrypted ?? false;
  const valueJson = encrypted ? encryptJson(value) : JSON.stringify(value);
  await prisma.platformSetting.upsert({
    where: { key },
    create: { key, valueJson, encrypted },
    update: { valueJson, encrypted }
  });
}

// --- WhatsApp Business API config (single shared platform account) ---
export type WhatsAppConfig = {
  businessAccountId: string;
  phoneNumberId: string;
  accessToken: string;
  webhookVerifyToken: string;
  // Meta's App Secret -- used to verify the X-Hub-Signature-256 header on inbound webhooks.
  // Not the same as accessToken. Find it under Meta App Dashboard > Settings > Basic.
  appSecret: string;
  apiVersion?: string;
};
const WHATSAPP_CONFIG_KEY = 'whatsapp.config';
export async function getWhatsAppConfig() { return getSetting<WhatsAppConfig>(WHATSAPP_CONFIG_KEY); }
export async function setWhatsAppConfig(config: WhatsAppConfig) { return setSetting(WHATSAPP_CONFIG_KEY, config, { encrypted: true }); }

// --- Cost estimation settings (admin-editable; these are estimates you set to match your
// actual OpenAI/Meta billing, not values StoreBuddy can know on its own). ---
export type PricingConfig = {
  // USD per 1,000 tokens, keyed by model name. Fill these in from your OpenAI billing page.
  aiInputPer1kUsd: Record<string, number>;
  aiOutputPer1kUsd: Record<string, number>;
  // USD per WhatsApp conversation, since Meta bills per-conversation not per-message and the
  // rate varies by country + category. Set this to a blended estimate for your customer base.
  whatsappPerConversationUsd: number;
};
const PRICING_KEY = 'pricing.config';
const DEFAULT_PRICING: PricingConfig = {
  aiInputPer1kUsd: {},
  aiOutputPer1kUsd: {},
  whatsappPerConversationUsd: 0
};
export async function getPricingConfig(): Promise<PricingConfig> {
  const stored = await getSetting<PricingConfig>(PRICING_KEY);
  return stored ?? DEFAULT_PRICING;
}
export async function setPricingConfig(config: PricingConfig) { return setSetting(PRICING_KEY, config, { encrypted: false }); }
