"use client";

import Link from "next/link";
import { useState } from "react";
import { fmtDate } from "@/lib/api";
import { OrderStatusBadge } from "@/components/status";
import { Button, Card, cn, ErrorBox, Info, Loading } from "@/components/ui";

export interface Delivery {
  orderId: string;
  number: number;
  productName: string;
  quantity: number;
  status: string;
  paidAt: string | null;
  deliveredAt: string | null;
  deliveryError: string | null;
  locale: "pt_BR" | "en_US";
  items: string[];
  messageHtml: string | null;
  events: { type: string; actorType: string; message: string | null; createdAt: string }[];
}

function deliveryEventLabel(e: Delivery["events"][number]): string {
  if (e.type === "DELIVERY_FAILED") return `Falha ao enviar a mensagem${e.message ? `: ${e.message}` : ""}`;
  if (e.type === "DELIVERY_RESENT") return "Mensagem de entrega reenviada pela equipe";
  if (e.actorType === "BOT") return "Acesso exibido ao cliente em 📦 Meus pedidos";
  return "Mensagem de entrega enviada pelo bot no Telegram";
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copiado" : "Copiar"}
    </Button>
  );
}

/** What the customer received, unmasked: the links/codes and the bot message exactly as it was sent. */
export function DeliveryCard({
  data,
  loading,
  error,
  onRetry,
  title,
  orderLink = true,
}: {
  data: Delivery | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  title?: string;
  orderLink?: boolean;
}) {
  return (
    <Card
      title={data ? `O que o cliente recebeu · pedido #${data.number}${title ? ` (${title})` : ""}` : "O que o cliente recebeu"}
      actions={
        data &&
        orderLink && (
          <Link href={`/orders/${data.orderId}`} className="text-sm text-accent hover:underline">
            Abrir pedido →
          </Link>
        )
      }
    >
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} onRetry={onRetry} />
      ) : !data ? null : (
        <div className="space-y-4 text-sm">
          <div className="grid gap-2 sm:grid-cols-4">
            <Info label="Produto" value={`${data.productName} (x${data.quantity})`} />
            <Info label="Status" value={<OrderStatusBadge status={data.status} />} />
            <Info label="Pago em" value={data.paidAt ? fmtDate(data.paidAt) : "—"} />
            <Info label="Entregue em" value={data.deliveredAt ? fmtDate(data.deliveredAt) : "—"} />
          </div>

          <div>
            <p className="mb-1.5 text-xs text-muted">{data.items.length > 1 ? `Itens entregues (${data.items.length}/${data.quantity})` : "Item entregue"}</p>
            {data.items.length ? (
              <ul className="space-y-1.5">
                {data.items.map((v, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-lg border border-line bg-card-2 px-3 py-2">
                    {data.items.length > 1 && <span className="shrink-0 text-xs text-muted">{i + 1}.</span>}
                    {/^https?:\/\//i.test(v) ? (
                      <a href={v} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 break-all font-mono text-xs text-accent hover:underline">
                        {v}
                      </a>
                    ) : (
                      <span className="min-w-0 flex-1 break-all font-mono text-xs">{v}</span>
                    )}
                    <CopyButton value={v} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">Nenhum item foi atribuído a este pedido ainda.</p>
            )}
          </div>

          {data.messageHtml && (
            <div>
              <p className="mb-1.5 text-xs text-muted">Mensagem que o cliente recebeu no Telegram ({data.locale === "pt_BR" ? "Português" : "English"})</p>
              <div
                className="max-w-md whitespace-pre-wrap break-words rounded-2xl rounded-tl-sm border border-line bg-card-2 px-3.5 py-2.5 [&_code]:rounded [&_code]:bg-card [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs"
                // Built server-side from our own template; every interpolated value is HTML-escaped.
                dangerouslySetInnerHTML={{ __html: data.messageHtml }}
              />
            </div>
          )}

          <div>
            <p className="mb-1.5 text-xs text-muted">Como foi entregue</p>
            {data.events.length ? (
              <ul className="space-y-1">
                {data.events.map((e, i) => (
                  <li key={i} className={cn("flex gap-2", e.type === "DELIVERY_FAILED" && "text-bad")}>
                    <span className="shrink-0 text-muted">{fmtDate(e.createdAt)}</span>
                    <span>{deliveryEventLabel(e)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">{data.deliveryError ? `Ainda não entregue: ${data.deliveryError}` : "Ainda não houve entrega."}</p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
