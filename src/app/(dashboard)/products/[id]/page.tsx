"use client";

import { useParams, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, errorMessage, fmtBRL, fmtUSD } from "@/lib/api";
import type { ProductDetail } from "@/lib/types";
import { useAction, useApi } from "@/components/use-api";
import { useCan } from "@/components/admin-context";
import { ProductForm } from "@/components/product-form";
import { ProductLogo } from "@/components/logo-picker";
import { Badge, Button, Card, ErrorBox, LinkButton, Loading, Notice, PageHeader, Stat } from "@/components/ui";

interface AddResult {
  added: number;
  duplicates: number;
  invalid: number;
  duplicateValues: string[];
  invalidLines: { line: number; value: string; reason: string }[];
  ignored: number;
}

const REASONS: Record<string, string> = { too_long: "muito longo", control_characters: "caracteres inválidos" };

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<ProductDetail>(`/api/admin/products/${id}`);
  const canEdit = useCan("STAFF");
  const isAdmin = useCan("ADMIN");
  const del = useAction();
  const [saved, setSaved] = useState(false);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <ProductLogo url={data.logoUrl} name={data.name} size={40} />
            {data.name}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            🇧🇷 {fmtBRL(data.priceBrlCents)} · 🌎 {fmtUSD(data.priceUsdCents)}
            {data.isActive ? <Badge tone="ok">Ativo</Badge> : <Badge>Inativo</Badge>}
            {data.supplierSlug && <Badge tone="info">🏭 +{data.supplierStock} no fornecedor</Badge>}
            {data.lowStock && <Badge tone="warn">⚠️ Estoque baixo</Badge>}
          </span>
        }
        actions={
          <>
            <LinkButton href="/products">← Produtos</LinkButton>
            <LinkButton href={`/inventory?productId=${data.id}`}>Ver estoque</LinkButton>
            {isAdmin && (
              <Button
                variant="danger"
                loading={del.busy === "delete"}
                onClick={async () => {
                  if (!confirm(`Excluir o produto "${data.name}"? O histórico de pedidos é mantido e o estoque disponível será cancelado.`)) return;
                  const ok = await del.run("delete", () => api(`/api/admin/products/${data.id}`, { method: "DELETE" }));
                  if (ok) router.push("/products");
                }}
              >
                Excluir
              </Button>
            )}
          </>
        }
      />
      {del.error && <div className="mb-3"><ErrorBox error={del.error} /></div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Disponível" value={data.stock.available} tone={data.lowStock ? "warn" : undefined} hint={`Alerta quando < ${data.effectiveLowStockThreshold}`} />
        <Stat label="Reservado" value={data.stock.reserved} />
        <Stat label="Vendido" value={data.stock.sold} />
        <Stat label="Inválido" value={data.stock.invalid} />
        <Stat label="Cancelado" value={data.stock.cancelled} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <Card title="Dados do produto">
          {saved && <div className="mb-3"><Notice>Produto salvo.</Notice></div>}
          <ProductForm
            key={data.updatedAt}
            initial={data}
            readOnly={!canEdit}
            onSubmit={async (body) => {
              await api(`/api/admin/products/${data.id}`, { method: "PATCH", body });
              setSaved(true);
              await reload();
            }}
          />
        </Card>
        {canEdit && (
          <div className="space-y-4">
            <AddStockPanel productId={data.id} onAdded={reload} />
            {data.supplierSlug && <SupplierBuyPanel productId={data.id} slug={data.supplierSlug} onAdded={reload} />}
            {isAdmin && (data.bulkDiscounts?.length ?? 0) > 0 && <PromoPanel productId={data.id} />}
          </div>
        )}
      </div>
    </>
  );
}

interface PromoPreview {
  recipients: number;
  messages: { pt_BR: string; en_US: string };
}

/** Telegram HTML -> plain text, for the preview. */
const plainText = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/** Tells every customer about this product's quantity discounts (preview first, then send). */
function PromoPanel({ productId }: { productId: string }) {
  const [preview, setPreview] = useState<PromoPreview | null>(null);
  const [sentTo, setSentTo] = useState<number | null>(null);
  const action = useAction();

  async function load() {
    setSentTo(null);
    const r = await action.run("preview", () => api<PromoPreview>(`/api/admin/products/${productId}/promo`));
    if (r) setPreview(r);
  }

  async function send() {
    if (!preview) return;
    if (!confirm(`Enviar o aviso de desconto para ${preview.recipients} cliente(s)? Não dá para desfazer.`)) return;
    const r = await action.run("send", () => api<{ recipients: number }>(`/api/admin/products/${productId}/promo`, { method: "POST" }));
    if (r) {
      setSentTo(r.recipients);
      setPreview(null);
    }
  }

  return (
    <Card title="📣 Avisar clientes sobre o desconto">
      <p className="mb-3 text-sm text-muted">Manda no bot, para todos os clientes, a tabela de descontos por quantidade deste produto com um botão para comprar.</p>
      {action.error && <div className="mb-3"><ErrorBox error={action.error} /></div>}
      {sentTo !== null && (
        <div className="mb-3">
          <Notice>Enviando para {sentTo} cliente(s). Você recebe um resumo no Telegram de avisos quando terminar.</Notice>
        </div>
      )}
      {preview && (
        <div className="mb-3 space-y-2">
          <span className="label">Prévia (clientes em português)</span>
          <pre className="whitespace-pre-wrap rounded-lg border border-line p-3 font-sans text-sm">{plainText(preview.messages.pt_BR)}</pre>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Prévia em inglês</summary>
            <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-line p-3 font-sans text-sm">{plainText(preview.messages.en_US)}</pre>
          </details>
        </div>
      )}
      {preview ? (
        <Button variant="primary" loading={action.busy === "send"} onClick={send}>
          Enviar para {preview.recipients} cliente(s)
        </Button>
      ) : (
        <Button loading={action.busy === "preview"} onClick={load}>
          Ver prévia
        </Button>
      )}
    </Card>
  );
}

interface SupplierBuyResult {
  supplierOrderCode: string;
  added: number;
  duplicates: number;
  totalCostCents: number;
  balanceAfterCents: number | null;
}

/** Buys units from the linked supplier into this product's own stock. */
function SupplierBuyPanel({ productId, slug, onAdded }: { productId: string; slug: string; onAdded: () => void }) {
  const [quantity, setQuantity] = useState("1");
  const [result, setResult] = useState<SupplierBuyResult | null>(null);
  const action = useAction();

  async function buy() {
    const q = Number(quantity);
    if (!Number.isInteger(q) || q < 1 || q > 50) return action.setError("Quantidade inválida (1 a 50)");
    if (!confirm(`Comprar ${q} unidade(s) de "${slug}" no fornecedor? O valor é descontado do saldo da carteira do fornecedor.`)) return;
    const r = await action.run("buy", () => api<SupplierBuyResult>(`/api/admin/products/${productId}/supplier-buy`, { method: "POST", body: { quantity: q } }));
    if (r) {
      setResult(r);
      onAdded();
    }
  }

  return (
    <Card title="Comprar do fornecedor para o estoque">
      <p className="mb-3 text-sm text-muted">
        Compra unidades de <code>{slug}</code> e coloca no seu estoque. Quando o estoque acaba, o bot já compra sozinho para cada venda.
      </p>
      {action.error && <div className="mb-3"><ErrorBox error={action.error} /></div>}
      {result && (
        <div className="mb-3">
          <Notice>
            Pedido {result.supplierOrderCode}: {result.added} item(ns) adicionados ao estoque por {fmtUSD(result.totalCostCents)}
            {result.duplicates ? ` (${result.duplicates} duplicado(s) ignorado(s))` : ""}
            {result.balanceAfterCents !== null ? ` · saldo restante ${fmtUSD(result.balanceAfterCents)}` : ""}.
          </Notice>
        </div>
      )}
      <div className="flex items-end gap-2">
        <label className="block w-28">
          <span className="label">Quantidade</span>
          <input className="input" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </label>
        <Button variant="primary" loading={action.busy === "buy"} onClick={buy}>
          Comprar
        </Button>
      </div>
    </Card>
  );
}

function AddStockPanel({ productId, onAdded }: { productId: string; onAdded: () => void }) {
  const [text, setText] = useState("");
  const [csv, setCsv] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<AddResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const lineCount = text.split(/\r?\n/).filter((l) => l.trim()).length;

  function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 3_000_000) return setError("Arquivo muito grande (máx. 3 MB).");
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ""));
      setCsv(file.name.toLowerCase().endsWith(".csv"));
      setFileName(file.name);
      setResult(null);
    };
    reader.onerror = () => setError("Não foi possível ler o arquivo.");
    reader.readAsText(file);
  }

  async function submit() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const r = await api<AddResult>("/api/admin/inventory", { method: "POST", body: { productId, text, csv } });
      setResult(r);
      if (r.added > 0) {
        setText("");
        setFileName(null);
        setCsv(false);
        if (fileRef.current) fileRef.current.value = "";
      }
      onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={<span id="estoque">Adicionar ao estoque</span>}>
      <div className="space-y-3">
        <label className="block">
          <span className="label">Insira os links/códigos, um por linha — ou cole o pedido do fornecedor inteiro (só os links são importados)</span>
          <textarea
            className="input min-h-48 font-mono text-xs"
            placeholder={"LINK-001\nLINK-002\nLINK-003"}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileName(null);
              setCsv(false);
            }}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="cursor-pointer rounded-lg border border-dashed border-line px-3 py-2 text-muted hover:border-accent hover:text-fg">
            📄 Importar TXT/CSV
            <input ref={fileRef} type="file" accept=".txt,.csv,text/plain,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {fileName && (
            <span className="text-muted">
              {fileName} {csv && "(CSV: primeira coluna)"}
            </span>
          )}
          <span className="ml-auto text-xs text-muted">{lineCount} linha(s)</span>
        </div>
        <p className="text-xs text-muted">Duplicados (no texto ou já existentes em qualquer produto) são detectados antes de inserir e ignorados.</p>
        {error && <ErrorBox error={error} />}
        <Button variant="primary" onClick={submit} loading={busy} disabled={!lineCount}>
          Adicionar ao estoque
        </Button>
        {result && (
          <div className="space-y-2">
            <Notice tone={result.added > 0 ? "ok" : "warn"}>
              <b>{result.added}</b> itens adicionados · <b>{result.duplicates}</b> duplicados · <b>{result.invalid}</b> inválidos
              {result.ignored > 0 && <> · <b>{result.ignored}</b> linhas do pedido do fornecedor ignoradas</>}
            </Notice>
            {result.duplicateValues.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">Duplicados ({result.duplicateValues.length})</summary>
                <ul className="mt-1 max-h-40 overflow-auto font-mono text-xs">
                  {result.duplicateValues.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              </details>
            )}
            {result.invalidLines.length > 0 && (
              <details className="text-sm" open>
                <summary className="cursor-pointer text-muted">Inválidos ({result.invalidLines.length})</summary>
                <ul className="mt-1 max-h-40 overflow-auto font-mono text-xs">
                  {result.invalidLines.map((l) => (
                    <li key={l.line}>
                      linha {l.line}: {l.value} — {REASONS[l.reason] ?? l.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
