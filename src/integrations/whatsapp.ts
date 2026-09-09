import crypto from 'node:crypto';
import type { WhatsAppConfig } from '../lib/platformSettings.js';

const DEFAULT_API_VERSION = 'v21.0';

// Verifies Meta's X-Hub-Signature-256 header: HMAC-SHA256 of the raw request body, keyed with
// the App Secret stored server-side. Unlike a client-supplied shared secret, appSecret only ever
// lives in our own encrypted PlatformSetting row, never in the incoming request.
export function verifyWhatsAppSignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const provided = signatureHeader.slice('sha256='.length);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export class WhatsAppApiError extends Error {
  constructor(message: string, public status: number, public body: unknown) { super(message); }
}

// Sends a free-form text message via Meta's WhatsApp Cloud API using the platform's single
// shared Business phone number. Only works within Meta's 24h "customer service window" unless
// `body` uses an approved message template -- see Meta's docs for template messages.
export async function sendWhatsAppText(config: WhatsAppConfig, toNumber: string, body: string) {
  const version = config.apiVersion || DEFAULT_API_VERSION;
  const url = `https://graph.facebook.com/${version}/${config.phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.accessToken}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: toNumber, type: 'text', text: { body } })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new WhatsAppApiError(json?.error?.message || `WhatsApp API request failed (${res.status})`, res.status, json);
  const providerMessageId: string | undefined = json?.messages?.[0]?.id;
  return { providerMessageId, raw: json };
}

// Verifies Meta's webhook subscription handshake (GET request with hub.challenge).
export function verifyWebhookChallenge(query: Record<string, string | undefined>, verifyToken: string): string | null {
  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === verifyToken) {
    return query['hub.challenge'] ?? null;
  }
  return null;
}

// Shape of an inbound message notification from Meta's webhook payload, narrowed to what we use.
export type InboundWhatsAppMessage = { from: string; text: string; messageId: string };
export function parseInboundMessages(payload: unknown): InboundWhatsAppMessage[] {
  const out: InboundWhatsAppMessage[] = [];
  const entries = (payload as any)?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      for (const msg of change?.value?.messages ?? []) {
        if (msg?.type === 'text' && msg?.text?.body) {
          out.push({ from: msg.from, text: msg.text.body, messageId: msg.id });
        }
      }
    }
  }
  return out;
}
