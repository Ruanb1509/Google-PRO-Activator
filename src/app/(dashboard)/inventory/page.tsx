"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, fmtDate, qs, type Paged } from "@/lib/api";
import { userLabel, type MiniUser, type ProductWithStock } from "@/lib/types";
import { useAction, useApi } from "@/components/use-api";
import { useCan } from "@/components/admin-context";
import { INVENTORY_STATUS_LABELS, InventoryStatusBadge, OrderStatusBadge } from "@/components/status";
import { Button, Card, Empty, ErrorBox, Field, Info, Loading, Modal, PageHeader, Pagination, Table, Td, Th } from "@/components/ui";

interface Item {
  id: string;
  productId: string;
  valuePreview: string;
  status: string;
  reservedUntil: string | null;
  createdAt: string;
  soldAt: string | null;
  orderId: string | null;
  product: { name: string };
  order: { number: number } | null;
  user: MiniUser | null;
}

interface ItemDetail {
  id: string;
  valuePreview: string;
  status: string;
  batchId: string | null;
  createdAt: string;
  reservedAt: string | null;
  reservedUntil: string | null;
  soldAt: string | null;
  product: { id: string; name: string };
  order: { id: string; number: number; status: string } | null;
  user: MiniUser | null;
  events: { id: string; type: string; orderId: string | null; actorType: string; createdAt: string; details: unknown }[];
}

const REMOVABLE = ["AVAILABLE", "INVALID", "CANCELLED"];

export default function InventoryPage() {
  const [productId, setProductId] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const canEdit = useCan("STAFF");
  const action = useAction();

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setProductId(sp.get("productId") ?? "");
    setStatus(sp.get("status") ?? "");
    setReady(true);
  }, []);

  const products = useApi<{ items: ProductWithStock[] }>("/api/admin/products");
  const path = ready
    ? `/api/admin/inventory${qs({
        productId,
        status,
        from: from ? new Date(`${from}T00:00:00-03:00`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59-03:00`).toISOString() : undefined,
        q,
        page,
        pageSize: 50,
      })}`
    : null;
  const list = useApi<Paged<Item>>(path);

  useEffect(() => setSelected(new Set()), [path]);

  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  async function setItemStatus(id: string, s: string) {
    await action.run(id, () => api(`/api/admin/inventory/${id}`, { method: "PATCH", body: { status: s } }));
    await list.reload();
  }

  async function releaseReserved(i: Item) {
    if (!i.orderId || !confirm(`Cancelar o pedido #${i.order?.number ?? ""} e deixar este item disponível? A cobrança pendente é cancelada no provedor.`)) return;
    const r = await action.run(i.id, () => api(`/api/admin/orders/${i.orderId}/cancel`, { method: "POST" }));
    if (r) action.setMessage(`Pedido #${i.order?.number ?? ""} cancelado; item disponível novamente.`);
    await list.reload();
  }

  async function removeSelected() {
    const ids = [...selected];
    if (!ids.length || !confirm(`Remover ${ids.length} item(ns) do estoque? Esta ação não pode ser desfeita.`)) return;
    const r = await action.run("remove", () => api<{ removed: number }>("/api/admin/inventory", { method: "DELETE", body: { ids } }));
    if (r) action.setMessage(`${r.removed} item(ns) removido(s).`);
    await list.reload();
  }

  const items = list.data?.items ?? [];
  const selectable = items.filter((i) => REMOVABLE.includes(i.status));

  return (
    <>
      <PageHeader title="Estoque" subtitle="Fila de links/códigos únicos. Valores são armazenados criptografados e exibidos mascarados." />

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Produto">
            <select className="input" value={productId} onChange={(e) => resetPage(setProductId)(e.target.value)}>
              <option value="">Todos</option>
              {products.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select className="input" value={status} onChange={(e) => resetPage(setStatus)(e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(INVENTORY_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Entrada de">
            <input className="input" type="date" value={from} onChange={(e) => resetPage(setFrom)(e.target.value)} />
          </Field>
          <Field label="Até">
            <input className="input" type="date" value={to} onChange={(e) => resetPage(setTo)(e.target.value)} />
          </Field>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setQ(qInput.trim());
              setPage(1);
            }}
          >
            <Field label="Buscar valor exato">
              <input className="input" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Cole o link/código e Enter" />
            </Field>
          </form>
        </div>
      </Card>

      {action.error && <div className="mb-3"><ErrorBox error={action.error} /></div>}
      {action.message && <div className="mb-3 text-sm text-ok">{action.message}</div>}

      <Card
        title={list.data ? `${list.data.total} item(ns)` : "Itens"}
        actions={
          canEdit &&
          selected.size > 0 && (
            <Button size="sm" variant="danger" onClick={removeSelected} loading={action.busy === "remove"}>
              Remover {selected.size} selecionado(s)
            </Button>
          )
        }
      >
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <ErrorBox error={list.error} onRetry={list.reload} />
        ) : !items.length ? (
          <Empty>Nenhum item encontrado.</Empty>
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  {canEdit && (
                    <Th className="w-8">
                      <input
                        type="checkbox"
                        aria-label="Selecionar todos"
                        checked={selectable.length > 0 && selectable.every((i) => selected.has(i.id))}
                        onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((i) => i.id)) : new Set())}
                      />
                    </Th>
                  )}
                  <Th>Valor</Th>
                  <Th>Produto</Th>
                  <Th>Status</Th>
                  <Th>Entrada</Th>
                  <Th>Venda</Th>
                  <Th>Pedido</Th>
                  <Th>Cliente</Th>
                  {canEdit && <Th>Ações</Th>}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="cursor-pointer hover:bg-card-2" onClick={() => setOpenId(i.id)}>
                    {canEdit && (
                      <Td>
                        <input
                          type="checkbox"
                          aria-label="Selecionar"
                          disabled={!REMOVABLE.includes(i.status)}
                          checked={selected.has(i.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const next = new Set(selected);
                            if (e.target.checked) next.add(i.id);
                            else next.delete(i.id);
                            setSelected(next);
                          }}
                        />
                      </Td>
                    )}
                    <Td className="font-mono text-xs">{i.valuePreview}</Td>
                    <Td>{i.product.name}</Td>
                    <Td>
                      <InventoryStatusBadge status={i.status} />
                    </Td>
                    <Td className="whitespace-nowrap">{fmtDate(i.createdAt)}</Td>
                    <Td className="whitespace-nowrap">{fmtDate(i.soldAt)}</Td>
                    <Td>
                      {i.order && i.orderId ? (
                        <Link href={`/orders/${i.orderId}`} className="text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                          #{i.order.number}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>{userLabel(i.user)}</Td>
                    {canEdit && (
                      <Td>
                        <span onClick={(e) => e.stopPropagation()} className="flex gap-1">
                          {i.status === "AVAILABLE" && (
                            <Button size="sm" onClick={() => setItemStatus(i.id, "INVALID")} loading={action.busy === i.id}>
                              Marcar inválido
                            </Button>
                          )}
                          {i.status === "RESERVED" && i.orderId && (
                            <Button size="sm" onClick={() => releaseReserved(i)} loading={action.busy === i.id}>
                              Liberar
                            </Button>
                          )}
                          {(i.status === "INVALID" || i.status === "CANCELLED") && (
                            <Button size="sm" onClick={() => setItemStatus(i.id, "AVAILABLE")} loading={action.busy === i.id}>
                              Disponibilizar
                            </Button>
                          )}
                        </span>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={list.data!.page} pageSize={list.data!.pageSize} total={list.data!.total} onPage={setPage} />
          </>
        )}
      </Card>

      <ItemModal id={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function ItemModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, error, loading } = useApi<ItemDetail>(id ? `/api/admin/inventory/${id}` : null);
  const isAdmin = useCan("ADMIN");
  const reveal = useAction();
  const [value, setValue] = useState<string | null>(null);

  useEffect(() => setValue(null), [id]);

  return (
    <Modal open={id !== null} onClose={onClose} title="Item do estoque" wide>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : data && data.id === id ? (
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <Info label="ID" value={<span className="font-mono text-xs">{data.id}</span>} />
            <Info label="Produto" value={<Link className="text-accent hover:underline" href={`/products/${data.product.id}`}>{data.product.name}</Link>} />
            <Info label="Valor" value={<span className="break-all font-mono text-xs">{value ?? data.valuePreview}</span>} />
            <Info label="Status" value={<InventoryStatusBadge status={data.status} />} />
            <Info label="Entrada" value={fmtDate(data.createdAt)} />
            <Info label="Reservado em" value={fmtDate(data.reservedAt)} />
            <Info label="Venda" value={fmtDate(data.soldAt)} />
            <Info
              label="Pedido"
              value={
                data.order ? (
                  <span className="flex items-center gap-2">
                    <Link className="text-accent hover:underline" href={`/orders/${data.order.id}`}>
                      #{data.order.number}
                    </Link>
                    <OrderStatusBadge status={data.order.status} />
                  </span>
                ) : (
                  "—"
                )
              }
            />
            <Info label="Cliente" value={data.user ? `${userLabel(data.user)} (${data.user.telegramId})` : "—"} />
            <Info label="Lote" value={<span className="font-mono text-xs">{data.batchId ?? "—"}</span>} />
          </dl>
          {isAdmin && value === null && (
            <div>
              <Button
                size="sm"
                loading={reveal.busy === "reveal"}
                onClick={async () => {
                  const r = await reveal.run("reveal", () => api<{ value: string }>(`/api/admin/inventory/${data.id}/reveal`, { method: "POST" }));
                  if (r) setValue(r.value);
                }}
              >
                👁️ Revelar valor (registrado na auditoria)
              </Button>
              {reveal.error && <div className="mt-2"><ErrorBox error={reveal.error} /></div>}
            </div>
          )}
          <div>
            <h4 className="mb-2 font-semibold">Histórico</h4>
            {data.events.length === 0 ? (
              <p className="text-muted">Sem eventos.</p>
            ) : (
              <ol className="space-y-2 border-l border-line pl-4">
                {data.events.map((e) => (
                  <li key={e.id}>
                    <div className="font-medium">{e.type}</div>
                    <div className="text-xs text-muted">
                      {fmtDate(e.createdAt)} · {e.actorType}
                      {e.details ? ` · ${JSON.stringify(e.details)}` : ""}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

