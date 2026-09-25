"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { api, fmtDate, money } from "@/lib/api";
import { userLabel } from "@/lib/types";
import { useAction, useApi } from "@/components/use-api";
import { useCan } from "@/components/admin-context";
import { InventoryStatusBadge, OrderStatusBadge, PaymentStatusBadge } from "@/components/status";
import { Badge, Button, Card, ErrorBox, Info, JsonView, LinkButton, Loading, Notice, PageHeader } from "@/components/ui";

interface OrderDetail {
  id: string;
  number: number;
  status: string;
  productName: string;
  currency: string;
  amountCents: number;
  paymentMethod: string;
  country: string | null;
  locale: string;
  expiresAt: string;
  paidAt: string | null;
  deliveredAt: string | null;
  deliveryAttempts: number;
  deliveryError: string | null;
  refundedAt: string | null;
  createdAt: string;
  user: { id: string; telegramId: string; username: string | null; firstName: string | null; locale: string | null; country: string | null };
  product: { id: string; name: string };
  payment: {
    id: string;
    provider: string;
    providerPaymentId: string | null;
    providerReference: string | null;
    status: string;
    currency: string;
    amountCents: number;
    checkoutUrl: string | null;
    country: string | null;
    paidAt: string | null;
    createdAt: string;
    events: { id: string; eventId: string; eventType: string; signatureValid: boolean; processedAt: string | null; error: string | null; createdAt: string }[];
  } | null;
  inventoryItem: { id: string; valuePreview: string; status: string; soldAt: string | null } | null;
  events: { id: string; type: string; message: string | null; actorType: string; createdAt: string; details: unknown }[];
  ledger: { id: string; type: string; amountCents: number; balanceAfterCents: number; createdAt: string }[];
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload, setData } = useApi<OrderDetail>(`/api/admin/orders/${id}`);
  const canStaff = useCan("STAFF");
  const isAdmin = useCan("ADMIN");
  const action = useAction();

  async function run(kind: "sync" | "resend" | "fulfill" | "refund", success: string) {
    if (kind === "refund" && !confirm("Reembolsar este pedido pelo gateway de pagamento? O item entregue NÃO volta ao estoque.")) return;
    const r = await action.run(kind, () => api<{ order: OrderDetail }>(`/api/admin/orders/${id}/${kind}`, { method: "POST" }), success);
    if (r?.order) setData(r.order);
    else await reload();
  }

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  const paidLike = data.status === "PAID" || data.status === "DELIVERED";

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            Pedido #{data.number} <OrderStatusBadge status={data.status} />
          </span>
        }
        subtitle={`Criado em ${fmtDate(data.createdAt)}`}
        actions={<LinkButton href="/orders">← Pedidos</LinkButton>}
      />

      {canStaff && (
        <div className="mb-4 flex flex-wrap gap-2">
          {data.payment?.providerPaymentId && (
            <Button onClick={() => run("sync", "Status consultado no provedor.")} loading={action.busy === "sync"}>
              🔄 Verificar pagamento
            </Button>
          )}
          {paidLike && data.inventoryItem && (
            <Button onClick={() => run("resend", "Entrega reenviada.")} loading={action.busy === "resend"}>
              📨 Reenviar entrega
            </Button>
          )}
          {data.status === "PAID" && !data.inventoryItem && (
            <Button variant="primary" onClick={() => run("fulfill", "Item atribuído e entregue.")} loading={action.busy === "fulfill"}>
              📦 Atribuir estoque e entregar
            </Button>
          )}
          {isAdmin && paidLike && (
            <Button variant="danger" onClick={() => run("refund", "Reembolso solicitado.")} loading={action.busy === "refund"}>
              ↩️ Reembolsar
            </Button>
          )}
        </div>
      )}
      {action.error && <div className="mb-3"><ErrorBox error={action.error} /></div>}
      {action.message && <div className="mb-3"><Notice>{action.message}</Notice></div>}
      {data.status === "PAID" && !data.inventoryItem && (
        <div className="mb-3">
          <Notice tone="bad">Pedido pago sem item: o estoque acabou antes da entrega. Reponha o estoque e use “Atribuir estoque e entregar”, ou reembolse.</Notice>
        </div>
      )}
      {data.deliveryError && data.status === "PAID" && (
        <div className="mb-3">
          <Notice tone="warn">
            Falha na entrega ({data.deliveryAttempts} tentativa(s)): {data.deliveryError}
          </Notice>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Pedido">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Info label="ID" value={<span className="break-all font-mono text-xs">{data.id}</span>} />
            <Info label="Produto" value={<Link className="text-accent hover:underline" href={`/products/${data.product.id}`}>{data.productName}</Link>} />
            <Info label="Valor" value={money(data.amountCents, data.currency)} />
            <Info label="Moeda" value={data.currency} />
            <Info label="Método" value={data.paymentMethod} />
            <Info label="País" value={data.country ?? "—"} />
            <Info label="Idioma" value={data.locale} />
            <Info label="Expira em" value={fmtDate(data.expiresAt)} />
            <Info label="Pago em" value={fmtDate(data.paidAt)} />
            <Info label="Entregue em" value={fmtDate(data.deliveredAt)} />
            <Info label="Tentativas de entrega" value={data.deliveryAttempts} />
            <Info label="Reembolsado em" value={fmtDate(data.refundedAt)} />
          </dl>
        </Card>

        <Card title="Cliente e item">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Info label="Cliente" value={<Link className="text-accent hover:underline" href={`/customers/${data.user.id}`}>{userLabel(data.user)}</Link>} />
            <Info label="Telegram ID" value={<span className="font-mono text-xs">{data.user.telegramId}</span>} />
            <Info
              label="Item entregue"
              value={
                data.inventoryItem ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{data.inventoryItem.valuePreview}</span>
                    <InventoryStatusBadge status={data.inventoryItem.status} />
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Info label="Vendido em" value={fmtDate(data.inventoryItem?.soldAt)} />
          </dl>
          {data.ledger.length > 0 && (
            <div className="mt-4">
              <div className="label">Movimentações de saldo</div>
              <ul className="space-y-1 text-sm">
                {data.ledger.map((l) => (
                  <li key={l.id} className="flex justify-between">
                    <span>{l.type}</span>
                    <span className="tabular-nums">
                      {money(l.amountCents, "USD")} → {money(l.balanceAfterCents, "USD")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Pagamento">
          {!data.payment ? (
            <p className="text-sm text-muted">Sem pagamento.</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Info label="Provedor" value={data.payment.provider} />
                <Info label="Status" value={<PaymentStatusBadge status={data.payment.status} />} />
                <Info label="ID no provedor" value={<span className="break-all font-mono text-xs">{data.payment.providerPaymentId ?? "—"}</span>} />
                <Info label="Referência" value={<span className="break-all font-mono text-xs">{data.payment.providerReference ?? "—"}</span>} />
                <Info label="Valor" value={money(data.payment.amountCents, data.payment.currency)} />
                <Info label="País (provedor)" value={data.payment.country ?? "—"} />
                <Info label="Pago em" value={fmtDate(data.payment.paidAt)} />
              </dl>
              <div className="mt-4">
                <div className="label">Webhooks recebidos</div>
                {data.payment.events.length === 0 ? (
                  <p className="text-sm text-muted">Nenhum webhook.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {data.payment.events.map((e) => (
                      <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {e.eventType} <span className="text-xs text-muted">{fmtDate(e.createdAt)}</span>
                        </span>
                        <span className="flex gap-1">
                          {e.signatureValid ? <Badge tone="ok">assinatura ok</Badge> : <Badge tone="bad">assinatura inválida</Badge>}
                          {e.error ? <Badge tone="bad">{e.error}</Badge> : e.processedAt ? <Badge tone="ok">processado</Badge> : <Badge tone="warn">pendente</Badge>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </Card>

        <Card title="Histórico de eventos">
          <ol className="space-y-3 border-l border-line pl-4 text-sm">
            {data.events.map((e) => (
              <li key={e.id}>
                <div className="font-medium">{e.type}</div>
                <div className="text-xs text-muted">
                  {fmtDate(e.createdAt)} · {e.actorType}
                </div>
                {e.message && <div className="text-xs">{e.message}</div>}
                {e.details != null && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted">detalhes</summary>
                    <JsonView value={e.details} />
                  </details>
                )}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
