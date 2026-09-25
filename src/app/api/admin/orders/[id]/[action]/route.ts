import { adminRoute, json } from "@/server/common/http";
import { Errors } from "@/server/common/errors";
import { hasRole } from "@/server/auth/roles";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { fulfillOutOfStockOrder, getOrderDetail, refundOrder, resendDelivery, syncOrderPayment } from "@/server/orders/orders.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/orders/:id/refund   (ADMIN)  refund through the gateway
 * POST /api/admin/orders/:id/resend   (STAFF)  re-send the delivery message
 * POST /api/admin/orders/:id/sync     (STAFF)  re-check the payment status at the provider
 * POST /api/admin/orders/:id/fulfill  (STAFF)  assign stock to a paid order that had none
 */
export const POST = adminRoute("STAFF", async ({ params, admin, ip }) => {
  const id = params.id!;
  switch (params.action) {
    case "refund": {
      if (!hasRole(admin.role, "ADMIN")) throw Errors.forbidden();
      const refund = await refundOrder(id, admin.id, ip);
      return json({ refund, order: await getOrderDetail(id) });
    }
    case "resend":
      await resendDelivery(id, admin.id);
      break;
    case "sync": {
      const status = await syncOrderPayment(id, { actorType: "ADMIN", adminId: admin.id });
      await audit({ actorType: "ADMIN", adminId: admin.id, ip, action: AuditActions.ORDER_UPDATED, resourceType: "order", resourceId: id, details: { action: "sync", status } });
      break;
    }
    case "fulfill":
      await fulfillOutOfStockOrder(id, admin.id, ip);
      break;
    default:
      throw Errors.notFound("Action");
  }
  return json({ order: await getOrderDetail(id) });
});
