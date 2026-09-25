import { z } from "zod";
import type { Product } from "@/generated/prisma/client";
import { db } from "@/server/common/db";
import { Errors } from "@/server/common/errors";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { getSettings } from "@/server/settings/settings.service";

export const productInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  nameEn: z.string().trim().max(120).nullish(),
  description: z.string().trim().max(2000).default(""),
  descriptionEn: z.string().trim().max(2000).nullish(),
  category: z.string().trim().max(60).default(""),
  priceBrlCents: z.number().int().min(1).max(100_000_000),
  priceUsdCents: z.number().int().min(1).max(100_000_000),
  isActive: z.boolean().default(true),
  lowStockThreshold: z.number().int().min(0).max(100_000).nullish(),
  sortOrder: z.number().int().min(-1000).max(1000).default(0),
});
export type ProductInput = z.infer<typeof productInputSchema>;
export const productUpdateSchema = productInputSchema.partial();

export interface StockCounts {
  available: number;
  reserved: number;
  sold: number;
  invalid: number;
  cancelled: number;
}

const emptyCounts = (): StockCounts => ({ available: 0, reserved: 0, sold: 0, invalid: 0, cancelled: 0 });

/**
 * Stock per product. Reservations whose time ran out are counted as available (they are reclaimed
 * lazily when a new order is created, so the numbers match what customers can actually buy).
 */
export async function stockCounts(productIds?: string[]): Promise<Map<string, StockCounts>> {
  const rows = await db().$queryRaw<{ product_id: string; status: string; n: bigint }[]>`
    SELECT product_id,
           CASE WHEN status = 'RESERVED' AND reserved_until < now() THEN 'AVAILABLE' ELSE status::text END AS status,
           count(*) AS n
    FROM inventory_items
    GROUP BY 1, 2`;
  const map = new Map<string, StockCounts>();
  for (const r of rows) {
    if (productIds && !productIds.includes(r.product_id)) continue;
    const c = map.get(r.product_id) ?? emptyCounts();
    const key = r.status.toLowerCase() as keyof StockCounts;
    if (key in c) c[key] += Number(r.n);
    map.set(r.product_id, c);
  }
  return map;
}

export async function availableStock(productId: string): Promise<number> {
  const rows = await db().$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM inventory_items
    WHERE product_id = ${productId}
      AND (status = 'AVAILABLE' OR (status = 'RESERVED' AND reserved_until < now()))`;
  return Number(rows[0]?.n ?? 0);
}

export async function listProducts(opts: { includeInactive?: boolean } = {}) {
  const products = await db().product.findMany({
    where: { deletedAt: null, ...(opts.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const [counts, settings] = await Promise.all([stockCounts(products.map((p) => p.id)), getSettings()]);
  return products.map((p) => {
    const stock = counts.get(p.id) ?? emptyCounts();
    const threshold = p.lowStockThreshold ?? settings.lowStockThreshold;
    return { ...p, stock, lowStockThreshold: threshold, lowStock: p.isActive && stock.available < threshold };
  });
}

export async function getProduct(id: string) {
  const product = await db().product.findFirst({ where: { id, deletedAt: null } });
  if (!product) throw Errors.notFound("Product");
  const [counts, settings] = await Promise.all([stockCounts([id]), getSettings()]);
  const stock = counts.get(id) ?? emptyCounts();
  const threshold = product.lowStockThreshold ?? settings.lowStockThreshold;
  return { ...product, stock, effectiveLowStockThreshold: threshold, lowStock: stock.available < threshold };
}

export async function createProduct(input: ProductInput, adminId: string, ip: string | null): Promise<Product> {
  const product = await db().product.create({ data: input });
  await audit({ actorType: "ADMIN", adminId, ip, action: AuditActions.PRODUCT_CREATED, resourceType: "product", resourceId: product.id, details: { ...input } });
  return product;
}

export async function updateProduct(id: string, input: z.infer<typeof productUpdateSchema>, adminId: string, ip: string | null): Promise<Product> {
  const before = await db().product.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw Errors.notFound("Product");
  const product = await db().product.update({ where: { id }, data: input });

  const priceChanged = before.priceBrlCents !== product.priceBrlCents || before.priceUsdCents !== product.priceUsdCents;
  if (priceChanged) {
    await audit({
      actorType: "ADMIN",
      adminId,
      ip,
      action: AuditActions.PRODUCT_PRICE_CHANGED,
      resourceType: "product",
      resourceId: id,
      details: {
        from: { brl: before.priceBrlCents, usd: before.priceUsdCents },
        to: { brl: product.priceBrlCents, usd: product.priceUsdCents },
      },
    });
  }
  await audit({ actorType: "ADMIN", adminId, ip, action: AuditActions.PRODUCT_UPDATED, resourceType: "product", resourceId: id, details: { changes: { ...input } } });
  return product;
}

/** Soft delete: keeps order history; available stock is cancelled so it can never be sold. */
export async function deleteProduct(id: string, adminId: string, ip: string | null): Promise<void> {
  const product = await db().product.findFirst({ where: { id, deletedAt: null } });
  if (!product) throw Errors.notFound("Product");
  const pending = await db().order.count({ where: { productId: id, status: "PENDING" } });
  if (pending > 0) throw Errors.conflict("Produto possui pedidos pendentes. Desative-o e aguarde os pedidos expirarem.");
  await db().$transaction([
    db().product.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
    db().inventoryItem.updateMany({ where: { productId: id, status: "AVAILABLE" }, data: { status: "CANCELLED" } }),
  ]);
  await audit({ actorType: "ADMIN", adminId, ip, action: AuditActions.PRODUCT_DELETED, resourceType: "product", resourceId: id, details: { name: product.name } });
}

export function localizedName(p: Pick<Product, "name" | "nameEn">, locale: "pt_BR" | "en_US"): string {
  return locale === "en_US" && p.nameEn ? p.nameEn : p.name;
}

export function localizedDescription(p: Pick<Product, "description" | "descriptionEn">, locale: "pt_BR" | "en_US"): string {
  return locale === "en_US" && p.descriptionEn ? p.descriptionEn : p.description;
}
