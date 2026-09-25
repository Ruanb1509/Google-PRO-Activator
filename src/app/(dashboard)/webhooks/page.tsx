"use client";

import Link from "next/link";
import { useState } from "react";
import { fmtDate, qs, type Paged } from "@/lib/api";
import { useApi } from "@/components/use-api";
import { Badge, Button, Card, Empty, ErrorBox, Field, Loading, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";

interface EventRow {
  id: string;
  provider: string;
  eventId: string;
  eventType: string;
  signatureValid: boolean;
  processedAt: string | null;
  error: string | null;
  createdAt: string;
  payment: { orderId: string; order: { number: number } } | null;
}

export default function WebhooksPage() {
  const [provider, setProvider] = useState("");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<Paged<EventRow>>(`/api/admin/webhooks${qs({ provider, onlyErrors: onlyErrors ? "true" : undefined, page, pageSize: 50 })}`);

  return (
    <>
      <PageHeader
        title="Webhooks"
        subtitle="Monitoramento das notificações recebidas dos provedores de pagamento. Webhooks com assinatura inválida são rejeitados e registrados na auditoria."
        actions={<Button onClick={reload}>↻ Atualizar</Button>}
      />
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Provedor">
            <select
              className="input"
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              <option value="mercadopago">Mercado Pago</option>
              <option value="stripe">Stripe</option>
              <option value="mock">Mock (teste)</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={onlyErrors}
              onChange={(e) => {
                setOnlyErrors(e.target.checked);
                setPage(1);
              }}
            />
            Somente com erro / não processados
          </label>
        </div>
      </Card>
      <Card>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : !data?.items.length ? (
          <Empty>Nenhum webhook recebido.</Empty>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Recebido</Th>
                  <Th>Provedor</Th>
                  <Th>Evento</Th>
                  <Th>ID do evento</Th>
                  <Th>Pedido</Th>
                  <Th>Assinatura</Th>
                  <Th>Processamento</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.id} className="hover:bg-card-2">
                    <Td className="whitespace-nowrap">{fmtDate(e.createdAt)}</Td>
                    <Td>{e.provider}</Td>
                    <Td>{e.eventType}</Td>
                    <Td className="max-w-48 truncate font-mono text-xs" >{e.eventId}</Td>
                    <Td>
                      {e.payment ? (
                        <Link href={`/orders/${e.payment.orderId}`} className="text-accent hover:underline">
                          #{e.payment.order.number}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>{e.signatureValid ? <Badge tone="ok">válida</Badge> : <Badge tone="bad">inválida</Badge>}</Td>
                    <Td>
                      {e.error ? (
                        <Badge tone="bad">{e.error}</Badge>
                      ) : e.processedAt ? (
                        <Badge tone="ok">processado {fmtDate(e.processedAt)}</Badge>
                      ) : (
                        <Badge tone="warn">pendente</Badge>
                      )}
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
