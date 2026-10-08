"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, centsToInput, fmtUSD, toCents } from "@/lib/api";
import { useApi } from "@/components/use-api";
import { useCan } from "@/components/admin-context";
import { Badge, Button, Empty, ErrorBox, Field, Loading, Modal, Notice, PageHeader, Stat, Table, Td, Th } from "@/components/ui";

interface SupplierProduct {
  slug: string;
  name: string;
  provider: string;
  deliveryType: "LINK" | "COUPON" | "READY_ACCOUNT";
  costCents: number;
  durationDays: number | null;
  warrantyDays: number | null;
  inStock: boolean;
  stock: number;
  linkedProducts: { id: string; name: string }[];
}

type Overview = { configured: false } | { configured: true; balanceCents: number; products: SupplierProduct[] };

const DELIVERY: Record<SupplierProduct["deliveryType"], string> = { LINK: "Link", COUPON: "Código", READY_ACCOUNT: "Conta pronta" };

export default function SupplierPage() {
  const { data, error, loading, reload } = useApi<Overview>("/api/admin/supplier");
  const canEdit = useCan("STAFF");
  const [importing, setImporting] = useState<SupplierProduct | null>(null);

  return (
    <>
      <PageHeader
        title="Fornecedor"
        subtitle="Partner API: quando o estoque de um produto vinculado acaba, as unidades que faltam são compradas aqui automaticamente depois do pagamento."
        actions={<Button onClick={reload}>Atualizar</Button>}
      />
      {loading && !data ? (
        <Loading />
      ) : error && !data ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data ? null : !data.configured ? (
        <Notice tone="info">
          Fornecedor desativado. Crie uma chave no bot do fornecedor (menu → API → Criar chave) e configure a variável de ambiente <code>PARTNER_API_KEY</code>.
        </Notice>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Saldo no fornecedor" value={fmtUSD(data.balanceCents)} tone={data.balanceCents < 1000 ? "warn" : undefined} hint="Recarregue pelo bot do fornecedor" />
            <Stat label="Produtos no catálogo" value={data.products.length} />
            <Stat label="Vinculados à loja" value={data.products.filter((p) => p.linkedProducts.length).length} />
          </div>
          {!data.products.length ? (
            <Empty>O catálogo do fornecedor está vazio.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Produto</Th>
                  <Th>Entrega</Th>
                  <Th className="text-right">Custo</Th>
                  <Th className="text-right">Estoque</Th>
                  <Th>Na loja</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.products.map((p) => (
                  <tr key={p.slug}>
                    <Td>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted">
                        {p.provider} · <code>{p.slug}</code>
                        {p.durationDays ? ` · ${p.durationDays} dias` : ""}
                        {p.warrantyDays ? ` · garantia ${p.warrantyDays} dias` : ""}
                      </div>
                    </Td>
                    <Td>{DELIVERY[p.deliveryType] ?? p.deliveryType}</Td>
                    <Td className="text-right tabular-nums">{fmtUSD(p.costCents)}</Td>
                    <Td className="text-right tabular-nums">{p.inStock ? p.stock : <Badge tone="bad">Esgotado</Badge>}</Td>
                    <Td>
                      {p.linkedProducts.length ? (
                        p.linkedProducts.map((l) => (
                          <Link key={l.id} href={`/products/${l.id}`} className="block hover:underline">
                            {l.name}
                          </Link>
                        ))
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                    <Td className="text-right">
                      {canEdit && (
                        <Button size="sm" variant={p.linkedProducts.length ? "secondary" : "primary"} onClick={() => setImporting(p)}>
                          Importar
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}
      <Modal open={importing !== null} onClose={() => setImporting(null)} title={`Importar ${importing?.name ?? ""}`}>
        {importing && <ImportForm item={importing} onDone={() => setImporting(null)} />}
      </Modal>
    </>
  );
}

function ImportForm({ item, onDone }: { item: SupplierProduct; onDone: () => void }) {
  const router = useRouter();
  const [brl, setBrl] = useState("");
  const [usd, setUsd] = useState(centsToInput(Math.ceil((item.costCents * 1.5) / 10) * 10));
  const [maxCost, setMaxCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const priceBrlCents = toCents(brl);
    const priceUsdCents = toCents(usd);
    const supplierMaxCostCents = maxCost.trim() ? toCents(maxCost) : null;
    if (!priceBrlCents || priceBrlCents <= 0) return setError("Preço BRL inválido");
    if (!priceUsdCents || priceUsdCents <= 0) return setError("Preço USD inválido");
    if (supplierMaxCostCents !== null && (!supplierMaxCostCents || supplierMaxCostCents <= 0)) return setError("Custo máximo inválido");
    if ((supplierMaxCostCents ?? priceUsdCents) < item.costCents) return setError(`O custo atual (${fmtUSD(item.costCents)}) passa do limite: o produto ficaria sem estoque do fornecedor.`);
    setSaving(true);
    try {
      const product = await api<{ id: string }>("/api/admin/supplier/import", { method: "POST", body: { slug: item.slug, priceBrlCents, priceUsdCents, supplierMaxCostCents } });
      onDone();
      router.push(`/products/${product.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <ErrorBox error={error} />}
      <p className="text-sm text-muted">
        Cria um produto na loja com nome e descrição do fornecedor, já vinculado a ele. Sem estoque próprio, cada venda é comprada no fornecedor por{" "}
        <b>{fmtUSD(item.costCents)}</b>. Você pode editar nome, descrição e logo depois.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="🇧🇷 Preço Brasil (R$)">
          <input className="input" inputMode="decimal" required value={brl} onChange={(e) => setBrl(e.target.value)} placeholder="20,00" />
        </Field>
        <Field label="🌎 Preço exterior (US$)" hint="Sugestão: custo + 50%">
          <input className="input" inputMode="decimal" required value={usd} onChange={(e) => setUsd(e.target.value)} />
        </Field>
        <Field label="Custo máximo no fornecedor (US$)" hint="Acima disso a loja não compra. Vazio = o preço exterior.">
          <input className="input" inputMode="decimal" value={maxCost} onChange={(e) => setMaxCost(e.target.value)} placeholder="= preço exterior" />
        </Field>
      </div>
      <Button variant="primary" type="submit" loading={saving}>
        Criar produto
      </Button>
    </form>
  );
}
