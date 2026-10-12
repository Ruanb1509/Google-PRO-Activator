import { adminRoute, json } from "@/server/common/http";
import { getOrderDelivery } from "@/server/notifications/delivery.service";

export const dynamic = "force-dynamic";

/** GET /api/admin/orders/:id/delivery  (STAFF) what the customer received, unmasked (audited). */
export const GET = adminRoute("STAFF", async ({ params, admin, ip }) => json({ delivery: await getOrderDelivery(params.id!, { adminId: admin.id, ip, via: "order" }) }));
