import { db } from "@/server/common/db";
import { decrypt } from "@/server/common/crypto";
import { logger } from "@/server/common/logger";
import { t, escapeHtml } from "@/i18n";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { orderEvent } from "@/server/orders/order-events";
import { alertAdmins, sendHtml } from "@/server/notifications/telegram";
import { localizedName } from "@/server/products/products.service";

const MAX_ATTEMPTS = 8;

export type DeliveryOutcome = "delivered" | "skipped" | "failed";

/**
 * Sends the purchased item to the customer. The item was already bound to the order (SOLD) in the
 * payment transaction; this step only notifies. A short DB lease prevents two concurrent senders
 * (webhook retry + cron) from sending the same message twice.
 */
export async function deliverOrder(orderId: string, opts: { resend?: boolean; adminId?: string } = {}): Promise<DeliveryOutcome> {
  const statuses = opts.resend ? ["PAID", "DELIVERED"] : ["PAID"];
  const claimed = await db().$queryRaw<{ id: string }[]>`
    UPDATE orders SET delivery_locked_until = now() + interval '60 seconds',
                      delivery_attempts = delivery_attempts + 1,
                      updated_at = now()
    WHERE id = ${orderId}
      AND status::text = ANY(${statuses})
      AND (delivery_locked_until IS NULL OR delivery_locked_until < now())
    RETURNING id`;
  if (!claimed[0]) return "skipped";

  const order = await db().order.findUniqueOrThrow({
    where: { id: orderId },
    include: { user: true, product: true, inventoryItem: true },
  });
  const item = order.inventoryItem;
  if (!item || item.status !== "SOLD") {
    await db().order.update({ where: { id: orderId }, data: { deliveryLockedUntil: null, deliveryError: "NO_ITEM" } });
    return "skipped";
  }

  const locale = order.user.locale ?? order.locale;
  try {
    const html = t(locale, "payment_confirmed", {
      product: localizedName(order.product, locale),
      item: decrypt(item.valueEncrypted),
      number: order.number,
    });
    await sendHtml(order.user.telegramId, html);
    await db().order.updateMany({
      where: { id: orderId, status: { in: ["PAID", "DELIVERED"] } },
      data: { status: "DELIVERED", deliveredAt: order.deliveredAt ?? new Date(), deliveryError: null, deliveryLockedUntil: null },
    });
    await orderEvent({ orderId, type: opts.resend ? "DELIVERY_RESENT" : "DELIVERED", actorType: opts.adminId ? "ADMIN" : "SYSTEM", adminId: opts.adminId });
    if (opts.resend) {
      await audit({ actorType: "ADMIN", adminId: opts.adminId, action: AuditActions.DELIVERY_RESENT, resourceType: "order", resourceId: orderId });
    }
    return "delivered";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("delivery.failed", { err, orderId, attempt: order.deliveryAttempts });
    await db().order.update({ where: { id: orderId }, data: { deliveryError: message.slice(0, 500), deliveryLockedUntil: null } });
    await orderEvent({ orderId, type: "DELIVERY_FAILED", message: message.slice(0, 500), actorType: "SYSTEM", details: { attempt: order.deliveryAttempts } });
    await audit({ actorType: "SYSTEM", action: AuditActions.DELIVERY_FAILED, resourceType: "order", resourceId: orderId, details: { error: message.slice(0, 300), attempt: order.deliveryAttempts } });
    if (order.deliveryAttempts === 3 || order.deliveryAttempts === MAX_ATTEMPTS) {
      await alertAdmins(`⚠️ Falha na entrega do pedido <b>#${order.number}</b> (tentativa ${order.deliveryAttempts}): ${escapeHtml(message.slice(0, 200))}`);
    }
    return "failed";
  }
}

/** Retries paid-but-undelivered orders (called by maintenance). */
export async function retryPendingDeliveries(limit = 20): Promise<number> {
  const orders = await db().order.findMany({
    where: {
      status: "PAID",
      deliveryAttempts: { lt: MAX_ATTEMPTS },
      inventoryItem: { is: { status: "SOLD" } },
      OR: [{ deliveryLockedUntil: null }, { deliveryLockedUntil: { lt: new Date() } }],
    },
    orderBy: { paidAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let delivered = 0;
  for (const o of orders) if ((await deliverOrder(o.id)) === "delivered") delivered++;
  return delivered;
}
