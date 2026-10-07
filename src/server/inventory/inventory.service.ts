import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { ActorType, InventoryStatus } from "@/generated/prisma/enums";
import { db, type Tx } from "@/server/common/db";
import { decrypt, encrypt, keyedHash } from "@/server/common/crypto";
import { Errors } from "@/server/common/errors";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { MAX_ITEMS_PER_BATCH, maskValue, parseInventoryText } from "@/server/inventory/inventory.parser";

// ───────────────────────── Admin operations ─────────────────────────

export interface AddItemsResult {
  added: number;
  duplicates: number;
  invalid: number;
  /** Non-link lines skipped from a supplier export. */
  ignored: number;
  duplicateValues: string[];
  invalidLines: { line: number; value: string; reason: string }[];
  batchId: string;
}

/**
 * Bulk insert. Duplicates are detected BEFORE inserting (inside the submitted text and against every
 * item ever stored, for any product) using a keyed hash, so values stay encrypted at rest.
 */
export async function addItems(input: { productId: string; text: string; csv?: boolean }, adminId: string, ip: string | null): Promise<AddItemsResult> {
  const product = await db().product.findFirst({ where: { id: input.productId, deletedAt: null } });
  if (!product) throw Errors.notFound("Product");

  const parsed = parseInventoryText(input.text, { csv: input.csv });
  if (parsed.valid.length > MAX_ITEMS_PER_BATCH) throw Errors.badRequest(`Máximo de ${MAX_ITEMS_PER_BATCH} itens por envio`);

  const hashed = parsed.valid.map((value) => ({ value, hash: keyedHash(value) }));
  const existing = new Set<string>();
  for (let i = 0; i < hashed.length; i += 1000) {
    const chunk = hashed.slice(i, i + 1000).map((h) => h.hash);
    const rows = await db().inventoryItem.findMany({ where: { valueHash: { in: chunk } }, select: { valueHash: true } });
    rows.forEach((r) => existing.add(r.valueHash));
  }
  const fresh = hashed.filter((h) => !existing.has(h.hash));
  const duplicateValues = [...parsed.duplicatesInInput, ...hashed.filter((h) => existing.has(h.hash)).map((h) => h.value)];

  const batchId = randomUUID();
  let added = 0;
  for (let i = 0; i < fresh.length; i += 500) {
    const chunk = fresh.slice(i, i + 500);
    // skipDuplicates protects against a concurrent upload of the same values (unique value_hash).
    const res = await db().inventoryItem.createMany({
      data: chunk.map((h) => ({
        productId: product.id,
        valueEncrypted: encrypt(h.value),
        valueHash: h.hash,
        valuePreview: maskValue(h.value),
        batchId,
      })),
      skipDuplicates: true,
    });
    added += res.count;
  }

  const created = await db().inventoryItem.findMany({ where: { batchId }, select: { id: true } });
  if (created.length) {
    await db().inventoryItemEvent.createMany({
      data: created.map((c) => ({ itemId: c.id, type: "ADDED", actorType: "ADMIN" as ActorType, adminId, details: { batchId } })),
    });
  }

  const result: AddItemsResult = {
    added,
    duplicates: duplicateValues.length + (fresh.length - added),
    invalid: parsed.invalid.length,
    ignored: parsed.ignored,
    duplicateValues: duplicateValues.slice(0, 100).map(maskValue),
    invalidLines: parsed.invalid.slice(0, 100),
    batchId,
  };
  await audit({
    actorType: "ADMIN",
    adminId,
    ip,
    action: AuditActions.INVENTORY_ADDED,
    resourceType: "product",
    resourceId: product.id,
    details: { added: result.added, duplicates: result.duplicates, invalid: result.invalid, batchId },
  });
  return result;
}

export interface InventoryFilters {
  productId?: string;
  status?: InventoryStatus;
  from?: Date;
  to?: Date;
  q?: string;
  page: number;
  pageSize: number;
}

export async function listItems(f: InventoryFilters) {
  const where: Prisma.InventoryItemWhereInput = {
    ...(f.productId ? { productId: f.productId } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
    // Exact-value search works through the keyed hash (values are encrypted).
    ...(f.q ? { valueHash: keyedHash(f.q.trim()) } : {}),
  };
  const [total, items] = await Promise.all([
    db().inventoryItem.count({ where }),
    db().inventoryItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      select: {
        id: true,
        productId: true,
        valuePreview: true,
        status: true,
        reservedUntil: true,
        createdAt: true,
        soldAt: true,
        orderId: true,
        product: { select: { name: true } },
        order: { select: { number: true } },
        user: { select: { id: true, telegramId: true, username: true } },
      },
    }),
  ]);
  return { total, page: f.page, pageSize: f.pageSize, items };
}

export async function getItem(id: string) {
  const item = await db().inventoryItem.findUnique({
    where: { id },
    select: {
      id: true,
      productId: true,
      valuePreview: true,
      status: true,
      reservedUntil: true,
      batchId: true,
      createdAt: true,
      reservedAt: true,
      soldAt: true,
      updatedAt: true,
      product: { select: { id: true, name: true } },
      order: { select: { id: true, number: true, status: true } },
      user: { select: { id: true, telegramId: true, username: true, firstName: true } },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!item) throw Errors.notFound("Inventory item");
  return item;
}

/** Reveals the clear value to an admin. Always audited. */
export async function revealItem(id: string, adminId: string, ip: string | null): Promise<string> {
  const item = await db().inventoryItem.findUnique({ where: { id } });
  if (!item) throw Errors.notFound("Inventory item");
  await audit({ actorType: "ADMIN", adminId, ip, action: AuditActions.INVENTORY_REVEALED, resourceType: "inventory_item", resourceId: id });
  return decrypt(item.valueEncrypted);
}

/** Admin status changes allowed: AVAILABLE <-> INVALID, AVAILABLE/INVALID -> CANCELLED. Sold/reserved items are immutable. */
export async function setItemStatus(id: string, status: "AVAILABLE" | "INVALID" | "CANCELLED", adminId: string, ip: string | null) {
  const res = await db().inventoryItem.updateMany({
    where: { id, status: { in: ["AVAILABLE", "INVALID", "CANCELLED"] } },
    data: { status },
  });
  if (res.count === 0) throw Errors.conflict("Itens vendidos ou reservados não podem ser alterados");
  await db().inventoryItemEvent.create({ data: { itemId: id, type: `STATUS_${status}`, actorType: "ADMIN", adminId } });
  await audit({ actorType: "ADMIN", adminId, ip, action: AuditActions.INVENTORY_UPDATED, resourceType: "inventory_item", resourceId: id, details: { status } });
}

/** Physically removes items that were never sold/reserved. */
export async function removeItems(ids: string[], adminId: string, ip: string | null): Promise<number> {
  const res = await db().inventoryItem.deleteMany({ where: { id: { in: ids }, status: { in: ["AVAILABLE", "INVALID", "CANCELLED"] }, orderId: null } });
  await audit({ actorType: "ADMIN", adminId, ip, action: AuditActions.INVENTORY_REMOVED, resourceType: "inventory_item", details: { requested: ids.length, removed: res.count, ids: ids.slice(0, 200) } });
  return res.count;
}

// ───────────────────────── Order lifecycle (must run inside a transaction) ─────────────────────────

/**
 * Picks the next free items of a product and locks them. `SKIP LOCKED` makes concurrent buyers take
 * different rows instead of waiting on (and then double-taking) the same ones. Items whose
 * reservation expired are reclaimable.
 */
async function lockFreeItems(tx: Tx, productId: string, limit: number): Promise<{ id: string; order_id: string | null }[]> {
  if (limit <= 0) return [];
  return tx.$queryRaw<{ id: string; order_id: string | null }[]>`
    SELECT id, order_id FROM inventory_items
    WHERE product_id = ${productId}
      AND (status = 'AVAILABLE' OR (status = 'RESERVED' AND reserved_until < now()))
    ORDER BY created_at, id
    LIMIT ${limit}
    FOR UPDATE SKIP LOCKED`;
}

/** Temporarily reserves `quantity` items for a new order. Throws OUT_OF_STOCK (and the caller's tx rolls back) if there are not enough. */
export async function reserveForOrder(tx: Tx, args: { productId: string; orderId: string; userId: string; quantity: number; until: Date }): Promise<string[]> {
  const items = await lockFreeItems(tx, args.productId, args.quantity);
  if (items.length < args.quantity) throw Errors.outOfStock();
  const expired = items.filter((i) => i.order_id && i.order_id !== args.orderId);
  if (expired.length) {
    await tx.inventoryItemEvent.createMany({ data: expired.map((i) => ({ itemId: i.id, type: "RESERVATION_EXPIRED", orderId: i.order_id, actorType: "SYSTEM" as ActorType })) });
  }
  const ids = items.map((i) => i.id);
  await tx.inventoryItem.updateMany({
    where: { id: { in: ids } },
    data: { status: "RESERVED", orderId: args.orderId, userId: args.userId, reservedUntil: args.until, reservedAt: new Date() },
  });
  await tx.inventoryItemEvent.createMany({ data: ids.map((itemId) => ({ itemId, type: "RESERVED", orderId: args.orderId, actorType: "SYSTEM" as ActorType })) });
  return ids;
}

/**
 * Marks the order's items as SOLD (AVAILABLE/RESERVED -> SOLD) inside the payment transaction, up to
 * `quantity`. Idempotent: already-sold items are kept. If (part of) the reservation was lost, new free
 * items are allocated. Returns how many items the order now has SOLD; less than `quantity` means the
 * product ran out of stock (the items obtained stay bound to the order until an admin completes it).
 */
export async function sellForOrder(tx: Tx, args: { productId: string; orderId: string; userId: string; quantity: number }): Promise<number> {
  const own = await tx.$queryRaw<{ id: string; status: InventoryStatus }[]>`
    SELECT id, status FROM inventory_items WHERE order_id = ${args.orderId} FOR UPDATE`;
  const sold = own.filter((i) => i.status === "SOLD").length;
  const toSell = own.filter((i) => i.status === "RESERVED").map((i) => i.id).slice(0, Math.max(0, args.quantity - sold));
  const missing = args.quantity - sold - toSell.length;
  if (missing > 0) toSell.push(...(await lockFreeItems(tx, args.productId, missing)).map((i) => i.id));
  if (toSell.length) {
    await tx.inventoryItem.updateMany({
      where: { id: { in: toSell } },
      data: { status: "SOLD", orderId: args.orderId, userId: args.userId, soldAt: new Date(), reservedUntil: null },
    });
    await tx.inventoryItemEvent.createMany({ data: toSell.map((itemId) => ({ itemId, type: "SOLD", orderId: args.orderId, actorType: "SYSTEM" as ActorType })) });
  }
  return sold + toSell.length;
}

/** Returns a reserved (not sold) item to the queue. */
export async function releaseReservation(tx: Tx, orderId: string, reason: string): Promise<void> {
  const items = await tx.inventoryItem.findMany({ where: { orderId, status: "RESERVED" }, select: { id: true } });
  if (!items.length) return;
  await tx.inventoryItem.updateMany({
    where: { orderId, status: "RESERVED" },
    data: { status: "AVAILABLE", orderId: null, userId: null, reservedUntil: null, reservedAt: null },
  });
  await tx.inventoryItemEvent.createMany({ data: items.map((i) => ({ itemId: i.id, type: "RELEASED", orderId, actorType: "SYSTEM" as ActorType, details: { reason } })) });
}

/** On refund of an order that was never delivered, its items can safely go back to stock. Returns how many were returned. */
export async function returnUndeliveredItems(tx: Tx, orderId: string): Promise<number> {
  const items = await tx.inventoryItem.findMany({ where: { orderId, status: "SOLD" }, select: { id: true } });
  if (!items.length) return 0;
  await tx.inventoryItem.updateMany({
    where: { id: { in: items.map((i) => i.id) } },
    data: { status: "AVAILABLE", orderId: null, userId: null, soldAt: null, reservedUntil: null, reservedAt: null },
  });
  await tx.inventoryItemEvent.createMany({ data: items.map((i) => ({ itemId: i.id, type: "RETURNED_TO_STOCK", orderId, actorType: "SYSTEM" as ActorType, details: { reason: "refund_before_delivery" } })) });
  return items.length;
}

/** Releases reservations that timed out (their order was not paid in time). */
export async function releaseExpiredReservations(): Promise<number> {
  return db().$executeRaw`
    UPDATE inventory_items SET status = 'AVAILABLE', order_id = NULL, user_id = NULL, reserved_until = NULL, reserved_at = NULL, updated_at = now()
    WHERE status = 'RESERVED' AND reserved_until < now()
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = inventory_items.order_id AND o.status IN ('PAID', 'DELIVERED'))`;
}
