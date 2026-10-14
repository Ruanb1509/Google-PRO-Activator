import { db } from "@/server/common/db";
import { usdBrlRate, usdBrlRateOn, usdToBrlCents } from "@/server/common/fx";
import { logger } from "@/server/common/logger";

/** Purchases bought while the rate service was down get the rate of their day, a few per request. */
async function fillMissingRates(): Promise<void> {
  const missing = await db().supplierPurchase.findMany({ where: { usdBrlRate: null }, orderBy: { createdAt: "asc" }, take: 15 });
  for (const p of missing) {
    const rate = await usdBrlRateOn(p.createdAt);
    if (!rate) return;
    await db().supplierPurchase.update({ where: { id: p.id }, data: { usdBrlRate: rate, totalCostBrlCents: usdToBrlCents(p.totalCostUsdCents, rate) } });
  }
  if (missing.length) logger.info("profit.rates_filled", { count: missing.length });
}

type DayRow = { day: string; orders: bigint; units: bigint; revenue: number | null; cost: number | null; uncosted: bigint };

export interface ProfitDay {
  day: string; // YYYY-MM-DD (Brasília)
  orders: number;
  units: number;
  revenueBrlCents: number;
  costBrlCents: number;
  profitBrlCents: number;
  uncostedUnits: number; // sold units with no known supplier cost (counted as 0)
}

type Totals = Omit<ProfitDay, "day">;

function sum(rows: ProfitDay[]): Totals {
  const t: Totals = { orders: 0, units: 0, revenueBrlCents: 0, costBrlCents: 0, profitBrlCents: 0, uncostedUnits: 0 };
  for (const r of rows) {
    t.orders += r.orders;
    t.units += r.units;
    t.revenueBrlCents += r.revenueBrlCents;
    t.costBrlCents += r.costBrlCents;
    t.profitBrlCents += r.profitBrlCents;
    t.uncostedUnits += r.uncostedUnits;
  }
  return t;
}

const todayBrt = () => new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

/**
 * Profit of paid orders, per Brasília day: revenue minus what the supplier charged for the units
 * delivered. A supplier batch's cost is split evenly over its units; USD amounts are converted at
 * the rate of the purchase day (sales in USD and purchases without a rate use today's rate).
 * Payment provider fees are not deducted.
 */
export async function profitReport() {
  await fillMissingRates().catch((err) => logger.warn("profit.fill_rates_failed", { err }));
  const rate = (await usdBrlRate()) ?? (await db().supplierPurchase.findFirst({ where: { usdBrlRate: { not: null } }, orderBy: { createdAt: "desc" } }))?.usdBrlRate ?? 0;

  const [rows, spend] = await Promise.all([
    db().$queryRaw<DayRow[]>`
      WITH batch_cost AS (
        SELECT sp.batch_id,
               COALESCE(sp.total_cost_brl_cents, sp.total_cost_usd_cents * ${rate}::float8) / NULLIF(count(i.id), 0) AS unit_brl
        FROM supplier_purchases sp
        JOIN inventory_items i ON i.batch_id = sp.batch_id AND i.status <> 'CANCELLED'
        GROUP BY sp.batch_id, sp.total_cost_brl_cents, sp.total_cost_usd_cents
      ),
      order_cost AS (
        SELECT i.order_id, sum(bc.unit_brl) AS cost, count(bc.batch_id) AS costed
        FROM inventory_items i LEFT JOIN batch_cost bc ON bc.batch_id = i.batch_id
        WHERE i.status = 'SOLD' AND i.order_id IS NOT NULL
        GROUP BY i.order_id
      )
      SELECT to_char(o.paid_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS day,
             count(*) AS orders,
             sum(o.quantity) AS units,
             sum(CASE WHEN o.currency = 'BRL' THEN o.amount_cents ELSE o.amount_cents * ${rate}::float8 END)::float8 AS revenue,
             COALESCE(sum(oc.cost), 0)::float8 AS cost,
             sum(GREATEST(o.quantity - COALESCE(oc.costed, 0), 0)) AS uncosted
      FROM orders o LEFT JOIN order_cost oc ON oc.order_id = o.id
      WHERE o.status IN ('PAID', 'DELIVERED') AND o.paid_at IS NOT NULL
      GROUP BY 1 ORDER BY 1`,
    db().supplierPurchase.aggregate({ _sum: { totalCostUsdCents: true, totalCostBrlCents: true }, _count: { _all: true } }),
  ]);

  const days: ProfitDay[] = rows.map((r) => {
    const revenue = Math.round(r.revenue ?? 0);
    const cost = Math.round(r.cost ?? 0);
    return {
      day: r.day,
      orders: Number(r.orders),
      units: Number(r.units),
      revenueBrlCents: revenue,
      costBrlCents: cost,
      profitBrlCents: revenue - cost,
      uncostedUnits: Number(r.uncosted),
    };
  });

  const byMonth = new Map<string, ProfitDay[]>();
  for (const d of days) {
    const key = d.day.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), d]);
  }
  const months = [...byMonth].map(([month, list]) => ({ month, ...sum(list) })).reverse();
  const today = todayBrt();

  return {
    usdBrlRate: rate || null,
    today: { day: today, ...sum(days.filter((d) => d.day === today)) },
    currentMonth: { month: today.slice(0, 7), ...sum(byMonth.get(today.slice(0, 7)) ?? []) },
    total: sum(days),
    supplierSpend: { purchases: spend._count._all, usdCents: spend._sum.totalCostUsdCents ?? 0, brlCents: spend._sum.totalCostBrlCents ?? 0 },
    months,
    days,
  };
}
