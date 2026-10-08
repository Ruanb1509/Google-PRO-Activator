import { z } from "zod";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { purchaseToStock } from "@/server/supplier/supplier.service";

export const dynamic = "force-dynamic";

/** Buys units from the linked supplier into the product's own stock (charged from the supplier wallet). */
export const POST = adminRoute("STAFF", async ({ req, params, admin, ip }) => {
  const { quantity } = await parseBody(req, z.object({ quantity: z.number().int().min(1).max(50) }));
  return json(await purchaseToStock(params.id!, quantity, { adminId: admin.id, ip }));
});
