/**
 * Quantity discounts: from `minQty` units on, every unit costs `percentOff`% less. Shared by the bot,
 * the order service (the amount charged) and the admin form. Capped at 50% because supplier products
 * are sold at 2x the cost: anything above that would sell at a loss.
 */
export interface BulkDiscount {
  minQty: number;
  percentOff: number;
}

export const MAX_BULK_PERCENT_OFF = 50;

/** Valid tiers from the stored JSON, sorted by quantity (anything malformed is ignored). */
export function bulkDiscountTiers(value: unknown): BulkDiscount[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is BulkDiscount => Number.isInteger(t?.minQty) && t.minQty >= 2 && typeof t?.percentOff === "number" && t.percentOff > 0 && t.percentOff <= MAX_BULK_PERCENT_OFF)
    .sort((a, b) => a.minQty - b.minQty);
}

/** Discount (%) for buying `quantity` units: the highest tier reached. */
export function bulkPercentOff(tiers: BulkDiscount[], quantity: number): number {
  return tiers.filter((t) => quantity >= t.minQty).at(-1)?.percentOff ?? 0;
}

/** Price of one unit when buying `quantity` units. */
export function discountedUnitCents(unitCents: number, tiers: BulkDiscount[], quantity: number): number {
  return Math.round((unitCents * (100 - bulkPercentOff(tiers, quantity))) / 100);
}

/** "5:11, 11:22, 25:33" (quantity:percent) — the admin form's text format. */
export function formatBulkDiscounts(tiers: BulkDiscount[]): string {
  return tiers.map((t) => `${t.minQty}:${String(t.percentOff).replace(".", ",")}`).join(", ");
}

/** Parses the admin form's text; throws a readable error on invalid input. */
export function parseBulkDiscounts(text: string): BulkDiscount[] {
  const parts = text.split(/[;,\n]+(?=\s*\d+\s*:)/).map((s) => s.trim()).filter(Boolean);
  const tiers = parts.map((part) => {
    const m = part.match(/^(\d+)\s*:\s*(\d+(?:[.,]\d{1,2})?)\s*%?$/);
    if (!m) throw new Error(`Desconto inválido: "${part}" (use quantidade:porcentagem, ex.: 5:10)`);
    const tier = { minQty: Number(m[1]), percentOff: Number(m[2]!.replace(",", ".")) };
    if (tier.minQty < 2) throw new Error("A quantidade mínima de um desconto é 2");
    if (tier.percentOff <= 0 || tier.percentOff > MAX_BULK_PERCENT_OFF) throw new Error(`O desconto deve ficar entre 0 e ${MAX_BULK_PERCENT_OFF}%`);
    return tier;
  });
  if (new Set(tiers.map((t) => t.minQty)).size !== tiers.length) throw new Error("Quantidade repetida nos descontos");
  return tiers.sort((a, b) => a.minQty - b.minQty);
}

/** Unit price of a product in `currency` when buying `quantity` units (quantity discount applied). */
export function productUnitCents(product: { priceBrlCents: number; priceUsdCents: number; bulkDiscounts?: unknown }, currency: string, quantity: number): number {
  const base = currency === "BRL" ? product.priceBrlCents : product.priceUsdCents;
  return discountedUnitCents(base, bulkDiscountTiers(product.bulkDiscounts), quantity);
}
