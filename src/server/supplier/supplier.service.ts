import { randomUUID } from "node:crypto";
import type { ActorType } from "@/generated/prisma/enums";
import { db } from "@/server/common/db";
import { AppError, Errors } from "@/server/common/errors";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { encrypt, keyedHash } from "@/server/common/crypto";
import { logger } from "@/server/common/logger";
import { rateLimit } from "@/server/common/rate-limit";
import { escapeHtml } from "@/i18n";
import { formatMoney } from "@/server/common/money";
import { maskValue } from "@/server/inventory/inventory.parser";
import { orderEvent } from "@/server/orders/order-events";
import { deliverOrder } from "@/server/notifications/delivery.service";
import { alertAdmins } from "@/server/notifications/telegram";
import { deliveredValues, partnerApi, partnerConfigured, PartnerApiError, usdToCents } from "@/server/supplier/partner-api.client";
import { supplierCatalog, supplierMaxCost } from "@/server/supplier/supplier-stock";

export type SupplierOutcome =
  | { kind: "not_applicable" }
  | { kind: "fulfilled"; units: number }
  | { kind: "failed"; code: string; message: string };

const ALERTS: Record<string, string> = {
  INSUFFICIENT_BALANCE: "saldo insuficiente na carteira do fornecedor — recarregue pelo bot do fornecedor",
  OUT_OF_STOCK: "o fornecedor também está sem estoque",
  COST_ABOVE_LIMIT: "o preço do fornecedor passou do custo máximo do produto",
  PRODUCT_NOT_FOUND: "produto não encontrado no fornecedor (verifique o slug)",
};

/**
 * Buys the units a PAID order is still missing (local stock ran out) from the Partner API, binds the
 * delivered items to the order and delivers it. Safe to call repeatedly: the supplier order id is
 * derived from our order, so a retry after a timeout returns the same supplier order without a
 * second charge, and the items are stored with the same duplicate-proof hash as manual uploads.
 */
export async function fulfillFromSupplier(orderId: string): Promise<SupplierOutcome> {
  const order = await db().order.findUnique({
    where: { id: orderId },
    include: { product: true, _count: { select: { inventoryItems: { where: { status: "SOLD" } } } } },
  });
  const slug = order?.product.supplierSlug;
  if (!order || order.status !== "PAID" || !slug || !partnerConfigured()) return { kind: "not_applicable" };
  const sold = order._count.inventoryItems;
  const missing = order.quantity - sold;
  if (missing <= 0) return { kind: "not_applicable" };

  const fail = async (code: string, message: string, requestId?: string): Promise<SupplierOutcome> => {
    logger.warn("supplier.order_failed", { orderId, code, requestId });
    await orderEvent({ orderId, type: "SUPPLIER_FAILED", actorType: "SYSTEM", message: message.slice(0, 300), details: { code, slug, quantity: missing, requestId: requestId ?? null } });
    return { kind: "failed", code, message };
  };

  let partnerOrder;
  try {
    // Price check on a fresh catalog: never pay the supplier more than the product's cost limit.
    const item = (await supplierCatalog({ fresh: true })).get(slug);
    if (!item) return fail("PRODUCT_NOT_FOUND", `Supplier product "${slug}" not found`);
    const unitCents = usdToCents(item.yourPrice);
    if (unitCents > supplierMaxCost(order.product)) return fail("COST_ABOVE_LIMIT", `Supplier price ${item.yourPrice} USD is above the limit`);
    partnerOrder = await partnerApi.createOrder({ productSlug: slug, quantity: missing, externalOrderId: `${order.id}-${sold}` });
  } catch (err) {
    if (err instanceof PartnerApiError) return fail(err.code, err.message, err.requestId);
    throw err;
  }

  const values = deliveredValues(partnerOrder);
  const batchId = `supplier:${partnerOrder.orderCode}`;
  const bound = await db().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
    const current = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
    const have = await tx.inventoryItem.count({ where: { orderId, status: "SOLD" } });
    // Refunded/cancelled meanwhile (or filled by a concurrent run): the bought items simply become stock.
    const need = current.status === "PAID" ? Math.max(0, order.quantity - have) : 0;
    const now = new Date();
    const res = await tx.inventoryItem.createMany({
      data: values.map((v, i) => ({
        productId: order.productId,
        valueEncrypted: encrypt(v),
        valueHash: keyedHash(v),
        valuePreview: maskValue(v),
        batchId,
        ...(i < need ? { status: "SOLD" as const, orderId, userId: order.userId, soldAt: now } : {}),
      })),
      skipDuplicates: true,
    });
    const created = await tx.inventoryItem.findMany({ where: { batchId, events: { none: {} } }, select: { id: true, status: true } });
    await tx.inventoryItemEvent.createMany({
      data: created.flatMap((c) => [
        { itemId: c.id, type: "ADDED", actorType: "SYSTEM" as ActorType, details: { batchId, source: "supplier" } },
        ...(c.status === "SOLD" ? [{ itemId: c.id, type: "SOLD", orderId, actorType: "SYSTEM" as ActorType }] : []),
      ]),
    });
    await orderEvent(
      {
        orderId,
        type: "SUPPLIER_PURCHASED",
        actorType: "SYSTEM",
        details: {
          supplierOrderCode: partnerOrder.orderCode,
          quantity: partnerOrder.quantity,
          delivered: values.length,
          stored: res.count,
          unitCostCents: usdToCents(partnerOrder.unitPrice),
          totalCostCents: usdToCents(partnerOrder.totalCharged),
        },
      },
      tx,
    );
    return created.filter((c) => c.status === "SOLD").length;
  });
  logger.info("supplier.order_imported", { orderId, supplierOrderCode: partnerOrder.orderCode, delivered: values.length, bound });

  if (bound < missing) return fail("INCOMPLETE_DELIVERY", `Supplier delivered ${values.length}/${missing} usable items`);
  await deliverOrder(orderId);
  return { kind: "fulfilled", units: bound };
}

/**
 * Buys `quantity` units of the product's linked supplier item and adds them to the store's own stock
 * (AVAILABLE, sold before the supplier is used again). Charged from the supplier wallet.
 */
export async function purchaseToStock(productId: string, quantity: number, actor: { adminId?: string; ip?: string | null } = {}) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) throw Errors.badRequest("Quantidade inválida (1 a 50)", "INVALID_QUANTITY");
  const product = await db().product.findFirst({ where: { id: productId, deletedAt: null } });
  if (!product) throw Errors.notFound("Product");
  if (!product.supplierSlug) throw Errors.badRequest("Produto sem fornecedor vinculado", "NO_SUPPLIER");
  if (!partnerConfigured()) throw Errors.badRequest("PARTNER_API_KEY não configurada", "NO_SUPPLIER");

  let partnerOrder;
  try {
    const item = (await supplierCatalog({ fresh: true })).get(product.supplierSlug);
    if (!item) throw new AppError("SUPPLIER_ERROR", `Produto "${product.supplierSlug}" não encontrado no fornecedor`, 502);
    if (usdToCents(item.yourPrice) > supplierMaxCost(product)) throw new AppError("COST_ABOVE_LIMIT", `Custo do fornecedor (${item.yourPrice} USD) acima do limite do produto`, 409);
    partnerOrder = await partnerApi.createOrder({ productSlug: product.supplierSlug, quantity, externalOrderId: `stock-${randomUUID()}` });
  } catch (err) {
    if (err instanceof PartnerApiError) throw new AppError("SUPPLIER_ERROR", `Fornecedor: ${err.code} — ${err.message}`, 502);
    throw err;
  }

  const values = deliveredValues(partnerOrder);
  const batchId = `supplier:${partnerOrder.orderCode}`;
  const added = await db().$transaction(async (tx) => {
    const res = await tx.inventoryItem.createMany({
      data: values.map((v) => ({ productId, valueEncrypted: encrypt(v), valueHash: keyedHash(v), valuePreview: maskValue(v), batchId })),
      skipDuplicates: true,
    });
    const created = await tx.inventoryItem.findMany({ where: { batchId }, select: { id: true } });
    await tx.inventoryItemEvent.createMany({
      data: created.map((c) => ({ itemId: c.id, type: "ADDED", actorType: (actor.adminId ? "ADMIN" : "SYSTEM") as ActorType, adminId: actor.adminId, details: { batchId, source: "supplier" } })),
    });
    return res.count;
  });
  const result = {
    supplierOrderCode: partnerOrder.orderCode,
    delivered: values.length,
    added,
    duplicates: values.length - added,
    unitCostCents: usdToCents(partnerOrder.unitPrice),
    totalCostCents: usdToCents(partnerOrder.totalCharged),
    balanceAfterCents: partnerOrder.balanceAfter != null ? usdToCents(partnerOrder.balanceAfter) : null,
  };
  await audit({ actorType: actor.adminId ? "ADMIN" : "SYSTEM", adminId: actor.adminId, ip: actor.ip ?? null, action: AuditActions.INVENTORY_ADDED, resourceType: "product", resourceId: productId, details: { ...result, batchId } });
  logger.info("supplier.purchased_to_stock", { productId, ...result });
  return result;
}

type AlertOrder = {
  number: number;
  productName: string;
  quantity: number;
  amountCents: number;
  currency: string;
  user: { telegramId: bigint; username: string | null; firstName: string | null };
};

/** "Name (@user) · ID 123", linking to the customer's Telegram profile. */
function customerLabel(user: AlertOrder["user"]): string {
  const name = escapeHtml(user.firstName || "Cliente");
  const handle = user.username ? ` (@${escapeHtml(user.username)})` : "";
  return `<a href="tg://user?id=${user.telegramId}">${name}</a>${handle} · ID <code>${user.telegramId}</code>`;
}

/** Admin alert for a paid order the supplier could not fill: who bought what, and why it wasn't delivered. */
export async function alertSupplierFailure(order: AlertOrder, outcome: Extract<SupplierOutcome, { kind: "failed" }>): Promise<void> {
  const title = outcome.code === "INSUFFICIENT_BALANCE" ? "💸 <b>Venda sem entrega: falta de saldo no fornecedor</b>" : "🏭 <b>Venda sem entrega: a compra no fornecedor falhou</b>";
  const reason = ALERTS[outcome.code] ?? `${outcome.code}: ${outcome.message}`;
  await alertAdmins(
    [
      title,
      "",
      `👤 Cliente: ${customerLabel(order.user)}`,
      `📦 Produto: <b>${escapeHtml(order.productName)}</b> × ${order.quantity}`,
      `🧾 Pedido <b>#${order.number}</b> · pago ${formatMoney(order.amountCents, order.currency)}`,
      "",
      `O cliente pagou mas <b>não recebeu</b> o produto — ${escapeHtml(reason)}.`,
      "Assim que resolver, a entrega é automática (nova tentativa a cada 10 min por 24 h). Ou reembolse pelo painel.",
    ].join("\n"),
  );
}

/**
 * Maintenance: retries the supplier for paid orders still missing items (supplier restocked, wallet
 * topped up, timeout...). Each order is retried at most every 10 minutes, for 24 hours after payment.
 */
export async function retrySupplierOrders(limit = 10): Promise<number> {
  if (!partnerConfigured()) return 0;
  const orders = await db().order.findMany({
    where: { status: "PAID", paidAt: { gt: new Date(Date.now() - 24 * 3600 * 1000) }, product: { supplierSlug: { not: null } } },
    orderBy: { paidAt: "asc" },
    take: 50,
    select: { id: true, number: true, productName: true, quantity: true, _count: { select: { inventoryItems: { where: { status: "SOLD" } } } } },
  });
  let fulfilled = 0;
  for (const o of orders) {
    if (fulfilled >= limit) break;
    if (o._count.inventoryItems >= o.quantity) continue;
    if (!(await rateLimit(`supplier:retry:${o.id}`, 1, 600))) continue;
    try {
      if ((await fulfillFromSupplier(o.id)).kind === "fulfilled") {
        fulfilled++;
        await alertAdmins(`✅ Pedido <b>#${o.number}</b> (${escapeHtml(o.productName)}) comprado no fornecedor e entregue ao cliente.`);
      }
    } catch (err) {
      logger.error("supplier.retry_failed", { err, orderId: o.id });
    }
  }
  return fulfilled;
}
