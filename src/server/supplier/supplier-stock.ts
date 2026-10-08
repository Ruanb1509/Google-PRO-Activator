import type { Product } from "@/generated/prisma/client";
import { logger } from "@/server/common/logger";
import { partnerApi, partnerConfigured, usdToCents, type PartnerProduct } from "@/server/supplier/partner-api.client";

/** The Partner API recommends caching the catalog for 60–120 s (rate limit: 60 requests/min per key). */
const CATALOG_TTL_MS = 60_000;

let cache: { at: number; bySlug: Map<string, PartnerProduct> } | null = null;
let inflight: Promise<Map<string, PartnerProduct>> | null = null;

/** Supplier catalog by slug, cached per instance. `fresh` skips the cache (used right before buying). */
export async function supplierCatalog(opts: { fresh?: boolean } = {}): Promise<Map<string, PartnerProduct>> {
  if (!opts.fresh && cache && Date.now() - cache.at < CATALOG_TTL_MS) return cache.bySlug;
  inflight ??= partnerApi
    .products()
    .then((products) => {
      cache = { at: Date.now(), bySlug: new Map(products.map((p) => [p.slug, p])) };
      return cache.bySlug;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

type SupplierFields = Pick<Product, "supplierSlug" | "supplierMaxCostCents" | "priceUsdCents">;

/** Most paid to the supplier for one unit: the configured limit, or else the USD sale price (never sell at a loss). */
export function supplierMaxCost(product: SupplierFields): number {
  return product.supplierMaxCostCents ?? product.priceUsdCents;
}

/** Units the supplier can deliver for this product right now (0 when unlinked, sold out, too expensive or unreachable). */
export function supplierUnitsFrom(catalog: Map<string, PartnerProduct>, product: SupplierFields): number {
  if (!product.supplierSlug) return 0;
  const item = catalog.get(product.supplierSlug);
  if (!item?.stock.inStock) return 0;
  if (usdToCents(item.yourPrice) > supplierMaxCost(product)) return 0;
  return Math.max(0, Math.min(item.stock.count, item.stock.maxQuantity));
}

/** Supplier units per product id. Fails closed: if the supplier cannot be reached, it adds no stock. */
export async function supplierUnits(products: (SupplierFields & { id: string })[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const linked = products.filter((p) => p.supplierSlug);
  if (!linked.length || !partnerConfigured()) return out;
  try {
    const catalog = await supplierCatalog();
    for (const p of linked) out.set(p.id, supplierUnitsFrom(catalog, p));
  } catch (err) {
    logger.warn("supplier.catalog_failed", { err });
  }
  return out;
}
