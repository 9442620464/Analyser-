import Stripe from 'stripe';
import { env } from '../config/env.js';

let client: Stripe | undefined;
export function getStripeClient(): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured.');
  client ??= new Stripe(env.STRIPE_SECRET_KEY);
  return client;
}

// Maps a Stripe Price ID to our internal PlanId enum. Configure the three env vars to match
// the Price IDs of your actual Starter/Growth/Pro products in the Stripe dashboard.
export function planIdForPrice(priceId: string | undefined | null): 'STARTER' | 'GROWTH' | 'PRO' | undefined {
  if (!priceId) return undefined;
  if (priceId === env.STRIPE_PRICE_STARTER) return 'STARTER';
  if (priceId === env.STRIPE_PRICE_GROWTH) return 'GROWTH';
  if (priceId === env.STRIPE_PRICE_PRO) return 'PRO';
  return undefined;
}

export function verifyStripeWebhook(rawBody: Buffer, signature: string | undefined): Stripe.Event {
  if (!env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not configured.');
  if (!signature) throw new Error('Missing Stripe-Signature header.');
  return getStripeClient().webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}

export async function fetchSubscription(subscriptionId: string) {
  return getStripeClient().subscriptions.retrieve(subscriptionId);
}
