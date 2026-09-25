import { adminRoute, json, parseBody } from "@/server/common/http";
import { createProduct, listProducts, productInputSchema } from "@/server/products/products.service";

export const dynamic = "force-dynamic";

export const GET = adminRoute("VIEWER", async () => json({ items: await listProducts({ includeInactive: true }) }));

export const POST = adminRoute("STAFF", async ({ req, admin, ip }) => {
  const body = await parseBody(req, productInputSchema);
  return json(await createProduct(body, admin.id, ip), { status: 201 });
});
