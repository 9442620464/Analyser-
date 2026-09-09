import { prisma } from '../lib/prisma.js';

function startOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

export async function adminOverview() {
  const monthStart = startOfMonth();

  const [
    totalTenants,
    planBreakdown,
    subscriptionBreakdown,
    revenueThisMonth,
    revenueAllTime,
    aiThisMonth,
    whatsappThisMonth,
    connectionsByStatus
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.groupBy({ by: ['planId'], _count: { _all: true } }),
    prisma.tenant.groupBy({ by: ['subscriptionStatus'], _count: { _all: true } }),
    prisma.invoice.aggregate({ where: { status: 'paid', paidAt: { gte: monthStart } }, _sum: { amountPaidCents: true } }),
    prisma.invoice.aggregate({ where: { status: 'paid' }, _sum: { amountPaidCents: true } }),
    prisma.aiUsageEvent.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { totalTokens: true, estimatedCostUsd: true }, _count: { _all: true } }),
    prisma.whatsAppMessage.aggregate({ where: { direction: 'OUTBOUND', createdAt: { gte: monthStart } }, _sum: { estimatedCostUsd: true }, _count: { _all: true } }),
    prisma.connection.groupBy({ by: ['status'], _count: { _all: true } })
  ]);

  return {
    totalTenants,
    planBreakdown: planBreakdown.map((p) => ({ planId: p.planId ?? 'NONE', count: p._count._all })),
    subscriptionBreakdown: subscriptionBreakdown.map((s) => ({ status: s.subscriptionStatus ?? 'NONE', count: s._count._all })),
    revenueThisMonthCents: revenueThisMonth._sum.amountPaidCents ?? 0,
    revenueAllTimeCents: revenueAllTime._sum.amountPaidCents ?? 0,
    aiTokensThisMonth: aiThisMonth._sum.totalTokens ?? 0,
    aiCostThisMonthUsd: Number(aiThisMonth._sum.estimatedCostUsd ?? 0),
    aiCallsThisMonth: aiThisMonth._count._all,
    whatsappMessagesThisMonth: whatsappThisMonth._count._all,
    whatsappCostThisMonthUsd: Number(whatsappThisMonth._sum.estimatedCostUsd ?? 0),
    connectionsByStatus: connectionsByStatus.map((c) => ({ status: c.status, count: c._count._all }))
  };
}

export async function adminRevenueTrend(days = 30) {
  const since = startOfDay(new Date(Date.now() - days * 86400000));
  const invoices = await prisma.invoice.findMany({ where: { status: 'paid', paidAt: { gte: since } }, select: { amountPaidCents: true, paidAt: true } });
  const byDay = new Map<string, number>();
  for (const inv of invoices) {
    const key = (inv.paidAt ?? new Date()).toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + inv.amountPaidCents);
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, cents]) => ({ date, revenueCents: cents }));
}

export async function adminTenantList(opts: { search?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const monthStart = startOfMonth();

  const where = opts.search ? { OR: [{ name: { contains: opts.search, mode: 'insensitive' as const } }, { slug: { contains: opts.search, mode: 'insensitive' as const } }] } : {};

  const [tenants, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { connections: { select: { provider: true, status: true, lastSyncedAt: true } } }
    }),
    prisma.tenant.count({ where })
  ]);

  const tenantIds = tenants.map((t) => t.id);
  const [aiCosts, whatsappCosts] = await Promise.all([
    prisma.aiUsageEvent.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds }, createdAt: { gte: monthStart } }, _sum: { estimatedCostUsd: true, totalTokens: true } }),
    prisma.whatsAppMessage.groupBy({ by: ['tenantId'], where: { tenantId: { in: tenantIds }, direction: 'OUTBOUND', createdAt: { gte: monthStart } }, _sum: { estimatedCostUsd: true }, _count: { _all: true } })
  ]);
  const aiByTenant = new Map(aiCosts.map((a) => [a.tenantId, a]));
  const waByTenant = new Map(whatsappCosts.map((w) => [w.tenantId, w]));

  const rows = tenants.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    createdAt: t.createdAt,
    planId: t.planId,
    subscriptionStatus: t.subscriptionStatus,
    currentPeriodEnd: t.currentPeriodEnd,
    lastSyncedAt: t.connections.reduce<Date | null>((max, c) => (c.lastSyncedAt && (!max || c.lastSyncedAt > max) ? c.lastSyncedAt : max), null),
    connectionCount: t.connections.filter((c) => c.status === 'CONNECTED').length,
    aiTokensThisMonth: aiByTenant.get(t.id)?._sum.totalTokens ?? 0,
    aiCostThisMonthUsd: Number(aiByTenant.get(t.id)?._sum.estimatedCostUsd ?? 0),
    whatsappMessagesThisMonth: waByTenant.get(t.id)?._count._all ?? 0,
    whatsappCostThisMonthUsd: Number(waByTenant.get(t.id)?._sum.estimatedCostUsd ?? 0)
  }));

  return { rows, total, page, pageSize };
}

export async function adminTenantDetail(tenantId: string) {
  const [tenant, connections, aiEvents, whatsappMessages, invoices, recipients] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId } }),
    prisma.connection.findMany({ where: { tenantId }, select: { provider: true, status: true, displayName: true, lastSyncedAt: true, lastError: true } }),
    prisma.aiUsageEvent.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.whatsAppMessage.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.invoice.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 24 }),
    prisma.whatsAppRecipient.findMany({ where: { tenantId } })
  ]);
  if (!tenant) return null;
  return { tenant, connections, aiEvents, whatsappMessages, invoices, recipients };
}
