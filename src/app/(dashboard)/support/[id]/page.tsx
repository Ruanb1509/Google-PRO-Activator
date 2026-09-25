"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { api, fmtDate, money } from "@/lib/api";
import { userLabel } from "@/lib/types";
import { useApi, useAction } from "@/components/use-api";
import { useCan } from "@/components/admin-context";
import { OrderStatusBadge, TICKET_TYPE_LABELS, TicketStatusBadge } from "@/components/status";
import { Badge, Button, Card, cn, ErrorBox, Info, Loading, Notice, PageHeader } from "@/components/ui";

interface Message {
  id: string;
  author: "CUSTOMER" | "SUPPORT";
  text: string;
  hasImage: boolean;
  createdAt: string;
  admin: { name: string; email: string } | null;
}

interface OrderSummary {
  id: string;
  number: number;
  productName: string;
  status: string;
  amountCents: number;
  currency: string;
  createdAt: string;
  paymentMethod?: string;
  deliveredAt?: string | null;
}

interface TicketDetail {
  id: string;
  number: number;
  type: "PRE_SALE" | "POST_SALE";
  status: "OPEN" | "ANSWERED" | "CLOSED";
  createdAt: string;
  closedAt: string | null;
  user: { id: string; telegramId: string; username: string | null; firstName: string | null; locale: string | null; country: string | null; balanceCents: number; createdAt: string };
  order: OrderSummary | null;
  messages: Message[];
  recentOrders: OrderSummary[];
}

const QUICK_REPLIES = [
  "Olá! Obrigado pelo contato. Vou verificar e já te retorno.",
  "Seu pagamento ainda não foi confirmado pelo provedor. Assim que confirmar, a entrega é automática.",
  "Seu pedido foi entregue. Você encontra o acesso em 📦 Meus pedidos, dentro do pedido.",
  "Resolvido! Se precisar de mais alguma coisa, é só chamar.",
];

export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading, reload, setData } = useApi<TicketDetail>(`/api/admin/support/${id}`);
  const canReply = useCan("STAFF");
  const action = useAction();
  const [text, setText] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [data?.messages.length]);

  // Light polling so new customer messages show up while the ticket is open on screen.
  useEffect(() => {
    const timer = setInterval(() => void reload(), 20_000);
    return () => clearInterval(timer);
  }, [reload]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  async function send() {
    const body = text.trim();
    if (!body) return;
    const r = await action.run("reply", () => api<{ delivery: { delivered: boolean; error?: string }; ticket: TicketDetail }>(`/api/admin/support/${id}/reply`, { method: "POST", body: { text: body } }));
    if (!r) return;
    setData(r.ticket);
    setText("");
    if (r.delivery.delivered) action.setMessage("Resposta enviada ao cliente no Telegram.");
    else action.setError(`Resposta salva, mas não foi entregue no Telegram (o cliente pode ter bloqueado o bot): ${r.delivery.error ?? ""}`);
  }

  async function setStatus(status: "OPEN" | "CLOSED") {
    const r = await action.run("status", () => api<{ ticket: TicketDetail }>(`/api/admin/support/${id}/status`, { method: "POST", body: { status } }), status === "CLOSED" ? "Ticket encerrado." : "Ticket reaberto.");
    if (r) setData(r.ticket);
  }

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Ticket #{data.number} <TicketStatusBadge status={data.status} />
            <Badge tone={data.type === "PRE_SALE" ? "info" : "accent"}>{TICKET_TYPE_LABELS[data.type]}</Badge>
          </span>
        }
        subtitle={
          <>
            <Link href="/support" className="hover:underline">
              ← Suporte
            </Link>{" "}
            · aberto em {fmtDate(data.createdAt)}
          </>
        }
        actions={
          canReply &&
          (data.status === "CLOSED" ? (
            <Button onClick={() => setStatus("OPEN")} loading={action.busy === "status"}>
              Reabrir
            </Button>
          ) : (
            <Button onClick={() => setStatus("CLOSED")} loading={action.busy === "status"}>
              Encerrar ticket
            </Button>
          ))
        }
      />
      {action.error && <div className="mb-3"><ErrorBox error={action.error} /></div>}
      {action.message && <div className="mb-3"><Notice>{action.message}</Notice></div>}

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card title="Conversa">
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {data.messages.map((m) => {
              const mine = m.author === "SUPPORT";
              return (
                <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm", mine ? "bg-accent text-accent-fg" : "border border-line bg-card-2")}>
                    {m.hasImage && (
                      <button type="button" onClick={() => setZoom(`/api/admin/support/files/${m.id}`)} className="mb-2 block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/admin/support/files/${m.id}`} alt="Imagem enviada pelo cliente" className="max-h-64 rounded-lg" loading="lazy" />
                      </button>
                    )}
                    {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                    <p className={cn("mt-1 text-[11px]", mine ? "text-accent-fg/80" : "text-muted")}>
                      {mine ? (m.admin?.name ?? "Suporte") : userLabel(data.user)} · {fmtDate(m.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          {canReply ? (
            <div className="mt-4 space-y-2 border-t border-line pt-4">
              <div className="flex flex-wrap gap-1.5">
                {QUICK_REPLIES.map((qr) => (
                  <button key={qr} type="button" onClick={() => setText(qr)} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-fg">
                    {qr.length > 42 ? `${qr.slice(0, 42)}…` : qr}
                  </button>
                ))}
              </div>
              <textarea
                className="input min-h-28"
                placeholder={data.status === "CLOSED" ? "Responder reabre o ticket…" : "Escreva a resposta — ela chega ao cliente pelo bot"}
                maxLength={3500}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send();
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">Ctrl+Enter para enviar · {text.length}/3500</span>
                <Button variant="primary" onClick={() => void send()} loading={action.busy === "reply"} disabled={!text.trim()}>
                  Enviar resposta
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">Seu papel (Visualizador) não permite responder.</p>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Cliente">
            <div className="space-y-2 text-sm">
              <Info label="Cliente" value={<Link href={`/customers/${data.user.id}`} className="text-accent hover:underline">{userLabel(data.user)}</Link>} />
              <Info label="Telegram ID" value={<span className="font-mono">{data.user.telegramId}</span>} />
              <Info label="Idioma" value={data.user.locale === "pt_BR" ? "Português" : data.user.locale === "en_US" ? "English" : "—"} />
              <Info label="País" value={data.user.country ?? "—"} />
              <Info label="Saldo" value={money(data.user.balanceCents, "USD")} />
              <Info label="Cliente desde" value={fmtDate(data.user.createdAt)} />
            </div>
          </Card>
          {data.order && (
            <Card title={`Pedido do ticket #${data.order.number}`}>
              <div className="space-y-2 text-sm">
                <Info label="Produto" value={data.order.productName} />
                <Info label="Valor" value={money(data.order.amountCents, data.order.currency)} />
                <Info label="Status" value={<OrderStatusBadge status={data.order.status} />} />
                <Info label="Data" value={fmtDate(data.order.createdAt)} />
                <Link href={`/orders/${data.order.id}`} className="inline-block text-accent hover:underline">
                  Abrir pedido →
                </Link>
              </div>
            </Card>
          )}
          <Card title="Pedidos recentes">
            {data.recentOrders.length ? (
              <ul className="space-y-2 text-sm">
                {data.recentOrders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2">
                    <Link href={`/orders/${o.id}`} className="truncate hover:underline">
                      #{o.number} · {o.productName}
                    </Link>
                    <OrderStatusBadge status={o.status} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nenhum pedido.</p>
            )}
          </Card>
        </div>
      </div>

      {zoom && (
        <button type="button" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setZoom(null)} aria-label="Fechar imagem">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="Imagem ampliada" className="max-h-full max-w-full rounded-lg" />
        </button>
      )}
    </>
  );
}
