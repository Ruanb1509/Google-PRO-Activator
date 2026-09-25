import type { ActorType, PaymentStatus } from "@/generated/prisma/enums";
import { db, type Tx } from "@/server/common/db";
import { logger } from "@/server/common/logger";
import { escapeHtml, t } from "@/i18n";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { orderEvent } from "@/server/orders/order-events";
import { releaseReservation, returnUndeliveredItem, sellForOrder } from "@/server/inventory/inventory.service";
import { deliverOrder } from "@/server/notifications/delivery.service";
import { alertAdmins, sendHtml } from "@/server/notifications/telegram";
import { availableStock } from "@/server/products/products.service";
import { getSettings } from "@/server/settings/settings.service";
import type { PaymentStatusResult } from "@/server/payments/payment-provider";

type Outcome =
  | { kind: "noop" }
  | { kind: "paid"; orderId: string; itemAssigned: boolean; productId: string }
  | { kind: "closed"; orderId: string; status: PaymentStatus }
  | { kind: "refunded"; orderId: string }
  | { kind: "mismatch"; orderId: string };

/** Locks the order row so concurrent webhooks / reconciliations for the same order are serialized. */
async function lockOrder(tx: Tx, orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
}

/**
 * Applies an AUTHORITATIVE payment status (fetched from the provider API after a verified webhook,
 * reconciliation, or the internal balance ledger). Fully idempotent: duplicate or out-of-order
 * notifications are no-ops. The inventory item is sold in the same DB transaction (commit or rollback).
 */
export async function applyPaymentStatus(paymentId: string, result: PaymentStatusResult, actor: { actorType: ActorType; adminId?: string }): Promise<Outcome> {
  const outcome = await db().$transaction(async (tx): Promise<Outcome> => {
    const pre = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { orderId: true } });
    await lockOrder(tx, pre.orderId);
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { order: true } });
    const order = payment.order;

    switch (result.status) {
      case "PENDING":
        return { kind: "noop" };

      case "PAID": {
        if (["PAID", "DELIVERED", "REFUNDED"].includes(order.status)) return { kind: "noop" };

        // Never deliver if the provider charged a different amount/currency than the order.
        const amountMismatch = result.amountCents !== undefined && result.amountCents !== order.amountCents;
        const currencyMismatch = result.currency !== undefined && result.currency.toUpperCase() !== order.currency;
        if (amountMismatch || currencyMismatch) {
          await tx.payment.update({ where: { id: payment.id }, data: { metadata: { ...((payment.metadata as object) ?? {}), mismatch: { amount: result.amountCents ?? null, currency: result.currency ?? null } } } });
          await orderEvent({ orderId: order.id, type: "AMOUNT_MISMATCH", actorType: actor.actorType, details: { expected: { amount: order.amountCents, currency: order.currency }, got: { amount: result.amountCents ?? null, currency: result.currency ?? null } } }, tx);
          return { kind: "mismatch", orderId: order.id };
        }

        const now = new Date();
        const country = result.country?.toUpperCase() ?? null;
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: "PAID", paidAt: now, country, providerReference: result.providerReference ?? payment.providerReference },
        });
        const itemId = await sellForOrder(tx, { productId: order.productId, orderId: order.id, userId: order.userId });
        await tx.order.update({ where: { id: order.id }, data: { status: "PAID", paidAt: now, country: country ?? order.country } });
        if (country) await tx.user.update({ where: { id: order.userId }, data: { country } });
        await orderEvent({ orderId: order.id, type: "PAYMENT_CONFIRMED", actorType: actor.actorType, adminId: actor.adminId, details: { provider: payment.provider, providerPaymentId: payment.providerPaymentId, lateAfterStatus: order.status !== "PENDING" ? order.status : null } }, tx);
        if (!itemId) await orderEvent({ orderId: order.id, type: "OUT_OF_STOCK_AFTER_PAYMENT", actorType: "SYSTEM" }, tx);
        await audit({ actorType: actor.actorType, adminId: actor.adminId, action: AuditActions.SALE, resourceType: "order", resourceId: order.id, details: { number: order.number, amountCents: order.amountCents, currency: order.currency, provider: payment.provider, itemId } }, tx);
        return { kind: "paid", orderId: order.id, itemAssigned: Boolean(itemId), productId: order.productId };
      }

      case "FAILED":
      case "EXPIRED":
      case "CANCELLED": {
        if (payment.status === "PENDING") await tx.payment.update({ where: { id: payment.id }, data: { status: result.status } });
        if (order.status !== "PENDING") return { kind: "noop" };
        await tx.order.update({ where: { id: order.id }, data: { status: result.status } });
        await releaseReservation(tx, order.id, `payment_${result.status.toLowerCase()}`);
        await orderEvent({ orderId: order.id, type: `PAYMENT_${result.status}`, actorType: actor.actorType, adminId: actor.adminId }, tx);
        if (result.status === "FAILED") {
          await audit({ actorType: actor.actorType, action: AuditActions.PAYMENT_FAILED, resourceType: "order", resourceId: order.id, details: { provider: payment.provider } }, tx);
        }
        return { kind: "closed", orderId: order.id, status: result.status };
      }

      case "REFUNDED": {
        if (payment.status === "REFUNDED" && order.status === "REFUNDED") return { kind: "noop" };
        await markRefunded(tx, { orderId: order.id, paymentId: payment.id, delivered: Boolean(order.deliveredAt), actor });
        return { kind: "refunded", orderId: order.id };
      }
    }
  });

  await afterCommit(outcome);
  return outcome;
}

/** Refund bookkeeping: the item goes back to stock ONLY if it was never delivered to the customer. */
export async function markRefunded(tx: Tx, args: { orderId: string; paymentId: string; delivered: boolean; actor: { actorType: ActorType; adminId?: string } }): Promise<void> {
  await tx.payment.update({ where: { id: args.paymentId }, data: { status: "REFUNDED" } });
  await tx.order.update({ where: { id: args.orderId }, data: { status: "REFUNDED", refundedAt: new Date() } });
  await releaseReservation(tx, args.orderId, "refunded");
  const returned = args.delivered ? false : await returnUndeliveredItem(tx, args.orderId);
  await orderEvent({ orderId: args.orderId, type: "REFUNDED", actorType: args.actor.actorType, adminId: args.actor.adminId, details: { itemReturnedToStock: returned } }, tx);
  await audit({ actorType: args.actor.actorType, adminId: args.actor.adminId, action: AuditActions.ORDER_REFUNDED, resourceType: "order", resourceId: args.orderId, details: { itemReturnedToStock: returned } }, tx);
}

async function afterCommit(outcome: Outcome): Promise<void> {
  try {
    if (outcome.kind === "paid") {
      if (outcome.itemAssigned) {
        await deliverOrder(outcome.orderId);
        await checkLowStock(outcome.productId);
      } else {
        const order = await db().order.findUniqueOrThrow({ where: { id: outcome.orderId }, include: { user: true } });
        const locale = order.user.locale ?? order.locale;
        await sendHtml(order.user.telegramId, t(locale, "paid_out_of_stock", { number: order.number })).catch(() => undefined);
        await alertAdmins(`🚨 Pedido <b>#${order.number}</b> foi PAGO mas o produto <b>${escapeHtml(order.productName)}</b> está sem estoque. Reponha o estoque e reenvie a entrega, ou reembolse.`);
      }
    } else if (outcome.kind === "refunded") {
      const order = await db().order.findUniqueOrThrow({ where: { id: outcome.orderId }, include: { user: true } });
      await sendHtml(order.user.telegramId, t(order.user.locale ?? order.locale, "order_refunded", { number: order.number })).catch(() => undefined);
    } else if (outcome.kind === "mismatch") {
      const order = await db().order.findUniqueOrThrow({ where: { id: outcome.orderId } });
      await alertAdmins(`🚨 Pedido <b>#${order.number}</b>: valor/moeda pagos não conferem com o pedido. Entrega bloqueada — verifique no painel.`);
    }
  } catch (err) {
    // Delivery is retried by maintenance; nothing here may undo the committed payment.
    logger.error("payment.after_commit_failed", { err, outcome });
  }
}

async function checkLowStock(productId: string): Promise<void> {
  const [product, settings, available] = await Promise.all([
    db().product.findUnique({ where: { id: productId } }),
    getSettings(),
    availableStock(productId),
  ]);
  if (!product) return;
  const threshold = product.lowStockThreshold ?? settings.lowStockThreshold;
  // Alert exactly when crossing the threshold and when it hits zero (avoids spamming on every sale).
  if (available === threshold - 1 || available === 0) {
    await alertAdmins(`⚠️ <b>Estoque baixo</b>\n\nProduto: <b>${escapeHtml(product.name)}</b>\nDisponível: <b>${available}</b> unidades`);
  }
}
