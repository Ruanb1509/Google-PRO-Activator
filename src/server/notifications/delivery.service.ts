import type { Product } from "@/generated/prisma/client";
import type { Locale } from "@/generated/prisma/enums";
import { db } from "@/server/common/db";
import { decrypt } from "@/server/common/crypto";
import { logger } from "@/server/common/logger";
import { t, escapeHtml, formatItems } from "@/i18n";
import { Errors } from "@/server/common/errors";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { orderEvent } from "@/server/orders/order-events";
import { downloadKeyboard, FILE_EXPORT_MIN_QTY } from "@/server/notifications/delivery-file";
import { alertAdmins, sendHtml } from "@/server/notifications/telegram";
import { localizedName } from "@/server/products/products.service";

const MAX_ATTEMPTS = 8;

/** The exact Telegram HTML the customer gets when an order is delivered (also previewed in support). */
export function deliveryMessageHtml(
  order: { number: number; quantity: number; product: Pick<Product, "name" | "nameEn"> },
  values: string[],
  locale: Locale,
): string {
  return t(
    locale,
    "payment_confirmed",
    { product: localizedName(order.product, locale), quantity: order.quantity, number: order.number },
    { items: formatItems(values, locale) },
  );
}

export type DeliveryOutcome = "delivered" | "skipped" | "failed";

/**
 * Sends the purchased items to the customer. The items were already bound to the order (SOLD) in the
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
    include: { user: true, product: true, inventoryItems: { where: { status: "SOLD" }, orderBy: { createdAt: "asc" } } },
  });
  const items = order.inventoryItems;
  // Only deliver once every unit is assigned (a paid order that ran out of stock waits for an admin).
  if (items.length < order.quantity) {
    await db().order.update({ where: { id: orderId }, data: { deliveryLockedUntil: null, deliveryError: "NO_ITEM" } });
    return "skipped";
  }

  const locale = order.user.locale ?? order.locale;
  try {
    const html = deliveryMessageHtml(order, items.map((i) => decrypt(i.valueEncrypted)), locale);
    await sendHtml(order.user.telegramId, html, items.length >= FILE_EXPORT_MIN_QTY ? downloadKeyboard(order.id, locale) : undefined);
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
      inventoryItems: { some: { status: "SOLD" } },
      OR: [{ deliveryLockedUntil: null }, { deliveryLockedUntil: { lt: new Date() } }],
    },
    orderBy: { paidAt: "asc" },
    take: limit,
    select: { id: true, quantity: true, _count: { select: { inventoryItems: { where: { status: "SOLD" } } } } },
  });
  let delivered = 0;
  for (const o of orders) {
    if (o._count.inventoryItems < o.quantity) continue; // still missing stock
    if ((await deliverOrder(o.id)) === "delivered") delivered++;
  }
  return delivered;
}

/**
 * What the customer actually received for an order: the clear links/codes (no masking), the delivery
 * message rendered with the same template and language the bot used, and how it was delivered.
 * `userId` restricts the lookup to that customer's orders. Every view is audited.
 */
export async function getOrderDelivery(orderId: string, viewer: { adminId: string; ip: string | null; via: "order" | "support"; ticket?: number; userId?: string }) {
  const order = await db().order.findFirst({
    where: { id: orderId, ...(viewer.userId ? { userId: viewer.userId } : {}) },
    include: {
      user: { select: { locale: true } },
      product: { select: { name: true, nameEn: true } },
      inventoryItems: { where: { status: "SOLD" }, orderBy: { createdAt: "asc" }, select: { valueEncrypted: true } },
      events: { where: { type: { in: ["DELIVERED", "DELIVERY_RESENT", "DELIVERY_FAILED"] } }, orderBy: { createdAt: "asc" }, select: { type: true, actorType: true, message: true, createdAt: true } },
    },
  });
  if (!order) throw Errors.notFound("Order");

  const items = order.inventoryItems.map((i) => decrypt(i.valueEncrypted));
  // Same rule as the delivery: the locale the customer has now, falling back to the order's.
  const locale = order.user.locale ?? order.locale;
  await audit({
    actorType: "ADMIN",
    adminId: viewer.adminId,
    ip: viewer.ip,
    action: AuditActions.DELIVERY_VIEWED,
    resourceType: "order",
    resourceId: order.id,
    details: { via: viewer.via, order: order.number, items: items.length, ...(viewer.ticket ? { ticket: viewer.ticket } : {}) },
  });
  return {
    orderId: order.id,
    number: order.number,
    productName: order.productName,
    quantity: order.quantity,
    status: order.status,
    paidAt: order.paidAt,
    deliveredAt: order.deliveredAt,
    deliveryError: order.deliveryError,
    locale,
    items,
    messageHtml: items.length >= order.quantity ? deliveryMessageHtml(order, items, locale) : null,
    events: order.events,
  };
}
