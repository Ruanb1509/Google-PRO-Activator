"use client";

import { useEffect, useState } from "react";
import { api, centsToInput, toCents } from "@/lib/api";
import { useAction, useApi } from "@/components/use-api";
import { useCan } from "@/components/admin-context";
import { Badge, Button, Card, ErrorBox, Field, Loading, Notice, PageHeader, Toggle } from "@/components/ui";

type Locale = "pt_BR" | "en_US";

interface PaymentMethod {
  key: string;
  provider: string;
  currency: "BRL" | "USD";
  enabled: boolean;
  labelPt: string;
  labelEn: string;
  suggestedForLocales: Locale[];
}

interface StoreSettings {
  paymentMethods: PaymentMethod[];
  brlCountries: string[];
  lowStockThreshold: number;
  orderTtlMinutes: number;
  maxPendingOrdersPerUser: number;
  supportContact: string;
  binancePay: {
    enabled: boolean;
    asset: string;
    minDepositCents: number;
    maxDepositCents: number;
    depositTtlMinutes: number;
    requireExactAmount: boolean;
    presetAmountsCents: number[];
  };
}

interface SettingsResponse {
  settings: StoreSettings;
  providers: { name: string; configured: boolean; currencies: string[]; usesWebhooks: boolean }[];
  integrations: { binancePay: { configured: boolean; payId: string | null }; mockPayments: boolean; telegramBot: string };
}

const PROVIDER_LABELS: Record<string, string> = { mercadopago: "Mercado Pago (PIX)", stripe: "Stripe (cartão)", balance: "Saldo interno", mock: "Mock (teste)" };

export default function SettingsPage() {
  const { data, error, loading, reload } = useApi<SettingsResponse>("/api/admin/settings");
  const isAdmin = useCan("ADMIN");
  const action = useAction();
  const [s, setS] = useState<StoreSettings | null>(null);
  const [countries, setCountries] = useState("");
  const [minDep, setMinDep] = useState("");
  const [maxDep, setMaxDep] = useState("");
  const [presets, setPresets] = useState("");

  useEffect(() => {
    if (!data) return;
    setS(structuredClone(data.settings));
    setCountries(data.settings.brlCountries.join(", "));
    setMinDep(centsToInput(data.settings.binancePay.minDepositCents));
    setMaxDep(centsToInput(data.settings.binancePay.maxDepositCents));
    setPresets(data.settings.binancePay.presetAmountsCents.map((c) => (c / 100).toString()).join(", "));
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!data || !s) return null;

  const ro = !isAdmin;
  const update = (patch: Partial<StoreSettings>) => setS({ ...s, ...patch });
  const updateBp = (patch: Partial<StoreSettings["binancePay"]>) => setS({ ...s, binancePay: { ...s.binancePay, ...patch } });
  const updateMethod = (i: number, patch: Partial<PaymentMethod>) => setS({ ...s, paymentMethods: s.paymentMethods.map((m, j) => (j === i ? { ...m, ...patch } : m)) });

  async function save() {
    if (!s) return;
    const min = toCents(minDep);
    const max = toCents(maxDep);
    const presetCents = presets
      .split(/[,;\s]+/)
      .filter(Boolean)
      .map(toCents);
    if (!min || !max || min > max) return action.setError("Valores mínimo/máximo de depósito inválidos.");
    if (presetCents.some((c) => !c)) return action.setError("Valores rápidos de depósito inválidos.");
    const body: StoreSettings = {
      ...s,
      brlCountries: countries
        .split(/[,;\s]+/)
        .map((c) => c.trim().toUpperCase())
        .filter((c) => c.length === 2),
      binancePay: { ...s.binancePay, minDepositCents: min, maxDepositCents: max, presetAmountsCents: presetCents as number[] },
    };
    const r = await action.run("save", () => api<{ settings: StoreSettings }>("/api/admin/settings", { method: "PUT", body }), "Configurações salvas.");
    if (r) await reload();
  }

  const providerOk = (name: string) => data.providers.find((p) => p.name === name)?.configured ?? false;

  return (
    <>
      <PageHeader
        title="Configurações"
        subtitle={ro ? "Somente administradores podem alterar as configurações." : "Alterações entram em vigor em até 15 segundos, sem deploy."}
        actions={
          !ro && (
            <Button variant="primary" onClick={save} loading={action.busy === "save"}>
              Salvar configurações
            </Button>
          )
        }
      />
      {action.error && <div className="mb-3"><ErrorBox error={action.error} /></div>}
      {action.message && <div className="mb-3"><Notice>{action.message}</Notice></div>}

      <div className="space-y-4">
        <Card title="Integrações">
          <div className="flex flex-wrap gap-2 text-sm">
            {data.providers.map((p) => (
              <Badge key={p.name} tone={p.configured ? "ok" : "neutral"}>
                {p.configured ? "✓" : "✕"} {PROVIDER_LABELS[p.name] ?? p.name} ({p.currencies.join("/")})
              </Badge>
            ))}
            <Badge tone={data.integrations.binancePay.configured ? "ok" : "neutral"}>
              {data.integrations.binancePay.configured ? "✓" : "✕"} Binance Pay {data.integrations.binancePay.payId ? `(Pay ID ${data.integrations.binancePay.payId})` : ""}
            </Badge>
            <Badge tone="info">Bot: @{data.integrations.telegramBot}</Badge>
            {data.integrations.mockPayments && <Badge tone="warn">Pagamentos de teste habilitados</Badge>}
          </div>
          <p className="mt-2 text-xs text-muted">Chaves e segredos ficam apenas nas variáveis de ambiente do servidor (Vercel) — nunca no painel.</p>
        </Card>

        <Card
          title="Formas de pagamento"
          actions={
            !ro && (
              <Button
                size="sm"
                onClick={() =>
                  update({
                    paymentMethods: [
                      ...s.paymentMethods,
                      { key: `metodo_${s.paymentMethods.length + 1}`, provider: "stripe", currency: "USD", enabled: false, labelPt: "Novo método", labelEn: "New method", suggestedForLocales: [] },
                    ],
                  })
                }
              >
                + Adicionar método
              </Button>
            )
          }
        >
          <p className="mb-3 text-xs text-muted">
            A forma de pagamento define o provedor e a moeda cobrada. O idioma do cliente só altera a ordem de exibição (sugestão), nunca restringe a moeda; o país real vem do provedor de pagamento.
          </p>
          <div className="space-y-3">
            {s.paymentMethods.map((m, i) => (
              <fieldset key={i} disabled={ro} className="grid gap-3 rounded-lg border border-line p-3 sm:grid-cols-2 lg:grid-cols-7 lg:items-end">
                <div className="flex items-center gap-2 lg:col-span-1">
                  <Toggle checked={m.enabled} onChange={(v) => updateMethod(i, { enabled: v })} disabled={ro} label="Ativo" />
                  <span className="text-sm">{m.enabled ? "Ativo" : "Inativo"}</span>
                </div>
                <Field label="Chave">
                  <input className="input font-mono" value={m.key} onChange={(e) => updateMethod(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} />
                </Field>
                <Field label="Provedor">
                  <select className="input" value={m.provider} onChange={(e) => updateMethod(i, { provider: e.target.value })}>
                    {data.providers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {PROVIDER_LABELS[p.name] ?? p.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Moeda">
                  <select className="input" value={m.currency} onChange={(e) => updateMethod(i, { currency: e.target.value as "BRL" | "USD" })}>
                    <option value="BRL">BRL</option>
                    <option value="USD">USD</option>
                  </select>
                </Field>
                <Field label="Rótulo (pt-BR)">
                  <input className="input" maxLength={40} value={m.labelPt} onChange={(e) => updateMethod(i, { labelPt: e.target.value })} />
                </Field>
                <Field label="Rótulo (en-US)">
                  <input className="input" maxLength={40} value={m.labelEn} onChange={(e) => updateMethod(i, { labelEn: e.target.value })} />
                </Field>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {(["pt_BR", "en_US"] as Locale[]).map((l) => (
                    <label key={l} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={m.suggestedForLocales.includes(l)}
                        onChange={(e) =>
                          updateMethod(i, {
                            suggestedForLocales: e.target.checked ? [...m.suggestedForLocales, l] : m.suggestedForLocales.filter((x) => x !== l),
                          })
                        }
                      />
                      Sugerir {l === "pt_BR" ? "🇧🇷" : "🇺🇸"}
                    </label>
                  ))}
                  {!ro && (
                    <button type="button" className="text-bad hover:underline" onClick={() => update({ paymentMethods: s.paymentMethods.filter((_, j) => j !== i) })}>
                      remover
                    </button>
                  )}
                </div>
                {m.enabled && !providerOk(m.provider) && (
                  <div className="text-xs text-warn sm:col-span-2 lg:col-span-7">⚠️ Provedor não configurado no servidor — este método não aparecerá no bot.</div>
                )}
              </fieldset>
            ))}
          </div>
        </Card>

        <Card title="Regras da loja">
          <fieldset disabled={ro} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Estoque baixo" hint="Alerta quando estoque < N (padrão para todos os produtos)">
              <input className="input" type="number" min={0} value={s.lowStockThreshold} onChange={(e) => update({ lowStockThreshold: Number(e.target.value) })} />
            </Field>
            <Field label="Validade do pedido (minutos)" hint="Tempo para pagar antes da reserva expirar">
              <input className="input" type="number" min={5} max={1440} value={s.orderTtlMinutes} onChange={(e) => update({ orderTtlMinutes: Number(e.target.value) })} />
            </Field>
            <Field label="Máx. pedidos pendentes por cliente">
              <input className="input" type="number" min={1} max={20} value={s.maxPendingOrdersPerUser} onChange={(e) => update({ maxPendingOrdersPerUser: Number(e.target.value) })} />
            </Field>
            <Field label="Países considerados Brasil" hint="Códigos ISO de 2 letras, separados por vírgula (relatórios)">
              <input className="input" value={countries} onChange={(e) => setCountries(e.target.value)} />
            </Field>
            <Field label="Contato de suporte" hint="Exibido na Ajuda do bot (ex.: @suporte)">
              <input className="input" maxLength={200} value={s.supportContact} onChange={(e) => update({ supportContact: e.target.value })} />
            </Field>
          </fieldset>
        </Card>

        <Card title="Saldo via Binance Pay">
          <fieldset disabled={ro} className="space-y-4">
            <div className="flex items-center gap-2">
              <Toggle checked={s.binancePay.enabled} onChange={(v) => updateBp({ enabled: v })} disabled={ro} label="Binance Pay" />
              <span className="text-sm">Permitir recarga de saldo via Binance Pay</span>
              {!data.integrations.binancePay.configured && <Badge tone="warn">API não configurada</Badge>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Ativo (moeda)">
                <input className="input font-mono" value={s.binancePay.asset} onChange={(e) => updateBp({ asset: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} />
              </Field>
              <Field label="Depósito mínimo">
                <input className="input" inputMode="decimal" value={minDep} onChange={(e) => setMinDep(e.target.value)} />
              </Field>
              <Field label="Depósito máximo">
                <input className="input" inputMode="decimal" value={maxDep} onChange={(e) => setMaxDep(e.target.value)} />
              </Field>
              <Field label="Validade do depósito (minutos)">
                <input className="input" type="number" min={10} value={s.binancePay.depositTtlMinutes} onChange={(e) => updateBp({ depositTtlMinutes: Number(e.target.value) })} />
              </Field>
              <Field label="Valores rápidos" hint="Separados por vírgula (máx. 6). Ex.: 5, 10, 20, 50">
                <input className="input" value={presets} onChange={(e) => setPresets(e.target.value)} />
              </Field>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={s.binancePay.requireExactAmount} onChange={(e) => updateBp({ requireExactAmount: e.target.checked })} />
              <span>
                Exigir valor exato com centavos únicos <span className="text-muted">(recomendado)</span>
                <span className="mt-0.5 block text-xs text-muted">
                  Cada depósito recebe um valor único (ex.: 10,37 USDT). Assim, mesmo que alguém descubra o ID de uma transação de outra pessoa, não conseguirá usá-la, porque o valor não
                  corresponderá ao depósito dela. Desativar permite que qualquer transação recebida seja reivindicada por quem informar o ID primeiro.
                </span>
              </span>
            </label>
          </fieldset>
        </Card>
      </div>
    </>
  );
}
