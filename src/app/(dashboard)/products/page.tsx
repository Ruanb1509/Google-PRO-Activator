"use client";

import Link from "next/link";
import { useState } from "react";
import { api, fmtBRL, fmtUSD } from "@/lib/api";
import type { ProductWithStock } from "@/lib/types";
import { useAction, useApi } from "@/components/use-api";
import { useCan } from "@/components/admin-context";
import { ProductForm } from "@/components/product-form";
import { ProductLogo } from "@/components/logo-picker";
import { Badge, Button, Empty, ErrorBox, LinkButton, Loading, Modal, PageHeader, Toggle } from "@/components/ui";

export default function ProductsPage() {
  const { data, error, loading, reload } = useApi<{ items: ProductWithStock[] }>("/api/admin/products");
  const canEdit = useCan("STAFF");
  const action = useAction();
  const [creating, setCreating] = useState(false);

  async function toggle(p: ProductWithStock, isActive: boolean) {
    await action.run(p.id, () => api(`/api/admin/products/${p.id}`, { method: "PATCH", body: { isActive } }));
    await reload();
  }

  return (
    <>
      <PageHeader
        title="Produtos"
        subtitle="Catálogo vendido no bot. Preços e estoque podem ser alterados sem mexer no código."
        actions={canEdit && <Button variant="primary" onClick={() => setCreating(true)}>+ Novo produto</Button>}
      />
      {action.error && <div className="mb-3"><ErrorBox error={action.error} /></div>}
      {loading && !data ? (
        <Loading />
      ) : error && !data ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data?.items.length ? (
        <Empty>Nenhum produto cadastrado. Clique em “Novo produto”.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.items.map((p) => (
            <div key={p.id} className="flex flex-col rounded-xl border border-line bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <ProductLogo url={p.logoUrl} name={p.name} size={44} />
                  <div className="min-w-0">
                    <Link href={`/products/${p.id}`} className="block truncate font-semibold hover:underline">
                      {p.name}
                    </Link>
                    {p.category && <div className="text-xs text-muted">{p.category}</div>}
                  </div>
                </div>
                <Toggle checked={p.isActive} disabled={!canEdit || action.busy === p.id} onChange={(v) => toggle(p, v)} label="Ativo" />
              </div>
              <div className="mt-3 space-y-0.5 text-sm tabular-nums">
                <div>🇧🇷 {fmtBRL(p.priceBrlCents)}</div>
                <div>🌎 {fmtUSD(p.priceUsdCents)}</div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span>
                  Estoque: <b className="tabular-nums">{p.stock.available}</b> disponíveis
                </span>
                {p.lowStock && <Badge tone="warn">⚠️ Estoque baixo</Badge>}
                {!p.isActive && <Badge>Inativo</Badge>}
              </div>
              <div className="mt-1 text-xs text-muted">
                {p.stock.sold} vendidos · {p.stock.reserved} reservados · {p.stock.invalid} inválidos
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <LinkButton size="sm" href={`/products/${p.id}`}>{canEdit ? "Editar" : "Ver"}</LinkButton>
                <LinkButton size="sm" href={`/inventory?productId=${p.id}`}>Estoque</LinkButton>
                {canEdit && (
                  <LinkButton size="sm" variant="primary" href={`/products/${p.id}#estoque`}>
                    Adicionar estoque
                  </LinkButton>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="Novo produto" wide>
        <ProductForm
          submitLabel="Criar produto"
          onSubmit={async (body) => {
            await api("/api/admin/products", { method: "POST", body });
            setCreating(false);
            await reload();
          }}
        />
      </Modal>
    </>
  );
}
