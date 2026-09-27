import { after } from "next/server";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { deleteProduct, getProduct, productUpdateSchema, updateProduct } from "@/server/products/products.service";
import { syncProductEmojis } from "@/server/products/product-emoji.service";

export const dynamic = "force-dynamic";

export const GET = adminRoute("VIEWER", async ({ params }) => json(await getProduct(params.id!)));

export const PATCH = adminRoute("STAFF", async ({ req, params, admin, ip }) => {
  const body = await parseBody(req, productUpdateSchema);
  const product = await updateProduct(params.id!, body, admin.id, ip);
  after(() => syncProductEmojis({ productId: product.id }).catch(() => undefined)); // bot button icon
  return json(product);
});

export const DELETE = adminRoute("ADMIN", async ({ params, admin, ip }) => {
  await deleteProduct(params.id!, admin.id, ip);
  after(() => syncProductEmojis({ productId: params.id! }).catch(() => undefined)); // frees the emoji slot
  return json({ ok: true });
});
