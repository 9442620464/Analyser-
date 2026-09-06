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

export function verifyWooWebhook(rawBody: Buffer, signature: string | undefined, secret: string) {
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
