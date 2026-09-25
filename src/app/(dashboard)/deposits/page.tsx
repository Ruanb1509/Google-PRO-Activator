"use client";

import Link from "next/link";
import { useState } from "react";
import { fmtDate, qs, type Paged } from "@/lib/api";
import { userLabel, type MiniUser } from "@/lib/types";
import { useApi } from "@/components/use-api";
import { DEPOSIT_STATUS_LABELS, DepositStatusBadge } from "@/components/status";
import { Card, cn, Empty, ErrorBox, Loading, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";

interface DepositRow {
  id: string;
  user: MiniUser;
  provider: string;
  status: string;
  requestedCents: number;
  expectedCents: number;
  creditedCents: number | null;
  asset: string;
  providerTxId: string | null;
  payerId: string | null;
  attempts: number;
  expiresAt: string;
  confirmedAt: string | null;
  createdAt: string;
}

const units = (cents: number | null, asset: string) => (cents == null ? "—" : `${(cents / 100).toFixed(2)} ${asset}`);

export default function DepositsPage() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<Paged<DepositRow>>(`/api/admin/deposits${qs({ status, page, pageSize: 25 })}`);

  return (
    <>
      <PageHeader title="Depósitos" subtitle="Recargas de saldo via Binance Pay, verificadas pela API da sua conta Binance" />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {[["", "Todos"], ...Object.entries(DEPOSIT_STATUS_LABELS)].map(([k, v]) => (
          <button
            key={k}
            onClick={() => {
              setStatus(k!);
              setPage(1);
            }}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium", status === k ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-fg")}
          >
            {v}
          </button>
        ))}
      </div>
      <Card>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : !data?.items.length ? (
          <Empty>Nenhum depósito.</Empty>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Data</Th>
                  <Th>Cliente</Th>
                  <Th>Solicitado</Th>
                  <Th>Valor exato</Th>
                  <Th>Creditado</Th>
                  <Th>Transação (Order ID)</Th>
                  <Th>Pagador</Th>
                  <Th>Tentativas</Th>
                  <Th>Expira</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((d) => (
                  <tr key={d.id} className="hover:bg-card-2">
                    <Td className="whitespace-nowrap">{fmtDate(d.createdAt)}</Td>
                    <Td>
                      <Link href={`/customers/${d.user.id}`} className="text-accent hover:underline">
                        {userLabel(d.user)}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">{units(d.requestedCents, d.asset)}</Td>
                    <Td className="whitespace-nowrap font-medium">{units(d.expectedCents, d.asset)}</Td>
                    <Td className="whitespace-nowrap">{units(d.creditedCents, d.asset)}</Td>
                    <Td className="font-mono text-xs">{d.providerTxId ?? "—"}</Td>
                    <Td className="font-mono text-xs">{d.payerId ?? "—"}</Td>
                    <Td>{d.attempts}</Td>
                    <Td className="whitespace-nowrap">{fmtDate(d.expiresAt)}</Td>
                    <Td>
                      <DepositStatusBadge status={d.status} />
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
