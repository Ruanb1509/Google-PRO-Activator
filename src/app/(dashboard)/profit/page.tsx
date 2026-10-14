"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtBRL, fmtDay, fmtUSD } from "@/lib/api";
import { useApi } from "@/components/use-api";
import { Card, Empty, ErrorBox, Loading, Notice, PageHeader, Stat, Table, Td, Th, cn } from "@/components/ui";

interface Totals {
  orders: number;
  units: number;
  revenueBrlCents: number;
  costBrlCents: number;
  profitBrlCents: number;
  uncostedUnits: number;
}
interface Day extends Totals {
  day: string;
}
interface Report {
  usdBrlRate: number | null;
  today: Totals & { day: string };
  currentMonth: Totals & { month: string };
  total: Totals;
  supplierSpend: { purchases: number; usdCents: number; brlCents: number };
  months: (Totals & { month: string })[];
  days: Day[];
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} de ${m.slice(0, 4)}`;
const margin = (t: Totals) => (t.revenueBrlCents > 0 ? `${Math.round((t.profitBrlCents / t.revenueBrlCents) * 100)}%` : "—");
const tone = (cents: number) => (cents > 0 ? "ok" : cents < 0 ? "bad" : undefined);

const axis = { stroke: "var(--color-muted)", fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = {
  contentStyle: { background: "var(--color-card)", border: "1px solid var(--color-line)", borderRadius: 8, fontSize: 12, color: "var(--color-fg)" },
  labelStyle: { color: "var(--color-muted)" },
  cursor: { fill: "var(--color-card-2)" },
} as const;

/** Every day of `month` (YYYY-MM) up to today, with zeros where nothing sold. */
function monthDays(month: string, days: Day[], today: string): Day[] {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: Day[] = [];
  for (let i = 1; i <= last; i++) {
    const day = `${month}-${String(i).padStart(2, "0")}`;
    if (day > today) break;
    out.push(byDay.get(day) ?? { day, orders: 0, units: 0, revenueBrlCents: 0, costBrlCents: 0, profitBrlCents: 0, uncostedUnits: 0 });
  }
  return out;
}

function Row({ label, t, bold }: { label: string; t: Totals; bold?: boolean }) {
  return (
    <tr className={cn(bold && "font-semibold")}>
      <Td>{label}</Td>
      <Td className="tabular-nums">{t.orders}</Td>
      <Td className="tabular-nums">{t.units}</Td>
      <Td className="tabular-nums">{fmtBRL(t.revenueBrlCents)}</Td>
      <Td className="tabular-nums">{fmtBRL(t.costBrlCents)}</Td>
      <Td className={cn("tabular-nums", t.profitBrlCents > 0 && "text-ok", t.profitBrlCents < 0 && "text-bad")}>{fmtBRL(t.profitBrlCents)}</Td>
      <Td className="tabular-nums">{margin(t)}</Td>
    </tr>
  );
}

const Head = ({ first }: { first: string }) => (
  <thead>
    <tr>
      <Th>{first}</Th>
      <Th>Pedidos</Th>
      <Th>Unidades</Th>
      <Th>Receita</Th>
      <Th>Custo fornecedor</Th>
      <Th>Lucro</Th>
      <Th>Margem</Th>
    </tr>
  </thead>
);

export default function ProfitPage() {
  const { data, error, loading, reload } = useApi<Report>("/api/admin/profit");
  const [month, setMonth] = useState<string | null>(null);

  const selected = month ?? data?.currentMonth.month ?? "";
  const days = useMemo(() => (data ? monthDays(selected, data.days, data.today.day) : []), [data, selected]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const monthOptions = data.months.some((m) => m.month === data.currentMonth.month) ? data.months : [data.currentMonth, ...data.months];
  const monthTotals = monthOptions.find((m) => m.month === selected) ?? data.currentMonth;
  const chart = days.map((d) => ({ day: d.day, profit: d.profitBrlCents / 100 }));

  return (
    <>
      <PageHeader
        title="Lucro"
        subtitle={`Receita dos pedidos pagos menos o custo no fornecedor${data.usdBrlRate ? ` · dólar hoje R$ ${data.usdBrlRate.toFixed(4).replace(".", ",")}` : ""}`}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Stat label="Lucro hoje" value={fmtBRL(data.today.profitBrlCents)} tone={tone(data.today.profitBrlCents)} hint={`${data.today.orders} pedidos · receita ${fmtBRL(data.today.revenueBrlCents)}`} />
        <Stat
          label={`Lucro em ${monthLabel(data.currentMonth.month)}`}
          value={fmtBRL(data.currentMonth.profitBrlCents)}
          tone={tone(data.currentMonth.profitBrlCents)}
          hint={`Margem ${margin(data.currentMonth)} · receita ${fmtBRL(data.currentMonth.revenueBrlCents)}`}
        />
        <Stat label="Lucro total" value={fmtBRL(data.total.profitBrlCents)} tone={tone(data.total.profitBrlCents)} hint={`Margem ${margin(data.total)} · ${data.total.orders} pedidos`} />
        <Stat label="Receita total" value={fmtBRL(data.total.revenueBrlCents)} hint={`${data.total.units} unidades vendidas`} />
        <Stat label="Custo das vendas" value={fmtBRL(data.total.costBrlCents)} hint="Fornecedor, das unidades vendidas" />
        <Stat
          label="Total pago ao fornecedor"
          value={fmtBRL(data.supplierSpend.brlCents)}
          hint={`${fmtUSD(data.supplierSpend.usdCents)} em ${data.supplierSpend.purchases} compras (inclui estoque não vendido)`}
        />
      </div>

      {data.total.uncostedUnits > 0 && (
        <div className="mt-4">
          <Notice tone="warn">
            {data.total.uncostedUnits} unidade(s) vendida(s) sem custo conhecido — estoque adicionado manualmente ou pedido ainda não entregue. Elas entram com custo R$ 0, então o lucro
            real pode ser menor.
          </Notice>
        </div>
      )}

      <div className="mt-5 grid gap-4">
        <Card
          title={`Lucro por dia — ${monthLabel(selected)}`}
          actions={
            <select className="input w-auto py-1" value={selected} onChange={(e) => setMonth(e.target.value)} aria-label="Mês">
              {monthOptions.map((m) => (
                <option key={m.month} value={m.month}>
                  {monthLabel(m.month)}
                </option>
              ))}
            </select>
          }
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(8, 10)} {...axis} minTickGap={8} />
                <YAxis {...axis} width={48} />
                <Tooltip {...tooltipStyle} labelFormatter={(d) => fmtDay(String(d))} formatter={(v) => [fmtBRL(Math.round(Number(v) * 100)), "Lucro"]} />
                <Bar dataKey="profit" radius={[4, 4, 0, 0]} maxBarSize={18}>
                  {chart.map((d) => (
                    <Cell key={d.day} fill={d.profit < 0 ? "var(--color-bad)" : "var(--color-chart-1)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3">
            <Table>
              <Head first="Dia" />
              <tbody>
                {[...days].reverse().map((d) => (
                  <Row key={d.day} label={fmtDay(d.day)} t={d} />
                ))}
                <Row label="Total do mês" t={monthTotals} bold />
              </tbody>
            </Table>
          </div>
        </Card>

        <Card title="Lucro por mês">
          {data.months.length === 0 ? (
            <Empty>Nenhuma venda ainda.</Empty>
          ) : (
            <Table>
              <Head first="Mês" />
              <tbody>
                {data.months.map((m) => (
                  <Row key={m.month} label={monthLabel(m.month)} t={m} />
                ))}
                <Row label="Total geral" t={data.total} bold />
              </tbody>
            </Table>
          )}
          <p className="mt-2 text-xs text-muted">
            Custo = o que o fornecedor cobrou pelas unidades entregues, convertido pelo dólar do dia da compra. Taxas do Mercado Pago não são descontadas.
          </p>
        </Card>
      </div>
    </>
  );
}
