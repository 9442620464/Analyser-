import { prisma } from '../lib/prisma.js';
import { decryptJson } from '../lib/crypto.js';
import { analyzeStore } from './openai.js';
import type { WooCredentials } from '../integrations/woocommerce.js';
import { fetchWooSummary } from '../integrations/woocommerce.js';

export async function dashboardForTenant(tenantId: string) {
  const [tenant, connections, metrics, insights] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.connection.findMany({ where: { tenantId } }),
    prisma.dailyMetric.findMany({ where: { tenantId }, orderBy: { date: 'asc' }, take: 90 }),
    prisma.insight.findMany({ where: { tenantId, dismissedAt: null }, orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }], take: 20 })
  ]);
  return { tenant, connections, metrics, insights };
}

export async function syncWooCommerce(tenantId: string) {
  const connection = await prisma.connection.findUnique({ where: { tenantId_provider: { tenantId, provider: 'WOOCOMMERCE' } } });
  if (!connection?.encryptedData) throw new Error('WooCommerce is not connected.');
  const credentials = decryptJson<WooCredentials>(connection.encryptedData);
  const end = new Date();
  const start = new Date(); start.setDate(end.getDate() - 30);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  await prisma.connection.update({ where: { id: connection.id }, data: { status: 'SYNCING', lastError: null } });
  const run = await prisma.syncRun.create({ data: { tenantId, provider: 'WOOCOMMERCE', status: 'RUNNING' } });
  try {
    const summary = await fetchWooSummary(credentials, iso(start), iso(end));
    const day = new Date(); day.setHours(0,0,0,0);
    await prisma.dailyMetric.upsert({
      where: { tenantId_date: { tenantId, date: day } },
      create: { tenantId, date: day, revenue: summary.totals.revenue, refunds: summary.totals.refunds, orders: summary.totals.orders },
      update: { revenue: summary.totals.revenue, refunds: summary.totals.refunds, orders: summary.totals.orders }
    });
    await prisma.connection.update({ where: { id: connection.id }, data: { status: 'CONNECTED', lastSyncedAt: new Date() } });
    await prisma.syncRun.update({ where: { id: run.id }, data: { status: 'SUCCESS', finishedAt: new Date(), recordsRead: summary.orders.length + summary.products.length + summary.customers.length } });
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.connection.update({ where: { id: connection.id }, data: { status: 'NEEDS_ATTENTION', lastError: message } });
    await prisma.syncRun.update({ where: { id: run.id }, data: { status: 'FAILED', finishedAt: new Date(), error: message } });
    throw error;
  }
}

export async function generateAiInsights(tenantId: string) {
  const data = await dashboardForTenant(tenantId);
  const aiInsights = await analyzeStore({ tenant: data.tenant, connections: data.connections.map(({ encryptedData, ...rest }) => rest), metrics: data.metrics, existingInsights: data.insights });
  await Promise.all(aiInsights.map((i) => prisma.insight.upsert({
    where: { tenantId_fingerprint: { tenantId, fingerprint: `${i.priority}:${i.title}` } },
    create: { tenantId, priority: i.priority, title: i.title, body: i.body, source: i.source, metricValue: i.metricValue, actionLabel: i.actionLabel, fingerprint: `${i.priority}:${i.title}` },
    update: { priority: i.priority, body: i.body, source: i.source, metricValue: i.metricValue, actionLabel: i.actionLabel, dismissedAt: null }
  })));
  return aiInsights;
}
