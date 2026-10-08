import { z } from "zod";
import { db } from "@/server/common/db";
import { AppError } from "@/server/common/errors";
import { createProduct } from "@/server/products/products.service";
import { partnerApi, partnerConfigured, PartnerApiError, usdToCents } from "@/server/supplier/partner-api.client";
import { supplierCatalog } from "@/server/supplier/supplier-stock";

/** Dashboard view of the supplier: wallet balance and catalog, each item with the store products linked to it. */
export async function supplierOverview() {
  if (!partnerConfigured()) return { configured: false as const };
  try {
    const [balance, catalog, linked] = await Promise.all([
      partnerApi.balance(),
      supplierCatalog({ fresh: true }),
      db().product.findMany({ where: { deletedAt: null, supplierSlug: { not: null } }, select: { id: true, name: true, supplierSlug: true } }),
    ]);
    return {
      configured: true as const,
      balanceCents: usdToCents(balance.balance),
      products: [...catalog.values()].map((p) => ({
        slug: p.slug,
        name: p.name,
        provider: p.provider.name,
        deliveryType: p.deliveryType,
        costCents: usdToCents(p.yourPrice),
        durationDays: p.durationDays ?? null,
        warrantyDays: p.warranty?.enabled ? p.warranty.days : null,
        inStock: p.stock.inStock,
        stock: p.stock.count,
        linkedProducts: linked.filter((l) => l.supplierSlug === p.slug).map((l) => ({ id: l.id, name: l.name })),
      })),
    };
  } catch (err) {
    if (err instanceof PartnerApiError) throw new AppError("SUPPLIER_ERROR", `Fornecedor: ${err.code} — ${err.message}`, 502);
    throw err;
  }
}

export const importSchema = z.object({
  slug: z.string().trim().regex(/^[A-Za-z0-9._-]{1,120}$/),
  priceBrlCents: z.number().int().min(1).max(100_000_000),
  priceUsdCents: z.number().int().min(1).max(100_000_000),
  supplierMaxCostCents: z.number().int().min(1).max(100_000_000).nullish(),
});

/** HTML description -> plain text (the bot formats descriptions itself). */
function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Creates a store product from a supplier catalog item, already linked to it (sold entirely from the supplier until stock is added). */
export async function importSupplierProduct(input: z.infer<typeof importSchema>, adminId: string, ip: string | null) {
  let detail;
  try {
    detail = await partnerApi.product(input.slug);
  } catch (err) {
    if (err instanceof PartnerApiError) throw new AppError("SUPPLIER_ERROR", `Fornecedor: ${err.code} — ${err.message}`, 502);
    throw err;
  }
  const description = [detail.description ? plainText(detail.description) : "", detail.instructions ? plainText(detail.instructions) : ""].filter(Boolean).join("\n\n");
  return createProduct(
    {
      name: detail.name.slice(0, 120),
      description: description.slice(0, 2000),
      category: detail.provider.name.slice(0, 60),
      priceBrlCents: input.priceBrlCents,
      priceUsdCents: input.priceUsdCents,
      isActive: true,
      sortOrder: 0,
      supplierSlug: detail.slug,
      supplierMaxCostCents: input.supplierMaxCostCents ?? null,
    },
    adminId,
    ip,
  );
}
