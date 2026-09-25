import { adminRoute, json, parseBody } from "@/server/common/http";
import { deleteProduct, getProduct, productUpdateSchema, updateProduct } from "@/server/products/products.service";

export const dynamic = "force-dynamic";

export const GET = adminRoute("VIEWER", async ({ params }) => json(await getProduct(params.id!)));

export const PATCH = adminRoute("STAFF", async ({ req, params, admin, ip }) => {
  const body = await parseBody(req, productUpdateSchema);
  return json(await updateProduct(params.id!, body, admin.id, ip));
});

export const DELETE = adminRoute("ADMIN", async ({ params, admin, ip }) => {
  await deleteProduct(params.id!, admin.id, ip);
  return json({ ok: true });
});
