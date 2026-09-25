import { db } from "@/server/common/db";
import { listProducts } from "@/server/products/products.service";
import { getSettings } from "@/server/settings/settings.service";
import { openTicketsCount } from "@/server/support/support.service";

const PAID = ["PAID", "DELIVERED"] as const;

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

export async function dashboardStats() {
  const today = daysAgo(0);
  const [totals, byCurrency, todayCount, last7, last30, pending, paid, products, daily, top, regions, settings] = await Promise.all([
    db().order.count({ where: { status: { in: [...PAID] } } }),
    db().order.groupBy({ by: ["currency"], where: { status: { in: [...PAID] } }, _sum: { amountCents: true }, _count: { _all: true } }),
    db().order.count({ where: { status: { in: [...PAID] }, paidAt: { gte: today } } }),
    db().order.count({ where: { status: { in: [...PAID] }, paidAt: { gte: daysAgo(6) } } }),
    db().order.count({ where: { status: { in: [...PAID] }, paidAt: { gte: daysAgo(29) } } }),
    db().order.count({ where: { status: "PENDING", expiresAt: { gt: new Date() } } }),
    db().order.count({ where: { status: "PAID" } }), // paid, awaiting delivery
    listProducts({ includeInactive: true }),
    db().$queryRaw<{ day: Date; orders: bigint; brl: bigint | null; usd: bigint | null }[]>`
      SELECT date_trunc('day', paid_at) AS day,
             count(*) AS orders,
             sum(amount_cents) FILTER (WHERE currency = 'BRL') AS brl,
             sum(amount_cents) FILTER (WHERE currency = 'USD') AS usd
      FROM orders
      WHERE status IN ('PAID', 'DELIVERED') AND paid_at >= ${daysAgo(29)}
      GROUP BY 1 ORDER BY 1`,
    db().$queryRaw<{ product_id: string; name: string; sales: bigint }[]>`
      SELECT o.product_id, p.name, count(*) AS sales
      FROM orders o JOIN products p ON p.id = o.product_id
      WHERE o.status IN ('PAID', 'DELIVERED')
      GROUP BY 1, 2 ORDER BY sales DESC LIMIT 8`,
    db().$queryRaw<{ country: string | null; currency: string; sales: bigint }[]>`
      SELECT country, currency::text AS currency, count(*) AS sales
      FROM orders WHERE status IN ('PAID', 'DELIVERED')
      GROUP BY 1, 2`,
    getSettings(),
  ]);

  // Fill missing days so charts have a continuous axis.
  const byDay = new Map(daily.map((d) => [d.day.toISOString().slice(0, 10), d]));
  const series = Array.from({ length: 30 }, (_, i) => {
    const key = daysAgo(29 - i).toISOString().slice(0, 10);
    const d = byDay.get(key);
    return { day: key, orders: Number(d?.orders ?? 0), brlCents: Number(d?.brl ?? 0), usdCents: Number(d?.usd ?? 0) };
  });

  // Brazil vs abroad: provider-reported country first; falls back to currency when unknown.
  let brazil = 0;
  let abroad = 0;
  for (const r of regions) {
    const isBr = r.country ? settings.brlCountries.includes(r.country) : r.currency === "BRL";
    if (isBr) brazil += Number(r.sales);
    else abroad += Number(r.sales);
  }

  const active = products.filter((p) => p.isActive);
  return {
    openTickets: await openTicketsCount(),
    totalSales: totals,
    revenueBrlCents: byCurrency.find((c) => c.currency === "BRL")?._sum.amountCents ?? 0,
    revenueUsdCents: byCurrency.find((c) => c.currency === "USD")?._sum.amountCents ?? 0,
    salesToday: todayCount,
    salesLast7Days: last7,
    salesLast30Days: last30,
    pendingOrders: pending,
    paidAwaitingDelivery: paid,
    activeProducts: active.length,
    availableStock: active.reduce((n, p) => n + p.stock.available, 0),
    lowStock: active.filter((p) => p.lowStock).map((p) => ({ id: p.id, name: p.name, available: p.stock.available, threshold: p.lowStockThreshold })),
    salesByDay: series,
    topProducts: top.map((t) => ({ productId: t.product_id, name: t.name, sales: Number(t.sales) })),
    brazilVsAbroad: { brazil, abroad },
  };
}

/** Basic operational metrics (JSON) for uptime/monitoring tools. */
export async function operationalMetrics() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [ordersByStatus, webhooks24h, webhookErrors24h, undelivered, pendingDeposits] = await Promise.all([
    db().order.groupBy({ by: ["status"], _count: { _all: true } }),
    db().paymentEvent.count({ where: { createdAt: { gte: since } } }),
    db().paymentEvent.count({ where: { createdAt: { gte: since }, OR: [{ error: { not: null } }, { processedAt: null }] } }),
    db().order.count({ where: { status: "PAID" } }),
    db().deposit.count({ where: { status: "PENDING" } }),
  ]);
  return {
    time: new Date().toISOString(),
    ordersByStatus: Object.fromEntries(ordersByStatus.map((o) => [o.status, o._count._all])),
    webhooks24h,
    webhookErrors24h,
    paidAwaitingDelivery: undelivered,
    pendingDeposits,
  };
}
