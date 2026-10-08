import type { Prisma, User } from "@/generated/prisma/client";
import { productUnitCents } from "@/lib/bulk-discounts";
import type { OrderStatus } from "@/generated/prisma/enums";
import { db } from "@/server/common/db";
import { AppError, Errors } from "@/server/common/errors";
import { logger } from "@/server/common/logger";
import { decrypt } from "@/server/common/crypto";
import { enforceRateLimit } from "@/server/common/rate-limit";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { orderEvent } from "@/server/orders/order-events";
import { applyPaymentStatus } from "@/server/orders/payment-lifecycle.service";
import { releaseReservation, reserveForOrder, sellForOrder } from "@/server/inventory/inventory.service";
import { getProvider } from "@/server/payments/registry";
import { getSettings, type PaymentMethodConfig } from "@/server/settings/settings.service";
import { localizedName } from "@/server/products/products.service";
import { deliverOrder } from "@/server/notifications/delivery.service";
import { supplierUnits } from "@/server/supplier/supplier-stock";
import { fulfillFromSupplier } from "@/server/supplier/supplier.service";
import { InsufficientBalanceError } from "@/server/wallet/ledger.service";
import type { CreatePaymentResult } from "@/server/payments/payment-provider";

/** Most units of one product a customer can buy in a single order (keeps the delivery message short). */
export const MAX_QUANTITY_PER_ORDER = 100;

/** Amount charged for `quantity` units with this method: quantity discount, then the method's surcharge (e.g. card fee). */
export function methodAmountCents(product: { priceBrlCents: number; priceUsdCents: number; bulkDiscounts?: unknown }, method: Pick<PaymentMethodConfig, "currency" | "surchargePercent">, quantity: number): number {
  const subtotal = productUnitCents(product, method.currency, quantity) * quantity;
  return Math.round((subtotal * (100 + (method.surchargePercent ?? 0))) / 100);
}

/** Enabled methods whose provider is configured, customer-locale suggestions first. */
export async function availablePaymentMethods(locale: "pt_BR" | "en_US"): Promise<PaymentMethodConfig[]> {
  const settings = await getSettings();
  return settings.paymentMethods
    .filter((m) => {
      if (!m.enabled) return false;
      try {
        const p = getProvider(m.provider);
        return p.isConfigured() && p.supportedCurrencies.includes(m.currency);
      } catch {
        return false;
      }
    })
    .sort((a, b) => Number(b.suggestedForLocales.includes(locale)) - Number(a.suggestedForLocales.includes(locale)));
}

export interface CreatedOrder {
  orderId: string;
  number: number;
  amountCents: number;
  currency: "BRL" | "USD";
  productName: string;
  quantity: number;
  expiresAt: Date;
  method: PaymentMethodConfig;
  payment: CreatePaymentResult;
  reused: boolean;
}

export async function createOrder(user: User, productId: string, methodKey: string, quantity = 1): Promise<CreatedOrder> {
  if (user.isBlocked) throw Errors.forbidden("User blocked");
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY_PER_ORDER) throw Errors.badRequest("Invalid quantity", "INVALID_QUANTITY");
  const locale = user.locale ?? "en_US";
  const settings = await getSettings();
  const method = (await availablePaymentMethods(locale)).find((m) => m.key === methodKey);
  if (!method) throw Errors.badRequest("Payment method unavailable", "METHOD_UNAVAILABLE");
  const provider = getProvider(method.provider);

  const product = await db().product.findFirst({ where: { id: productId, isActive: true, deletedAt: null } });
  if (!product) throw Errors.notFound("Product");

  await enforceRateLimit(`order:create:${user.id}`, 8, 600);

  // Re-use an open order for the same product/method/quantity instead of creating duplicates on repeated taps.
  const open = await db().order.findFirst({
    where: { userId: user.id, productId, quantity, paymentMethod: method.key, status: "PENDING", expiresAt: { gt: new Date(Date.now() + 2 * 60 * 1000) } },
    include: { payment: true },
    orderBy: { createdAt: "desc" },
  });
  if (open?.payment?.providerPaymentId) {
    const meta = (open.payment.metadata ?? {}) as { pixQrBase64?: string };
    return {
      orderId: open.id,
      number: open.number,
      amountCents: open.amountCents,
      currency: open.currency,
      productName: open.productName,
      quantity: open.quantity,
      expiresAt: open.expiresAt,
      method,
      reused: true,
      payment: {
        providerPaymentId: open.payment.providerPaymentId,
        status: open.payment.status,
        checkoutUrl: open.payment.checkoutUrl ?? undefined,
        pixCopyPaste: open.payment.pixCopyPaste ?? undefined,
        pixQrBase64: meta.pixQrBase64,
      },
    };
  }

  const assertPendingLimit = async (tx: Prisma.TransactionClient) => {
    // Counts every order that still holds a reservation (reservations end when the order expires).
    const pending = await tx.order.count({ where: { userId: user.id, status: "PENDING", expiresAt: { gt: new Date() } } });
    if (pending >= settings.maxPendingOrdersPerUser) throw new AppError("TOO_MANY_PENDING", "Too many pending orders", 409);
  };
  await assertPendingLimit(db());

  const currency = method.currency;
  const amountCents = methodAmountCents(product, method, quantity);
  if (method.provider === "balance" && user.balanceCents < amountCents) throw new InsufficientBalanceError(user.balanceCents);

  // The order (and the stock it reserves) expires after `orderTtlMinutes`. Some providers require longer
  // lived charges (e.g. PIX >= 30 min); maintenance cancels those at the provider once the order expires,
  // and a payment that still lands late is handled like any late payment (stock permitting).
  const expiresAt = new Date(Date.now() + settings.orderTtlMinutes * 60 * 1000);
  const providerExpiresAt = new Date(Date.now() + Math.max(settings.orderTtlMinutes, provider.minTtlMinutes ?? 0) * 60 * 1000);
  const productName = localizedName(product, locale);
  // Units the supplier can deliver if the local stock is not enough (bought after the payment).
  const supplier = (await supplierUnits([product])).get(product.id) ?? 0;

  // 1) Order + temporary stock reservation, atomically.
  const order = await db().$transaction(async (tx) => {
    // Serialises concurrent checkouts of the same user so the pending-order limit cannot be raced.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order:create:${user.id}`}))`;
    await assertPendingLimit(tx);
    const o = await tx.order.create({
      data: { userId: user.id, productId, productName, quantity, status: "PENDING", currency, amountCents, paymentMethod: method.key, locale, expiresAt },
    });
    await reserveForOrder(tx, { productId, orderId: o.id, userId: user.id, quantity, until: expiresAt, supplierUnits: supplier });
    await tx.payment.create({ data: { orderId: o.id, provider: provider.name, idempotencyKey: o.id, currency, amountCents } });
    await orderEvent({ orderId: o.id, type: "CREATED", actorType: "BOT", details: { method: method.key, provider: provider.name, quantity, amountCents, currency } }, tx);
    return o;
  });

  // 2) Charge creation at the provider (outside the DB transaction; idempotency key = order id).
  let result: CreatePaymentResult;
  try {
    result = await provider.createPayment({
      orderId: order.id,
      orderNumber: order.number,
      userId: user.id,
      telegramId: user.telegramId.toString(),
      amountCents,
      currency,
      description: `${quantity > 1 ? `${quantity}x ` : ""}${productName} #${order.number}`,
      idempotencyKey: order.id,
      expiresAt: providerExpiresAt,
      locale,
    });
  } catch (err) {
    // Business refusals (e.g. insufficient balance) are expected; provider/network failures are errors.
    if (err instanceof AppError) logger.info("order.payment_refused", { code: err.code, orderId: order.id, provider: provider.name });
    else logger.error("order.create_payment_failed", { err, orderId: order.id, provider: provider.name });
    await db().$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { status: "FAILED" } });
      await tx.payment.update({ where: { orderId: order.id }, data: { status: "FAILED" } });
      await releaseReservation(tx, order.id, "payment_creation_failed");
      await orderEvent({ orderId: order.id, type: "PAYMENT_CREATION_FAILED", actorType: "SYSTEM", message: err instanceof Error ? err.message.slice(0, 300) : "error" }, tx);
    });
    if (err instanceof AppError) throw err;
    throw new AppError("PAYMENT_PROVIDER_ERROR", "Could not create payment", 502);
  }

  const payment = await db().payment.update({
    where: { orderId: order.id },
    data: {
      providerPaymentId: result.providerPaymentId,
      providerReference: result.providerReference,
      checkoutUrl: result.checkoutUrl,
      pixCopyPaste: result.pixCopyPaste,
      metadata: { ...(result.metadata ?? {}), ...(result.pixQrBase64 ? { pixQrBase64: result.pixQrBase64 } : {}) } as Prisma.InputJsonValue,
    },
  });
  await orderEvent({ orderId: order.id, type: "PAYMENT_CREATED", actorType: "SYSTEM", details: { providerPaymentId: result.providerPaymentId } });

  // Internal providers (balance) confirm synchronously; the status still comes from the provider/ledger.
  if (result.status === "PAID") {
    const status = await provider.getPaymentStatus(result.providerPaymentId);
    await applyPaymentStatus(payment.id, status, { actorType: "SYSTEM" });
  }

  return { orderId: order.id, number: order.number, amountCents, currency, productName, quantity, expiresAt, method, payment: result, reused: false };
}

/**
 * Asks the provider for the real payment status ("Check payment" button / reconciliation).
 * The customer's claim is never used - only the provider's API answer.
 */
export async function syncOrderPayment(orderId: string, actor: { actorType: "BOT" | "SYSTEM" | "ADMIN"; adminId?: string } = { actorType: "SYSTEM" }) {
  const payment = await db().payment.findUnique({ where: { orderId } });
  if (!payment?.providerPaymentId) return null;
  const provider = getProvider(payment.provider);
  const status = await provider.getPaymentStatus(payment.providerPaymentId);
  await applyPaymentStatus(payment.id, status, actor);
  return status.status;
}

/** Customer-initiated cancellation of an unpaid order. */
export async function cancelOrderByUser(userId: string, orderId: string): Promise<{ number: number } | null> {
  const order = await db().order.findFirst({ where: { id: orderId, userId }, include: { payment: true } });
  if (!order || order.status !== "PENDING") return null;
  return (await cancelPendingOrder(order, { actorType: "BOT" }, "cancelled_by_user")) ? { number: order.number } : null;
}

/** Admin cancellation of an unpaid order: cancels the charge at the provider and puts the reserved item back in stock. */
export async function cancelOrderByAdmin(orderId: string, adminId: string, ip: string | null): Promise<void> {
  const order = await db().order.findUnique({ where: { id: orderId }, include: { payment: true } });
  if (!order) throw Errors.notFound("Order");
  if (order.status !== "PENDING") throw Errors.conflict("Só pedidos pendentes podem ser cancelados");
  if (!(await cancelPendingOrder(order, { actorType: "ADMIN", adminId }, "cancelled_by_admin"))) {
    throw Errors.conflict("O pedido foi pago ou alterado enquanto era cancelado; verifique o status");
  }
  await audit({ actorType: "ADMIN", adminId, ip, action: AuditActions.ORDER_UPDATED, resourceType: "order", resourceId: orderId, details: { action: "cancel" } });
}

async function cancelPendingOrder(
  order: { id: string; payment: { provider: string; providerPaymentId: string | null } | null },
  actor: { actorType: "BOT" | "ADMIN"; adminId?: string },
  reason: string,
): Promise<boolean> {
  // First make sure it was not paid in the meantime.
  const status = await syncOrderPayment(order.id, actor).catch(() => null);
  if (status && status !== "PENDING") return false;
  if (order.payment?.providerPaymentId) {
    const provider = getProvider(order.payment.provider);
    await provider.cancelPayment?.(order.payment.providerPaymentId).catch((err) => logger.warn("order.cancel_at_provider_failed", { err, orderId: order.id }));
  }
  return db().$transaction(async (tx) => {
    const res = await tx.order.updateMany({ where: { id: order.id, status: "PENDING" }, data: { status: "CANCELLED" } });
    if (res.count === 0) return false;
    await tx.payment.updateMany({ where: { orderId: order.id, status: "PENDING" }, data: { status: "CANCELLED" } });
    await releaseReservation(tx, order.id, reason);
    await orderEvent({ orderId: order.id, type: "CANCELLED", ...actor }, tx);
    return true;
  });
}

// ───────────────────────── Queries ─────────────────────────

export async function listUserOrders(userId: string, take = 10) {
  return db().order.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take });
}

/** Customer view of one of their own orders, including the delivered items (only once every unit is assigned). */
export async function getUserOrder(userId: string, orderId: string) {
  const order = await db().order.findFirst({
    where: { id: orderId, userId },
    include: { inventoryItems: { where: { status: "SOLD" }, orderBy: { createdAt: "asc" } }, payment: true },
  });
  if (!order) return null;
  const canSeeItems = ["PAID", "DELIVERED"].includes(order.status) && order.inventoryItems.length >= order.quantity;
  if (canSeeItems && !order.deliveredAt) {
    // The customer is about to see the items: they count as delivered (so a later refund never returns them to stock).
    await db().order.updateMany({ where: { id: order.id, status: "PAID" }, data: { status: "DELIVERED", deliveredAt: new Date(), deliveryError: null } });
    await orderEvent({ orderId: order.id, type: "DELIVERED", actorType: "BOT", message: "Items shown in the customer's order view" });
  }
  return { order, items: canSeeItems ? order.inventoryItems.map((i) => decrypt(i.valueEncrypted)) : [] };
}

export interface OrderFilters {
  status?: OrderStatus;
  delivered?: "yes" | "no";
  productId?: string;
  userId?: string;
  q?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export async function listOrders(f: OrderFilters) {
  const where: Prisma.OrderWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.productId ? { productId: f.productId } : {}),
    ...(f.userId ? { userId: f.userId } : {}),
    ...(f.delivered === "yes" ? { deliveredAt: { not: null } } : {}),
    ...(f.delivered === "no" ? { deliveredAt: null, status: f.status ?? { in: ["PAID"] } } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
  };
  if (f.q) {
    const q = f.q.trim().replace(/^#/, "");
    where.OR = [
      ...(/^\d{1,9}$/.test(q) ? [{ number: Number(q) }] : []),
      ...(/^\d{5,20}$/.test(q) ? [{ user: { telegramId: BigInt(q) } }] : []),
      { user: { username: { contains: q.replace(/^@/, ""), mode: "insensitive" } } },
      { payment: { providerPaymentId: q } },
      { id: q },
    ];
  }
  const [total, items] = await Promise.all([
    db().order.count({ where }),
    db().order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        user: { select: { id: true, telegramId: true, username: true, firstName: true } },
        payment: { select: { provider: true, status: true, providerPaymentId: true } },
        inventoryItems: { select: { id: true, valuePreview: true, status: true }, orderBy: { createdAt: "asc" } },
      },
    }),
  ]);
  return { total, page: f.page, pageSize: f.pageSize, items };
}

export async function getOrderDetail(id: string) {
  const order = await db().order.findUnique({
    where: { id },
    include: {
      user: true,
      product: { select: { id: true, name: true } },
      payment: { include: { events: { orderBy: { createdAt: "asc" }, select: { id: true, eventId: true, eventType: true, signatureValid: true, processedAt: true, error: true, createdAt: true } } } },
      inventoryItems: { select: { id: true, valuePreview: true, status: true, soldAt: true }, orderBy: { createdAt: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
      ledger: true,
    },
  });
  if (!order) throw Errors.notFound("Order");
  const { metadata, ...payment } = order.payment ?? ({} as NonNullable<typeof order.payment>);
  void metadata; // may contain a large QR image; not needed in the dashboard
  return { ...order, payment: order.payment ? payment : null };
}

// ───────────────────────── Admin actions ─────────────────────────

export async function refundOrder(orderId: string, adminId: string, ip: string | null) {
  const order = await db().order.findUnique({ where: { id: orderId }, include: { payment: true } });
  if (!order?.payment?.providerPaymentId) throw Errors.notFound("Order payment");
  if (!["PAID", "DELIVERED"].includes(order.status)) throw Errors.conflict("Only paid orders can be refunded");
  const provider = getProvider(order.payment.provider);
  const refund = await provider.refundPayment(order.payment.providerPaymentId, {
    orderId: order.id,
    amountCents: order.amountCents,
    providerReference: order.payment.providerReference,
  });
  await orderEvent({ orderId, type: "REFUND_REQUESTED", actorType: "ADMIN", adminId, details: { refundId: refund.refundId, status: refund.status } });
  await audit({ actorType: "ADMIN", adminId, ip, action: AuditActions.ORDER_REFUNDED, resourceType: "order", resourceId: orderId, details: { refundId: refund.refundId, providerStatus: refund.status } });
  if (refund.status === "REFUNDED") {
    await applyPaymentStatus(order.payment.id, { providerPaymentId: order.payment.providerPaymentId, status: "REFUNDED" }, { actorType: "ADMIN", adminId });
  }
  return refund;
}

export async function resendDelivery(orderId: string, adminId: string) {
  const outcome = await deliverOrder(orderId, { resend: true, adminId });
  if (outcome === "skipped") throw Errors.conflict("Pedido sem item vinculado ou entrega em andamento");
  return outcome;
}

/**
 * Assigns the missing stock to a paid order (e.g. after restocking) and delivers it. All-or-nothing.
 * Without enough local stock, the missing units are bought from the supplier when the product is linked.
 */
export async function fulfillOutOfStockOrder(orderId: string, adminId: string, ip: string | null) {
  let source: "stock" | "supplier" = "stock";
  let items: number;
  try {
    items = await assignLocalStock(orderId, adminId);
  } catch (err) {
    if (!(err instanceof AppError && err.code === "OUT_OF_STOCK")) throw err;
    const supplier = await fulfillFromSupplier(orderId);
    if (supplier.kind === "not_applicable") throw err;
    if (supplier.kind === "failed") throw Errors.conflict(`Sem estoque local e a compra no fornecedor falhou: ${supplier.code} — ${supplier.message}`, "OUT_OF_STOCK");
    source = "supplier";
    items = supplier.units;
  }
  await audit({ actorType: "ADMIN", adminId, ip, action: AuditActions.ORDER_UPDATED, resourceType: "order", resourceId: orderId, details: { action: "fulfill", items, source } });
  // The supplier path already delivered the order.
  return source === "supplier" ? "delivered" : deliverOrder(orderId);
}

async function assignLocalStock(orderId: string, adminId: string): Promise<number> {
  return db().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status !== "PAID") throw Errors.conflict("Pedido não está pago aguardando entrega");
    const n = await sellForOrder(tx, { productId: order.productId, orderId, userId: order.userId, quantity: order.quantity });
    if (n < order.quantity) throw Errors.outOfStock();
    await orderEvent({ orderId, type: "ITEM_ASSIGNED", actorType: "ADMIN", adminId, details: { quantity: order.quantity } }, tx);
    return n;
  });
}
