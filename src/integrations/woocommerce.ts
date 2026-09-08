import crypto from 'node:crypto';

export type WooCredentials = { baseUrl: string; consumerKey: string; consumerSecret: string };

async function get<T>(credentials: WooCredentials, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`/wp-json/wc/v3/${path.replace(/^\//, '')}`, credentials.baseUrl);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const basic = Buffer.from(`${credentials.consumerKey}:${credentials.consumerSecret}`).toString('base64');
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`WooCommerce ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

export async function fetchWooSummary(credentials: WooCredentials, start: string, end: string) {
  const orders = await get<Array<any>>(credentials, 'orders', {
    after: `${start}T00:00:00`,
    before: `${end}T23:59:59`,
    per_page: '100',
    page: '1'
  });
  const products = await get<Array<any>>(credentials, 'products', { per_page: '100', stock_status: 'instock' });
  const customers = await get<Array<any>>(credentials, 'customers', { per_page: '100', role: 'all' });

  const completed = orders.filter(o => o.status === 'completed');
  const revenue = completed.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const refunds = completed.reduce((sum, o) => sum + Number(o.refund_total || 0), 0);
  return {
    orders,
    products,
    customers,
    totals: { revenue: revenue - refunds, grossRevenue: revenue, refunds, orders: orders.length }
  };
}

/**
 * WooCommerce ships a built-in "click to authorize" flow (since WC 3.4) that avoids ever asking
 * the store owner to generate/copy-paste API keys. The store owner is redirected to their own
 * wp-admin, clicks one "Approve" button, and WooCommerce POSTs the generated key/secret straight
 * to callbackUrl. See: https://developer.woocommerce.com/docs/apis/rest-api/authentication/
 */
export function wooAuthorizeUrl(baseUrl: string, opts: { appName: string; userId: string; returnUrl: string; callbackUrl: string; scope?: 'read' | 'write' | 'read_write' }) {
  const url = new URL('/wc-auth/v1/authorize', baseUrl);
  url.searchParams.set('app_name', opts.appName);
  url.searchParams.set('scope', opts.scope ?? 'read');
  url.searchParams.set('user_id', opts.userId);
  url.searchParams.set('return_url', opts.returnUrl);
  url.searchParams.set('callback_url', opts.callbackUrl);
  return url.toString();
}

export function verifyWooWebhook(rawBody: Buffer, signature: string | undefined, secret: string) {
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
