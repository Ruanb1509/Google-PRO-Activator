"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtDate, money, qs, type Paged } from "@/lib/api";
import { userLabel, type MiniUser } from "@/lib/types";
import { useApi } from "@/components/use-api";
import { InventoryStatusBadge, OrderStatusBadge } from "@/components/status";
import { Card, cn, Empty, ErrorBox, Loading, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";

interface OrderRow {
  id: string;
  number: number;
  user: MiniUser;
  productName: string;
  country: string | null;
  currency: string;
  amountCents: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
  deliveredAt: string | null;
  payment: { provider: string; status: string; providerPaymentId: string | null } | null;
  inventoryItem: { id: string; valuePreview: string; status: string } | null;
}

const FILTERS: { key: string; label: string; status?: string; delivered?: "yes" | "no" }[] = [
  { key: "all", label: "Todos" },
  { key: "PAID", label: "Pago", status: "PAID" },
  { key: "DELIVERED", label: "Entregue", status: "DELIVERED" },
  { key: "PENDING", label: "Pendente", status: "PENDING" },
  { key: "FAILED", label: "Falhou", status: "FAILED" },
  { key: "EXPIRED", label: "Expirado", status: "EXPIRED" },
  { key: "REFUNDED", label: "Reembolsado", status: "REFUNDED" },
  { key: "CANCELLED", label: "Cancelado", status: "CANCELLED" },
  { key: "undelivered", label: "Não entregue", delivered: "no" },
];

export default function OrdersPage() {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [page, setPage] = useState(1);
  const [userId, setUserId] = useState<string | undefined>();

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const s = sp.get("status");
    if (s && FILTERS.some((f) => f.key === s)) setFilter(s);
    setUserId(sp.get("userId") ?? undefined);
  }, []);

  const f = FILTERS.find((x) => x.key === filter)!;
  const { data, error, loading, reload } = useApi<Paged<OrderRow>>(
    `/api/admin/orders${qs({ status: f.status, delivered: f.delivered, q, userId, page, pageSize: 25 })}`,
  );

  return (
    <>
      <PageHeader title="Pedidos" subtitle="Todos os pedidos do bot, com status de pagamento e entrega" />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((x) => (
            <button
              key={x.key}
              onClick={() => {
                setFilter(x.key);
                setPage(1);
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition",
                filter === x.key ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-fg",
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(qInput.trim());
            setPage(1);
          }}
        >
          <input className="input lg:w-72" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Nº, Telegram ID, @usuário, ID do pagamento" />
        </form>
      </div>
      {userId && (
        <div className="mb-3 text-sm text-muted">
          Filtrando por cliente. <button className="text-accent hover:underline" onClick={() => setUserId(undefined)}>Limpar</button>
        </div>
      )}

      <Card>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : !data?.items.length ? (
          <Empty>Nenhum pedido encontrado.</Empty>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>ID</Th>
                  <Th>Cliente</Th>
                  <Th>Telegram ID</Th>
                  <Th>Produto</Th>
                  <Th>País</Th>
                  <Th>Moeda</Th>
                  <Th>Valor</Th>
                  <Th>Método</Th>
                  <Th>Status</Th>
                  <Th>Data</Th>
                  <Th>Item entregue</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o.id} className="hover:bg-card-2">
                    <Td>
                      <Link href={`/orders/${o.id}`} className="font-medium text-accent hover:underline">
                        #{o.number}
                      </Link>
                    </Td>
                    <Td>
                      <Link href={`/customers/${o.user.id}`} className="hover:underline">
                        {userLabel(o.user)}
                      </Link>
                    </Td>
                    <Td className="font-mono text-xs">{o.user.telegramId}</Td>
                    <Td>{o.productName}</Td>
                    <Td>{o.country ?? "—"}</Td>
                    <Td>{o.currency}</Td>
                    <Td className="whitespace-nowrap tabular-nums">{money(o.amountCents, o.currency)}</Td>
                    <Td>
                      {o.paymentMethod}
                      {o.payment && <div className="text-xs text-muted">{o.payment.provider}</div>}
                    </Td>
                    <Td>
                      <OrderStatusBadge status={o.status} />
                    </Td>
                    <Td className="whitespace-nowrap">{fmtDate(o.createdAt)}</Td>
                    <Td>
                      {o.inventoryItem ? (
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono text-xs">{o.inventoryItem.valuePreview}</span>
                          {o.inventoryItem.status !== "SOLD" && <InventoryStatusBadge status={o.inventoryItem.status} />}
                        </span>
                      ) : (
                        "—"
                      )}
                      {o.deliveredAt && <div className="text-xs text-muted">{fmtDate(o.deliveredAt)}</div>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
