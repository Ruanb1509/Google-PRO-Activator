"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, fmtDate, fmtUSD, money, toCents } from "@/lib/api";
import { userLabel } from "@/lib/types";
import { useAction, useApi } from "@/components/use-api";
import { useCan } from "@/components/admin-context";
import { DepositStatusBadge, OrderStatusBadge } from "@/components/status";
import { Badge, Button, Card, Empty, ErrorBox, Field, Info, LinkButton, Loading, Notice, PageHeader, Table, Td, Th } from "@/components/ui";

const LOCALE_LABELS: Record<string, string> = { pt_BR: "🇧🇷 Português", en_US: "🇺🇸 English" };

interface CustomerDetail {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  languageCode: string | null;
  locale: string | null;
  country: string | null;
  balanceCents: number;
  isBlocked: boolean;
  createdAt: string;
  lastSeenAt: string;
  orders: { id: string; number: number; productName: string; status: string; amountCents: number; currency: string; paymentMethod: string; createdAt: string }[];
  deposits: { id: string; status: string; expectedCents: number; creditedCents: number | null; asset: string; providerTxId: string | null; createdAt: string }[];
  ledger: { id: string; type: string; amountCents: number; balanceAfterCents: number; note: string | null; orderId: string | null; createdAt: string }[];
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<CustomerDetail>(`/api/admin/customers/${id}`);
  const canStaff = useCan("STAFF");
  const isAdmin = useCan("ADMIN");
  const action = useAction();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  async function toggleBlock() {
    if (!data) return;
    await action.run("block", () => api(`/api/admin/customers/${data.id}`, { method: "PATCH", body: { isBlocked: !data.isBlocked } }), data.isBlocked ? "Cliente desbloqueado." : "Cliente bloqueado.");
    await reload();
  }

  async function adjust(e: FormEvent) {
    e.preventDefault();
    const cents = toCents(amount);
    if (!cents) return action.setError("Valor inválido (use negativo para debitar).");
    if (!confirm(`${cents > 0 ? "Creditar" : "Debitar"} ${fmtUSD(Math.abs(cents))} no saldo deste cliente?`)) return;
    const r = await action.run("balance", () => api(`/api/admin/customers/${id}/balance`, { method: "POST", body: { amountCents: cents, note } }), "Saldo ajustado.");
    if (r) {
      setAmount("");
      setNote("");
      await reload();
    }
  }

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {userLabel(data)} {data.isBlocked && <Badge tone="bad">Bloqueado</Badge>}
          </span>
        }
        subtitle={`Telegram ID ${data.telegramId}`}
        actions={
          <>
            <LinkButton href="/customers">← Clientes</LinkButton>
            {canStaff && (
              <Button variant={data.isBlocked ? "secondary" : "danger"} onClick={toggleBlock} loading={action.busy === "block"}>
                {data.isBlocked ? "Desbloquear" : "Bloquear"}
              </Button>
            )}
          </>
        }
      />
      {action.error && <div className="mb-3"><ErrorBox error={action.error} /></div>}
      {action.message && <div className="mb-3"><Notice>{action.message}</Notice></div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Dados">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Info label="Username" value={data.username ? `@${data.username}` : "—"} />
            <Info label="Nome" value={data.firstName ?? "—"} />
            <Info label="País" value={data.country ?? "—"} />
            <Info label="Idioma" value={data.locale ? LOCALE_LABELS[data.locale] : `${data.languageCode ?? "—"} (não escolhido)`} />
            <Info label="Primeiro acesso" value={fmtDate(data.createdAt)} />
            <Info label="Última atividade" value={fmtDate(data.lastSeenAt)} />
            <Info label="Saldo" value={<b>{fmtUSD(data.balanceCents)}</b>} />
            <Info label="Pedidos" value={<Link className="text-accent hover:underline" href={`/orders?userId=${data.id}`}>{data.orders.length} (ver todos)</Link>} />
          </dl>
          {isAdmin && (
            <form onSubmit={adjust} className="mt-5 space-y-2 border-t border-line pt-4">
              <div className="text-sm font-medium">Ajuste manual de saldo (USD)</div>
              <Field label="Valor" hint="Positivo credita, negativo debita. Ex.: 5,00 ou -2,50">
                <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </Field>
              <Field label="Motivo">
                <input className="input" minLength={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} required />
              </Field>
              <Button type="submit" variant="primary" size="sm" loading={action.busy === "balance"}>
                Aplicar ajuste
              </Button>
            </form>
          )}
        </Card>

        <Card title="Pedidos" className="lg:col-span-2">
          {!data.orders.length ? (
            <Empty>Nenhum pedido.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Pedido</Th>
                  <Th>Produto</Th>
                  <Th>Valor</Th>
                  <Th>Método</Th>
                  <Th>Status</Th>
                  <Th>Data</Th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.id}>
                    <Td>
                      <Link href={`/orders/${o.id}`} className="text-accent hover:underline">#{o.number}</Link>
                    </Td>
                    <Td>{o.productName}</Td>
                    <Td className="whitespace-nowrap">{money(o.amountCents, o.currency)}</Td>
                    <Td>{o.paymentMethod}</Td>
                    <Td><OrderStatusBadge status={o.status} /></Td>
                    <Td className="whitespace-nowrap">{fmtDate(o.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Depósitos (Binance Pay)" className="lg:col-span-3">
          {!data.deposits.length ? (
            <Empty>Nenhum depósito.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Data</Th>
                  <Th>Esperado</Th>
                  <Th>Creditado</Th>
                  <Th>Transação</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {data.deposits.map((d) => (
                  <tr key={d.id}>
                    <Td className="whitespace-nowrap">{fmtDate(d.createdAt)}</Td>
                    <Td>{(d.expectedCents / 100).toFixed(2)} {d.asset}</Td>
                    <Td>{d.creditedCents != null ? `${(d.creditedCents / 100).toFixed(2)} ${d.asset}` : "—"}</Td>
                    <Td className="font-mono text-xs">{d.providerTxId ?? "—"}</Td>
                    <Td><DepositStatusBadge status={d.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Extrato de saldo" className="lg:col-span-3">
          {!data.ledger.length ? (
            <Empty>Sem movimentações.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Data</Th>
                  <Th>Tipo</Th>
                  <Th>Valor</Th>
                  <Th>Saldo após</Th>
                  <Th>Observação</Th>
                </tr>
              </thead>
              <tbody>
                {data.ledger.map((l) => (
                  <tr key={l.id}>
                    <Td className="whitespace-nowrap">{fmtDate(l.createdAt)}</Td>
                    <Td>{l.type}</Td>
                    <Td className={l.amountCents < 0 ? "text-bad tabular-nums" : "text-ok tabular-nums"}>{fmtUSD(l.amountCents)}</Td>
                    <Td className="tabular-nums">{fmtUSD(l.balanceAfterCents)}</Td>
                    <Td>{l.note ?? "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
