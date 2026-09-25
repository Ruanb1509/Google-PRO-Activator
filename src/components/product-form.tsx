"use client";

import { useState, type FormEvent } from "react";
import { centsToInput, toCents } from "@/lib/api";
import type { Product } from "@/lib/types";
import { Button, ErrorBox, Field } from "@/components/ui";

export interface ProductPayload {
  name: string;
  nameEn: string | null;
  description: string;
  descriptionEn: string | null;
  category: string;
  priceBrlCents: number;
  priceUsdCents: number;
  isActive: boolean;
  lowStockThreshold: number | null;
  sortOrder: number;
}

export function ProductForm({
  initial,
  onSubmit,
  submitLabel = "Salvar",
  readOnly,
}: {
  initial?: Partial<Product>;
  onSubmit: (p: ProductPayload) => Promise<void>;
  submitLabel?: string;
  readOnly?: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [nameEn, setNameEn] = useState(initial?.nameEn ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [descriptionEn, setDescriptionEn] = useState(initial?.descriptionEn ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [brl, setBrl] = useState(centsToInput(initial?.priceBrlCents ?? 2000));
  const [usd, setUsd] = useState(centsToInput(initial?.priceUsdCents ?? 400));
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [threshold, setThreshold] = useState(initial?.lowStockThreshold != null ? String(initial.lowStockThreshold) : "");
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const priceBrlCents = toCents(brl);
    const priceUsdCents = toCents(usd);
    if (!priceBrlCents || priceBrlCents <= 0) return setError("Preço BRL inválido");
    if (!priceUsdCents || priceUsdCents <= 0) return setError("Preço USD inválido");
    if (threshold && !/^\d+$/.test(threshold)) return setError("Limite de estoque baixo inválido");
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        nameEn: nameEn.trim() || null,
        description: description.trim(),
        descriptionEn: descriptionEn.trim() || null,
        category: category.trim(),
        priceBrlCents,
        priceUsdCents,
        isActive,
        lowStockThreshold: threshold ? Number(threshold) : null,
        sortOrder: Number(sortOrder) || 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <ErrorBox error={error} />}
      <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome (pt-BR)">
          <input className="input" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Nome (en-US)" hint="Opcional — usado para clientes em inglês">
          <input className="input" maxLength={120} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field label="Descrição (pt-BR)">
          <textarea className="input min-h-24" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Descrição (en-US)">
          <textarea className="input min-h-24" maxLength={2000} value={descriptionEn} onChange={(e) => setDescriptionEn(e.target.value)} />
        </Field>
        <Field label="Categoria">
          <input className="input" maxLength={60} value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <Field label="Ordem de exibição">
          <input className="input" type="number" min={-1000} max={1000} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </Field>
        <Field label="🇧🇷 Preço Brasil (R$)">
          <input className="input" inputMode="decimal" required value={brl} onChange={(e) => setBrl(e.target.value)} placeholder="20,00" />
        </Field>
        <Field label="🌎 Preço exterior (US$)">
          <input className="input" inputMode="decimal" required value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="4,00" />
        </Field>
        <Field label="Alerta de estoque baixo" hint="Alerta quando estoque < N. Vazio = usar o padrão das configurações.">
          <input className="input" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="padrão" />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Produto ativo (visível no bot)
        </label>
      </fieldset>
      {!readOnly && (
        <Button variant="primary" type="submit" loading={saving}>
          {submitLabel}
        </Button>
      )}
    </form>
  );
}
