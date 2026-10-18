"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { api, fmtDate, money } from "@/lib/api";
import { userLabel } from "@/lib/types";
import { useApi, useAction } from "@/components/use-api";
import { useCan } from "@/components/admin-context";
import { OrderStatusBadge, TICKET_TYPE_LABELS, TicketStatusBadge } from "@/components/status";
import { Badge, Button, Card, cn, ErrorBox, Info, Loading, Notice, PageHeader } from "@/components/ui";
import { DeliveryCard, type Delivery } from "@/components/delivery-card";

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

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2560;

interface Attachment {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
  previewUrl: string;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Keeps small JPEG/PNG/WebP files as they are; anything else (or too big) is re-encoded as JPEG. */
async function prepareImage(file: File): Promise<Attachment> {
  if (!file.type.startsWith("image/")) throw new Error("O arquivo precisa ser uma imagem.");
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Não foi possível ler a imagem.");
  });
  const keep = ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= MAX_IMAGE_BYTES && Math.max(bitmap.width, bitmap.height) <= MAX_IMAGE_SIDE;
  let blob: Blob = file;
  if (!keep) {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao converter a imagem."))), "image/jpeg", 0.85));
    if (blob.size > MAX_IMAGE_BYTES) throw new Error("Imagem muito grande (máx. 3 MB).");
  }
  bitmap.close();
  return { contentType: keep ? (file.type as Attachment["contentType"]) : "image/jpeg", base64: await blobToBase64(blob), previewUrl: URL.createObjectURL(blob) };
}

export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading, reload, setData } = useApi<TicketDetail>(`/api/admin/support/${id}`);
  const canReply = useCan("STAFF");
  const action = useAction();
  const [text, setText] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [pickedOrder, setPickedOrder] = useState<string | null>(null);
  const deliveryOrderId = pickedOrder ?? data?.order?.id ?? null;
  const delivery = useApi<{ delivery: Delivery | null }>(canReply && deliveryOrderId ? `/api/admin/support/${id}/delivery?orderId=${encodeURIComponent(deliveryOrderId)}` : null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [data?.messages.length]);

  // Light polling so new customer messages show up while the ticket is open on screen.
  useEffect(() => {
    const timer = setInterval(() => void reload(), 20_000);
    return () => clearInterval(timer);
  }, [reload]);

  useEffect(() => () => {
    if (attachment) URL.revokeObjectURL(attachment.previewUrl);
  }, [attachment]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  async function send() {
    const body = text.trim();
    if (!body && !attachment) return;
    const image = attachment ? { contentType: attachment.contentType, base64: attachment.base64 } : undefined;
    const r = await action.run("reply", () => api<{ delivery: { delivered: boolean; error?: string }; ticket: TicketDetail }>(`/api/admin/support/${id}/reply`, { method: "POST", body: { text: body, image } }));
    if (!r) return;
    setData(r.ticket);
    setText("");
    setAttachment(null);
    if (r.delivery.delivered) action.setMessage("Resposta enviada ao cliente no Telegram.");
    else action.setError(`Resposta salva, mas não foi entregue no Telegram (o cliente pode ter bloqueado o bot): ${r.delivery.error ?? ""}`);
  }

  async function attach(file: File | undefined | null) {
    if (!file) return;
    try {
      setAttachment(await prepareImage(file));
    } catch (err) {
      action.setError(err instanceof Error ? err.message : String(err));
    }
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
        <div className="min-w-0 space-y-4">
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
                        <img src={`/api/admin/support/files/${m.id}`} alt={mine ? "Imagem enviada pelo suporte" : "Imagem enviada pelo cliente"} className="max-h-64 rounded-lg" loading="lazy" />
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
                onPaste={(e) => {
                  const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
                  if (file) {
                    e.preventDefault();
                    void attach(file);
                  }
                }}
              />
              {attachment && (
                <div className="flex items-start gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={attachment.previewUrl} alt="Imagem anexada" className="max-h-32 rounded-lg border border-line" />
                  <button type="button" onClick={() => setAttachment(null)} className="rounded-full border border-line px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-fg">
                    Remover
                  </button>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void attach(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">Ctrl+Enter para enviar · cole ou anexe uma imagem · {text.length}/3500</span>
                <span className="flex items-center gap-2">
                  <Button onClick={() => fileRef.current?.click()} disabled={action.busy === "reply"}>
                    📎 {attachment ? "Trocar imagem" : "Anexar imagem"}
                  </Button>
                  <Button variant="primary" onClick={() => void send()} loading={action.busy === "reply"} disabled={!text.trim() && !attachment}>
                    Enviar resposta
                  </Button>
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted">Seu papel (Visualizador) não permite responder.</p>
          )}
        </Card>

        {canReply && deliveryOrderId && (
          <DeliveryCard
            data={delivery.data?.delivery ?? null}
            loading={delivery.loading}
            error={delivery.error}
            onRetry={delivery.reload}
            title={deliveryOrderId === data.order?.id ? undefined : "outro pedido"}
          />
        )}
        </div>

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
                    <span className="flex shrink-0 items-center gap-1.5">
                      {canReply && ["PAID", "DELIVERED", "REFUNDED"].includes(o.status) && (
                        <button
                          type="button"
                          onClick={() => setPickedOrder(o.id)}
                          className={cn("rounded-full border px-2 py-0.5 text-[11px]", o.id === deliveryOrderId ? "border-accent text-fg" : "border-line text-muted hover:border-accent hover:text-fg")}
                        >
                          Ver entrega
                        </button>
                      )}
                      <OrderStatusBadge status={o.status} />
                    </span>
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
