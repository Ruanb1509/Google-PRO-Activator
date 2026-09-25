import type { Prisma } from "@/generated/prisma/client";
import type { ActorType } from "@/generated/prisma/enums";
import { db, type Tx } from "@/server/common/db";
import { logger } from "@/server/common/logger";

export interface AuditEntry {
  actorType: ActorType;
  adminId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  ip?: string | null;
  details?: Prisma.InputJsonValue;
}

/** Writes an audit record. Never throws (auditing must not break the business flow). */
export async function audit(entry: AuditEntry, tx?: Tx): Promise<void> {
  try {
    await (tx ?? db()).auditLog.create({
      data: {
        actorType: entry.actorType,
        adminId: entry.adminId ?? null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        ip: entry.ip ?? null,
        details: entry.details,
      },
    });
  } catch (err) {
    if (tx) throw err; // inside a transaction let the caller roll back
    logger.error("audit.write_failed", { err, action: entry.action });
  }
}

export const AuditActions = {
  LOGIN: "auth.login",
  LOGIN_FAILED: "auth.login_failed",
  LOGOUT: "auth.logout",
  TWO_FACTOR_ENABLED: "auth.2fa_enabled",
  TWO_FACTOR_DISABLED: "auth.2fa_disabled",
  PASSWORD_CHANGED: "auth.password_changed",
  PRODUCT_CREATED: "product.created",
  PRODUCT_UPDATED: "product.updated",
  PRODUCT_PRICE_CHANGED: "product.price_changed",
  PRODUCT_DELETED: "product.deleted",
  INVENTORY_ADDED: "inventory.added",
  INVENTORY_UPDATED: "inventory.updated",
  INVENTORY_REMOVED: "inventory.removed",
  INVENTORY_REVEALED: "inventory.revealed",
  SALE: "order.sale",
  ORDER_UPDATED: "order.updated",
  ORDER_REFUNDED: "order.refunded",
  DELIVERY_FAILED: "order.delivery_failed",
  DELIVERY_RESENT: "order.delivery_resent",
  WEBHOOK_RECEIVED: "webhook.received",
  WEBHOOK_REJECTED: "webhook.rejected",
  PAYMENT_FAILED: "payment.failed",
  DEPOSIT_CONFIRMED: "deposit.confirmed",
  DEPOSIT_REJECTED: "deposit.rejected",
  BALANCE_ADJUSTED: "balance.adjusted",
  SETTINGS_UPDATED: "settings.updated",
  ADMIN_CREATED: "admin.created",
  ADMIN_UPDATED: "admin.updated",
  CUSTOMER_UPDATED: "customer.updated",
} as const;
