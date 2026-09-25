"use client";

import Link from "next/link";
import { useState } from "react";
import { fmtBRL, fmtDate, fmtUSD, qs, type Paged } from "@/lib/api";
import { userLabel } from "@/lib/types";
import { useApi } from "@/components/use-api";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";

interface CustomerRow {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  country: string | null;
  locale: string | null;
  languageCode: string | null;
  createdAt: string;
  lastSeenAt: string;
  balanceCents: number;
  isBlocked: boolean;
  purchases: number;
  spentBrlCents: number;
  spentUsdCents: number;
}

const LOCALE_LABELS: Record<string, string> = { pt_BR: "🇧🇷 Português", en_US: "🇺🇸 English" };

export default function CustomersPage() {
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<Paged<CustomerRow>>(`/api/admin/customers${qs({ q, page, pageSize: 25 })}`);

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Somente os dados necessários para operar a loja são armazenados."
        actions={
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQ(qInput.trim());
              setPage(1);
            }}
          >
            <input className="input sm:w-72" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="@usuário, nome ou Telegram ID" />
          </form>
        }
      />
      <Card>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : !data?.items.length ? (
          <Empty>Nenhum cliente encontrado.</Empty>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Cliente</Th>
                  <Th>Telegram ID</Th>
                  <Th>Nome</Th>
                  <Th>País</Th>
                  <Th>Idioma</Th>
                  <Th>Primeiro acesso</Th>
                  <Th>Última atividade</Th>
                  <Th>Compras</Th>
                  <Th>Total gasto</Th>
                  <Th>Saldo</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} className="hover:bg-card-2">
                    <Td>
                      <Link href={`/customers/${c.id}`} className="font-medium text-accent hover:underline">
                        {userLabel(c)}
                      </Link>
                      {c.isBlocked && <Badge tone="bad" className="ml-2">Bloqueado</Badge>}
                    </Td>
                    <Td className="font-mono text-xs">{c.telegramId}</Td>
                    <Td>{c.firstName ?? "—"}</Td>
                    <Td>{c.country ?? "—"}</Td>
                    <Td>{c.locale ? LOCALE_LABELS[c.locale] : <span className="text-muted">{c.languageCode ?? "—"}</span>}</Td>
                    <Td className="whitespace-nowrap">{fmtDate(c.createdAt)}</Td>
                    <Td className="whitespace-nowrap">{fmtDate(c.lastSeenAt)}</Td>
                    <Td className="tabular-nums">{c.purchases}</Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      {c.spentBrlCents > 0 && <div>{fmtBRL(c.spentBrlCents)}</div>}
                      {c.spentUsdCents > 0 && <div>{fmtUSD(c.spentUsdCents)}</div>}
                      {!c.spentBrlCents && !c.spentUsdCents && "—"}
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">{fmtUSD(c.balanceCents)}</Td>
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
