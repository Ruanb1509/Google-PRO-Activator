"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  CaretRight,
  ChartLineUp,
  ChatCircleDots,
  CheckCircle,
  Clock,
  CurrencyCircleDollar,
  Package,
  ShoppingBag,
  Tag,
  Truck,
  Warning,
  type Icon,
} from "@phosphor-icons/react";
import { fmtBRL, fmtDay, fmtUSD, money } from "@/lib/api";
import { useApi } from "@/components/use-api";
import { Card, cn, Empty, ErrorBox, MoreLink, PageHeader, PageSkeleton, SectionTitle, Stat, Table, Td, Th } from "@/components/ui";

interface Stats {
  totalSales: number;
  revenueBrlCents: number;
  revenueUsdCents: number;
  salesToday: number;
  revenueTodayBrlCents: number;
  revenueTodayUsdCents: number;
  salesLast7Days: number;
  salesLast30Days: number;
  pendingOrders: number;
  openTickets: number;
  paidAwaitingDelivery: number;
  activeProducts: number;
  availableStock: number;
  lowStock: { id: string; name: string; available: number; threshold: number }[];
  salesByDay: { day: string; orders: number; brlCents: number; usdCents: number }[];
  topProducts: { productId: string; name: string; sales: number }[];
  brazilVsAbroad: { brazil: number; abroad: number };
}

const axis = { stroke: "var(--color-muted)", fontSize: 12, tickLine: false, axisLine: false } as const;
const grid = { stroke: "var(--color-line)", strokeDasharray: "3 3", vertical: false } as const;
const tooltipStyle = {
  contentStyle: { background: "var(--color-card)", border: "1px solid var(--color-line)", borderRadius: 12, fontSize: 12, color: "var(--color-fg)", padding: "8px 12px" },
  labelStyle: { color: "var(--color-muted)", marginBottom: 4 },
  cursor: { fill: "var(--color-card-2)" },
} as const;

const shortDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

interface ProfitTotals {
  orders: number;
  revenueBrlCents: number;
  profitBrlCents: number;
}
interface Profit {
  today: ProfitTotals;
  currentMonth: ProfitTotals;
  total: ProfitTotals;
  days: (ProfitTotals & { day: string })[];
}

const margin = (t: ProfitTotals) => (t.revenueBrlCents > 0 ? `${Math.round((t.profitBrlCents / t.revenueBrlCents) * 100)}%` : "—");
const profitTone = (c: number) => (c > 0 ? "ok" : c < 0 ? "bad" : undefined);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One row of the "needs attention" list: what is waiting, how many, and where to act. */
function AttentionItem({ icon: I, count, title, hint, href, tone }: { icon: Icon; count: number; title: string; hint: string; href: string; tone: "warn" | "bad" | "info" }) {
  const toneCls = { warn: "bg-warn/10 text-warn", bad: "bg-bad/10 text-bad", info: "bg-info/10 text-info" }[tone];
  return (
    <li>
      <Link href={href} className="group flex items-center gap-3 rounded-xl p-3 transition hover:bg-card-2 active:scale-[0.99]">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", toneCls)}>
          <I size={20} weight="duotone" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted">{hint}</span>
        </span>
        <span className="text-xl font-semibold tabular-nums">{count}</span>
        <CaretRight size={16} className="text-muted transition-transform duration-500 group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

function AttentionPanel({ data }: { data: Stats }) {
  const items = [
    data.paidAwaitingDelivery > 0 && (
      <AttentionItem key="deliver" icon={Truck} tone="bad" count={data.paidAwaitingDelivery} href="/orders" title="Pagos aguardando entrega" hint="O cliente já pagou e ainda não recebeu o produto" />
    ),
    data.openTickets > 0 && (
      <AttentionItem key="tickets" icon={ChatCircleDots} tone="warn" count={data.openTickets} href="/support" title="Tickets aguardando resposta" hint="Dúvidas de pré e pós compra no suporte" />
    ),
    data.lowStock.length > 0 && (
      <AttentionItem key="stock" icon={Warning} tone="warn" count={data.lowStock.length} href="/inventory" title="Produtos com estoque baixo" hint="Abaixo do limite de alerta configurado" />
    ),
    data.pendingOrders > 0 && (
      <AttentionItem key="pending" icon={Clock} tone="info" count={data.pendingOrders} href="/orders" title="Pedidos aguardando pagamento" hint="PIX ou cartão gerado, pagamento ainda não confirmado" />
    ),
  ].filter(Boolean);

  return (
    <Card title="Precisa de atenção" description="O que está esperando uma ação sua agora.">
      {items.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl bg-ok/10 p-4 text-sm text-ok">
          <CheckCircle size={24} weight="duotone" className="shrink-0" />
          <span>
            <span className="block font-medium">Tudo em dia</span>
            <span className="block text-xs opacity-80">Nenhum pedido, ticket ou estoque esperando você.</span>
          </span>
        </div>
      ) : (
        <ul className="-mx-3 -my-1 divide-y divide-line/60">{items}</ul>
      )}

      {data.lowStock.length > 0 && (
        <div className="mt-4 rounded-xl border border-warn/25 bg-warn/5 p-3">
          <div className="mb-2 text-xs font-medium text-warn">Estoque baixo por produto</div>
          <ul className="space-y-2 text-sm">
            {data.lowStock.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/products/${p.id}`} className="font-medium underline-offset-4 hover:underline">
                  {p.name}
                </Link>
                <span className="text-xs text-muted tabular-nums">
                  <b className="text-sm text-fg">{p.available}</b> disponíveis · alerta abaixo de {p.threshold}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function ProfitChart({ data }: { data: Profit }) {
  const byDay = new Map(data.days.map((d) => [d.day, d.profitBrlCents]));
  const brtToday = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const chart = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(brtToday.getTime() - (29 - i) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return { day, profit: (byDay.get(day) ?? 0) / 100 };
  });
  return (
    <Card title="Lucro por dia" description="Últimos 30 dias. Barras vermelhas são dias com prejuízo." actions={<MoreLink href="/profit" />}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid {...grid} />
            <XAxis dataKey="day" tickFormatter={shortDay} {...axis} minTickGap={16} />
            <YAxis {...axis} width={48} />
            <Tooltip {...tooltipStyle} labelFormatter={(d) => fmtDay(String(d))} formatter={(v) => [fmtBRL(Math.round(Number(v) * 100)), "Lucro"]} />
            <Bar dataKey="profit" radius={[4, 4, 0, 0]} maxBarSize={18}>
              {chart.map((d) => (
                <Cell key={d.day} fill={d.profit < 0 ? "var(--color-bad)" : "var(--color-ok)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export default function OverviewPage() {
  const { data, error, loading, reload } = useApi<Stats>("/api/admin/stats");
  const { data: profit } = useApi<Profit>("/api/admin/profit");

  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const revenue = data.salesByDay.map((d) => ({ day: d.day, brl: d.brlCents / 100, usd: d.usdCents / 100 }));
  const regions = [
    { name: "Brasil", value: data.brazilVsAbroad.brazil, color: "var(--color-chart-1)" },
    { name: "Exterior", value: data.brazilVsAbroad.abroad, color: "var(--color-chart-2)" },
  ];
  const regionTotal = regions[0]!.value + regions[1]!.value;
  const today = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <PageHeader title="Visão geral" subtitle={<span className="first-letter:uppercase">{today}</span>} />

      {/* 1. Today, at a glance */}
      <section aria-labelledby="hoje">
        <SectionTitle title={<span id="hoje">Hoje</span>} description="Pedidos pagos desde 00:00 (horário de Brasília)." />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat icon={ShoppingBag} label="Vendas" value={data.salesToday} hint={`${data.salesLast7Days} nos últimos 7 dias`} href="/orders" />
          <Stat
            icon={CurrencyCircleDollar}
            label="Faturado"
            value={fmtBRL(data.revenueTodayBrlCents)}
            tone={data.revenueTodayBrlCents > 0 ? "ok" : undefined}
            hint={data.revenueTodayUsdCents > 0 ? `+ ${fmtUSD(data.revenueTodayUsdCents)} em dólar` : "Somente vendas em real"}
          />
          {profit && (
            <div className="col-span-2 lg:col-span-1">
              <Stat
                icon={ChartLineUp}
                label="Lucro"
                value={fmtBRL(profit.today.profitBrlCents)}
                tone={profitTone(profit.today.profitBrlCents)}
                hint={`Margem de ${margin(profit.today)}`}
                href="/profit"
              />
            </div>
          )}
        </div>
      </section>

      {/* 2. What is waiting + catalog health */}
      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AttentionPanel data={data} />
        </div>
        <Card title="Catálogo" description="Produtos à venda no bot.">
          <ul className="space-y-4">
            {(
              [
                [Tag, "Produtos ativos", data.activeProducts, "/products"],
                [Package, "Unidades em estoque", data.availableStock, "/inventory"],
              ] as const
            ).map(([I, label, value, href]) => (
              <li key={label}>
              <Link href={href} className="flex items-center gap-3 rounded-xl transition hover:opacity-80">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-card-2 text-muted">
                  <I size={20} weight="duotone" />
                </span>
                <span className="flex-1 text-sm text-muted">{label}</span>
                <span className="text-xl font-semibold tabular-nums">{value}</span>
              </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* 3. Results over time */}
      <section aria-labelledby="resultados" className="mt-8">
        <SectionTitle title={<span id="resultados">Resultados</span>} description="Acumulados desde o início da loja, exceto onde indicado." />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Vendas em 30 dias" value={data.salesLast30Days} hint={`${plural(data.totalSales, "venda", "vendas")} no total`} />
          <Stat label="Receita em real" value={fmtBRL(data.revenueBrlCents)} />
          <Stat label="Receita em dólar" value={fmtUSD(data.revenueUsdCents)} />
          {profit ? (
            <Stat
              label="Lucro do mês"
              value={fmtBRL(profit.currentMonth.profitBrlCents)}
              tone={profitTone(profit.currentMonth.profitBrlCents)}
              hint={`Margem ${margin(profit.currentMonth)} · total ${fmtBRL(profit.total.profitBrlCents)}`}
              href="/profit"
            />
          ) : (
            <Stat label="Lucro do mês" value="—" />
          )}
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Vendas por dia" description="Quantidade de pedidos pagos nos últimos 30 dias.">
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
          <details className="group mt-3 text-sm">
            <summary className="cursor-pointer list-none text-xs font-medium text-muted transition hover:text-fg">
              <CaretRight size={12} weight="bold" className="mr-1 inline transition-transform duration-500 group-open:rotate-90" />
              Ver em tabela
            </summary>
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
                    <Td className="tabular-nums">{d.orders}</Td>
                    <Td className="tabular-nums">{fmtBRL(d.brlCents)}</Td>
                    <Td className="tabular-nums">{fmtUSD(d.usdCents)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </details>
        </Card>

        {profit ? <ProfitChart data={profit} /> : <Card title="Lucro por dia"><div className="skeleton h-56" /></Card>}

        <Card title="Receita por dia" description="Real e dólar em gráficos separados, pois são moedas diferentes." className="lg:col-span-2">
          <div className="grid gap-6 sm:grid-cols-2">
            {([
              ["brl", "Em real (BRL)", "BRL", "var(--color-chart-1)"],
              ["usd", "Em dólar (USD)", "USD", "var(--color-chart-3)"],
            ] as const).map(([key, label, cur, color]) => (
              <div key={key}>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
                  <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
                  {label}
                </div>
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
                        formatter={(v) => [money(Math.round(Number(v) * 100), cur), "Receita"]}
                      />
                      <Line type="monotone" dataKey={key} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Produtos mais vendidos" description="Por quantidade de pedidos pagos.">
          {data.topProducts.length === 0 ? (
            <Empty icon={ShoppingBag}>As primeiras vendas aparecem aqui assim que forem pagas.</Empty>
          ) : (
            <ol className="space-y-3">
              {data.topProducts.map((p, i) => {
                const max = data.topProducts[0]!.sales || 1;
                return (
                  <li key={p.productId}>
                    <Link href={`/products/${p.productId}`} className="group block">
                      <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="w-4 shrink-0 text-xs text-muted tabular-nums">{i + 1}</span>
                          <span className="truncate group-hover:underline group-hover:underline-offset-4">{p.name}</span>
                        </span>
                        <span className="shrink-0 font-medium tabular-nums">{p.sales}</span>
                      </div>
                      <div className="ml-6 h-2 rounded-full bg-card-2">
                        <div className="h-2 rounded-full bg-chart-1" style={{ width: `${Math.max(4, (p.sales / max) * 100)}%` }} />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <Card title="Brasil x exterior" description="País informado pelo provedor de pagamento, ou a moeda quando indisponível.">
          {regionTotal === 0 ? (
            <Empty>A divisão por país aparece após a primeira venda.</Empty>
          ) : (
            <div className="flex flex-col items-center gap-6 sm:flex-row">
              <div className="relative h-48 w-full sm:w-1/2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={regions} dataKey="value" nameKey="name" innerRadius="65%" outerRadius="90%" stroke="var(--color-card)" strokeWidth={2}>
                      {regions.map((r) => (
                        <Cell key={r.name} fill={r.color} />
                      ))}
                    </Pie>
                    <Tooltip {...tooltipStyle} formatter={(v, n) => [`${v} vendas`, String(n)]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-semibold tabular-nums">{regionTotal}</span>
                  <span className="text-xs text-muted">vendas</span>
                </div>
              </div>
              <ul className="w-full space-y-3 text-sm sm:w-1/2">
                {regions.map((r) => (
                  <li key={r.name} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-sm" style={{ background: r.color }} aria-hidden />
                      {r.name}
                    </span>
                    <span className="tabular-nums">
                      <b className="font-semibold">{Math.round((r.value / regionTotal) * 100)}%</b> <span className="text-muted">· {r.value}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
