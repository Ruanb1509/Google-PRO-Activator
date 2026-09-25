"use client";

import { Fragment, useState } from "react";
import { fmtDate, qs, type Paged } from "@/lib/api";
import { useApi } from "@/components/use-api";
import { Badge, Card, Empty, ErrorBox, Field, JsonView, Loading, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";

interface AuditRow {
  id: string;
  actorType: string;
  adminId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ip: string | null;
  details: unknown;
  createdAt: string;
  admin: { email: string; name: string } | null;
}

const ACTION_GROUPS: [string, string][] = [
  ["", "Todas"],
  ["auth.", "Autenticação"],
  ["product.", "Produtos"],
  ["inventory.", "Estoque"],
  ["order.", "Pedidos / vendas"],
  ["webhook.", "Webhooks"],
  ["payment.", "Pagamentos"],
  ["deposit.", "Depósitos"],
  ["balance.", "Saldo"],
  ["settings.", "Configurações"],
  ["admin.", "Administradores"],
];

const ACTOR_TONE: Record<string, "accent" | "info" | "neutral" | "warn"> = { ADMIN: "accent", WEBHOOK: "info", SYSTEM: "neutral", BOT: "warn" };

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading, reload } = useApi<Paged<AuditRow>>(`/api/admin/audit${qs({ action, page, pageSize: 50 })}`);

  return (
    <>
      <PageHeader title="Auditoria" subtitle="Registro de ações administrativas, vendas, webhooks e falhas" />
      <Card className="mb-4">
        <Field label="Tipo de ação">
          <select
            className="input sm:w-64"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          >
            {ACTION_GROUPS.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </Card>
      <Card>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : !data?.items.length ? (
          <Empty>Nenhum registro.</Empty>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Data</Th>
                  <Th>Usuário</Th>
                  <Th>Ação</Th>
                  <Th>IP</Th>
                  <Th>Recurso afetado</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <Fragment key={a.id}>
                    <tr className="hover:bg-card-2">
                      <Td className="whitespace-nowrap">{fmtDate(a.createdAt)}</Td>
                      <Td>
                        <span className="flex items-center gap-2">
                          <Badge tone={ACTOR_TONE[a.actorType] ?? "neutral"}>{a.actorType}</Badge>
                          {a.admin?.email}
                        </span>
                      </Td>
                      <Td className="font-mono text-xs">{a.action}</Td>
                      <Td className="font-mono text-xs">{a.ip ?? "—"}</Td>
                      <Td className="text-xs">
                        {a.resourceType ?? "—"}
                        {a.resourceId && <span className="ml-1 font-mono text-muted">{a.resourceId}</span>}
                      </Td>
                      <Td>
                        {a.details != null && (
                          <button className="text-xs text-accent hover:underline" onClick={() => setOpen(open === a.id ? null : a.id)}>
                            {open === a.id ? "ocultar" : "detalhes"}
                          </button>
                        )}
                      </Td>
                    </tr>
                    {open === a.id && (
                      <tr>
                        <Td colSpan={6}>
                          <JsonView value={a.details} />
                        </Td>
                      </tr>
                    )}
                  </Fragment>
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
