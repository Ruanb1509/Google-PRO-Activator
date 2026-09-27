import { after } from "next/server";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { createProduct, listProducts, productInputSchema } from "@/server/products/products.service";
import { syncProductEmojis } from "@/server/products/product-emoji.service";

export const dynamic = "force-dynamic";

export const GET = adminRoute("VIEWER", async () => json({ items: await listProducts({ includeInactive: true }) }));

export const POST = adminRoute("STAFF", async ({ req, admin, ip }) => {
  const body = await parseBody(req, productInputSchema);
  const product = await createProduct(body, admin.id, ip);
  after(() => syncProductEmojis({ productId: product.id }).catch(() => undefined)); // bot button icon
  return json(product, { status: 201 });
});
