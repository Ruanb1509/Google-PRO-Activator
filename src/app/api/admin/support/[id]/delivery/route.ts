import { adminRoute, json } from "@/server/common/http";
import { getTicketDelivery } from "@/server/support/support.service";

export const dynamic = "force-dynamic";

/** GET /api/admin/support/:id/delivery?orderId=  (STAFF) what the customer received, unmasked (audited). */
export const GET = adminRoute("STAFF", async ({ req, params, admin, ip }) =>
  json({ delivery: await getTicketDelivery(params.id!, req.nextUrl.searchParams.get("orderId"), admin.id, ip) }),
);
