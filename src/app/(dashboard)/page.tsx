"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtBRL, fmtDay, fmtUSD, money } from "@/lib/api";
import { useApi } from "@/components/use-api";
import { Card, Empty, ErrorBox, Loading, PageHeader, Stat, Table, Td, Th } from "@/components/ui";

interface Stats {
  totalSales: number;
  revenueBrlCents: number;
  revenueUsdCents: number;
  salesToday: number;
  salesLast7Days: number;
  salesLast30Days: number;
  pendingOrders: number;
  paidAwaitingDelivery: number;
  activeProducts: number;
  availableStock: number;
  lowStock: { id: string; name: string; available: number; threshold: number }[];
  salesByDay: { day: string; orders: number; brlCents: number; usdCents: number }[];
  topProducts: { productId: string; name: string; sales: number }[];
  brazilVsAbroad: { brazil: number; abroad: number };
}

const axis = { stroke: "var(--color-muted)", fontSize: 11, tickLine: false, axisLine: false } as const;
const grid = { stroke: "var(--color-line)", strokeDasharray: "3 3", vertical: false } as const;
const tooltipStyle = {
  contentStyle: { background: "var(--color-card)", border: "1px solid var(--color-line)", borderRadius: 8, fontSize: 12, color: "var(--color-fg)" },
  labelStyle: { color: "var(--color-muted)" },
  cursor: { fill: "var(--color-card-2)" },
} as const;

const shortDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export default function OverviewPage() {
  const { data, error, loading, reload } = useApi<Stats>("/api/admin/stats");

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const revenue = data.salesByDay.map((d) => ({ day: d.day, brl: d.brlCents / 100, usd: d.usdCents / 100 }));
  const regions = [
    { name: "Brasil", value: data.brazilVsAbroad.brazil, color: "var(--color-chart-1)" },
    { name: "Exterior", value: data.brazilVsAbroad.abroad, color: "var(--color-chart-2)" },
  ];
  const regionTotal = regions[0]!.value + regions[1]!.value;

  return (
    <>
      <PageHeader title="Visão geral" subtitle="Resumo das vendas, pedidos e estoque" />

      {data.lowStock.length > 0 && (
        <div className="mb-5 rounded-xl border border-warn/40 bg-warn/10 p-4" role="alert">
          <div className="font-semibold text-warn">⚠️ Estoque baixo</div>
          <ul className="mt-2 space-y-1 text-sm">
            {data.lowStock.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Produto: <Link href={`/products/${p.id}`} className="font-medium underline-offset-2 hover:underline">{p.name}</Link>
                </span>
                <span className="text-muted">
                  Disponível: <b className="text-fg">{p.available} unidades</b> (alerta &lt; {p.threshold})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Stat label="Total de vendas" value={data.totalSales} />
        <Stat label="Receita em BRL" value={fmtBRL(data.revenueBrlCents)} />
        <Stat label="Receita em USD" value={fmtUSD(data.revenueUsdCents)} />
        <Stat label="Vendas hoje" value={data.salesToday} />
        <Stat label="Últimos 7 dias" value={data.salesLast7Days} />
        <Stat label="Últimos 30 dias" value={data.salesLast30Days} />
        <Stat label="Pedidos pendentes" value={data.pendingOrders} hint="Aguardando pagamento" />
        <Stat label="Pagos aguardando entrega" value={data.paidAwaitingDelivery} tone={data.paidAwaitingDelivery > 0 ? "warn" : undefined} />
        <Stat label="Produtos ativos" value={data.activeProducts} />
        <Stat label="Estoque disponível" value={data.availableStock} />
        <Stat label="Produtos com estoque baixo" value={data.lowStock.length} tone={data.lowStock.length ? "warn" : "ok"} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card title="Vendas por dia (30 dias)">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.salesByDay} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid {...grid} />
                <XAxis dataKey="day" tickFormatter={shortDay} {...axis} minTickGap={16} />
                <YAxis allowDecimals={false} {...axis} />
                <Tooltip {...tooltipStyle} labelFormatter={(d) => fmtDay(String(d))} formatter={(v) => [String(v), "Vendas"]} />
                <Bar dataKey="orders" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-xs text-muted">Ver tabela</summary>
            <Table>
              <thead>
                <tr>
                  <Th>Dia</Th>
                  <Th>Vendas</Th>
                  <Th>BRL</Th>
                  <Th>USD</Th>
                </tr>
              </thead>
              <tbody>
                {data.salesByDay.filter((d) => d.orders > 0).map((d) => (
                  <tr key={d.day}>
                    <Td>{fmtDay(d.day)}</Td>
                    <Td>{d.orders}</Td>
                    <Td>{fmtBRL(d.brlCents)}</Td>
                    <Td>{fmtUSD(d.usdCents)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </details>
        </Card>

        <Card title="Receita por período (30 dias)">
          {/* BRL and USD are different units: two small charts instead of a dual axis. */}
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ["brl", "Receita BRL", "BRL", "var(--color-chart-1)"],
              ["usd", "Receita USD", "USD", "var(--color-chart-3)"],
            ] as const).map(([key, label, cur, color]) => (
              <div key={key}>
                <div className="mb-1 text-xs text-muted">{label}</div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={revenue} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                      <CartesianGrid {...grid} />
                      <XAxis dataKey="day" tickFormatter={shortDay} {...axis} minTickGap={24} />
                      <YAxis {...axis} width={48} />
                      <Tooltip
                        {...tooltipStyle}
                        cursor={{ stroke: "var(--color-line)" }}
                        labelFormatter={(d) => fmtDay(String(d))}
                        formatter={(v) => [money(Math.round(Number(v) * 100), cur), label]}
                      />
                      <Line type="monotone" dataKey={key} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Produtos mais vendidos">
          {data.topProducts.length === 0 ? (
            <Empty>Nenhuma venda ainda.</Empty>
          ) : (
            <div style={{ height: Math.max(160, data.topProducts.length * 36) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.topProducts} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
                  <CartesianGrid {...grid} horizontal={false} vertical />
                  <XAxis type="number" allowDecimals={false} {...axis} />
                  <YAxis type="category" dataKey="name" width={130} {...axis} tick={{ fill: "var(--color-fg)", fontSize: 12 }} />
                  <Tooltip {...tooltipStyle} formatter={(v) => [String(v), "Vendas"]} />
                  <Bar dataKey="sales" fill="var(--color-chart-1)" radius={[0, 4, 4, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card title="Vendas Brasil x exterior">
          {regionTotal === 0 ? (
            <Empty>Nenhuma venda ainda.</Empty>
          ) : (
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <div className="h-52 w-full sm:w-1/2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={regions} dataKey="value" nameKey="name" innerRadius="60%" outerRadius="90%" stroke="var(--color-card)" strokeWidth={2}>
                      {regions.map((r) => (
                        <Cell key={r.name} fill={r.color} />
                      ))}
                    </Pie>
                    <Tooltip {...tooltipStyle} formatter={(v, n) => [`${v} vendas`, String(n)]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="w-full space-y-2 text-sm sm:w-1/2">
                {regions.map((r) => (
                  <li key={r.name} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-sm" style={{ background: r.color }} aria-hidden />
                      {r.name === "Brasil" ? "🇧🇷 Brasil" : "🌎 Exterior"}
                    </span>
                    <span className="tabular-nums">
                      {r.value} <span className="text-muted">({Math.round((r.value / regionTotal) * 100)}%)</span>
                    </span>
                  </li>
                ))}
                <li className="text-xs text-muted">País informado pelo provedor de pagamento; moeda quando indisponível.</li>
              </ul>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
