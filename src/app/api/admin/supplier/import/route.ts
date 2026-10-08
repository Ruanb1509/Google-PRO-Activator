import { after } from "next/server";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { importSchema, importSupplierProduct } from "@/server/supplier/supplier-admin.service";
import { syncProductEmojis } from "@/server/products/product-emoji.service";

export const dynamic = "force-dynamic";

export const POST = adminRoute("STAFF", async ({ req, admin, ip }) => {
  const body = await parseBody(req, importSchema);
  const product = await importSupplierProduct(body, admin.id, ip);
  after(() => syncProductEmojis({ productId: product.id }).catch(() => undefined)); // bot button icon
  return json(product, { status: 201 });
});
