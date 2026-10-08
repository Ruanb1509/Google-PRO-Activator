import { after } from "next/server";
import { adminRoute, json } from "@/server/common/http";
import { logger } from "@/server/common/logger";
import { promoPreview, startPromoBroadcast } from "@/server/products/promo.service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Preview of the quantity-discount promotion and how many customers would get it. */
export const GET = adminRoute("ADMIN", async ({ params }) => json(await promoPreview(params.id!)));

/** Sends the promotion to every customer (in the background; admins get a summary alert at the end). */
export const POST = adminRoute("ADMIN", async ({ params, admin, ip }) => {
  const { recipients, run } = await startPromoBroadcast(params.id!, { adminId: admin.id, ip });
  after(() => run().catch((err) => logger.error("promo.broadcast_failed", { err, productId: params.id })));
  return json({ recipients });
});
