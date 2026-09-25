"use client";

import Link from "next/link";
import { useState } from "react";
import { fmtDate, qs, type Paged } from "@/lib/api";
import { userLabel, type MiniUser } from "@/lib/types";
import { useApi } from "@/components/use-api";
import { TICKET_STATUS_LABELS, TICKET_TYPE_LABELS, TicketStatusBadge } from "@/components/status";
import { Badge, Card, cn, Empty, ErrorBox, Loading, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";

interface TicketRow {
  id: string;
  number: number;
  type: "PRE_SALE" | "POST_SALE";
  status: "OPEN" | "ANSWERED" | "CLOSED";
  lastMessageAt: string;
  createdAt: string;
  user: MiniUser;
  order: { id: string; number: number; productName: string; status: string } | null;
  lastMessage: { text: string; author: "CUSTOMER" | "SUPPORT"; createdAt: string; telegramFileId: string | null } | null;
  messageCount: number;
}

type TicketList = Paged<TicketRow> & { counts: Partial<Record<TicketRow["status"], number>> };

export default function SupportPage() {
  const [status, setStatus] = useState("OPEN");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<TicketList>(`/api/admin/support${qs({ status, type, q: search, page, pageSize: 25 })}`);

  const chip = (active: boolean) =>
    cn("rounded-full border px-3 py-1 text-xs font-medium", active ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-fg");

  return (
    <>
      <PageHeader title="Suporte" subtitle="Tickets abertos pelos clientes no bot — dúvidas antes da compra e problemas com pedidos" />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {[["", "Todos"], ...Object.entries(TICKET_STATUS_LABELS)].map(([k, v]) => (
          <button
            key={k}
            onClick={() => {
              setStatus(k!);
              setPage(1);
            }}
            className={chip(status === k)}
          >
            {v}
            {k && data?.counts[k as TicketRow["status"]] ? <span className="ml-1 tabular-nums">({data.counts[k as TicketRow["status"]]})</span> : null}
          </button>
        ))}
        <span className="mx-1 w-px bg-line" aria-hidden />
        {[["", "Pré e pós-compra"], ...Object.entries(TICKET_TYPE_LABELS)].map(([k, v]) => (
          <button
            key={`t-${k}`}
            onClick={() => {
              setType(k!);
              setPage(1);
            }}
            className={chip(type === k)}
          >
            {v}
          </button>
        ))}
      </div>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
          setPage(1);
        }}
      >
        <input className="input max-w-md" placeholder="Buscar: nº do ticket/pedido, @usuário, Telegram ID ou texto" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="rounded-lg border border-line bg-card-2 px-3.5 py-2 text-sm font-medium hover:border-accent" type="submit">
          Buscar
        </button>
      </form>
      <Card>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : !data?.items.length ? (
          <Empty>{status === "OPEN" ? "Nenhum ticket aguardando resposta. 🎉" : "Nenhum ticket encontrado."}</Empty>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Ticket</Th>
                  <Th>Cliente</Th>
                  <Th>Tipo</Th>
                  <Th>Pedido</Th>
                  <Th>Última mensagem</Th>
                  <Th>Atividade</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((tk) => (
                  <tr key={tk.id} className="hover:bg-card-2">
                    <Td>
                      <Link href={`/support/${tk.id}`} className="font-medium text-accent hover:underline">
                        #{tk.number}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">{userLabel(tk.user)}</Td>
                    <Td>
                      <Badge tone={tk.type === "PRE_SALE" ? "info" : "accent"}>{TICKET_TYPE_LABELS[tk.type]}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {tk.order ? (
                        <Link href={`/orders/${tk.order.id}`} className="hover:underline">
                          #{tk.order.number}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="max-w-sm">
                      <Link href={`/support/${tk.id}`} className="block truncate hover:underline">
                        <span className="text-muted">{tk.lastMessage?.author === "SUPPORT" ? "Você: " : ""}</span>
                        {tk.lastMessage?.text || (tk.lastMessage?.telegramFileId ? "📎 Imagem" : "—")}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">{fmtDate(tk.lastMessageAt)}</Td>
                    <Td>
                      <TicketStatusBadge status={tk.status} />
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
