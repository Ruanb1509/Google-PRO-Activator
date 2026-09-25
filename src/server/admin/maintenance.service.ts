import { db } from "@/server/common/db";
import { logger } from "@/server/common/logger";
import { rateLimit, cleanupRateLimits } from "@/server/common/rate-limit";
import { cleanupSessions } from "@/server/auth/session.service";
import { releaseExpiredReservations } from "@/server/inventory/inventory.service";
import { retryPendingDeliveries } from "@/server/notifications/delivery.service";
import { applyPaymentStatus } from "@/server/orders/payment-lifecycle.service";
import { findProvider } from "@/server/payments/registry";
import { expireDeposits } from "@/server/wallet/deposit.service";
import { notifyRestocks } from "@/server/inventory/stock-alerts.service";

/**
 * Periodic housekeeping (Vercel Cron + opportunistic, throttled runs):
 *  - reconcile/expire pending orders (asks the provider before expiring => lost webhooks are recovered)
 *  - release timed-out stock reservations
 *  - retry failed deliveries
 *  - notify customers waiting for products that are back in stock
 *  - expire deposits, purge old sessions/rate-limit rows
 */
export async function runMaintenance() {
  const started = Date.now();
  const report: Record<string, number> = { reconciled: 0, expired: 0 };

  const due = await db().order.findMany({
    where: { status: "PENDING", expiresAt: { lt: new Date() } },
    include: { payment: true },
    orderBy: { expiresAt: "asc" },
    take: 50,
  });
  for (const order of due) {
    try {
      const payment = order.payment;
      const provider = payment ? findProvider(payment.provider) : undefined;
      if (payment?.providerPaymentId && provider) {
        const status = await provider.getPaymentStatus(payment.providerPaymentId);
        if (status.status !== "PENDING") {
          await applyPaymentStatus(payment.id, status, { actorType: "SYSTEM" });
          report.reconciled!++;
          continue;
        }
        await provider.cancelPayment?.(payment.providerPaymentId).catch(() => undefined);
        // Re-check after cancelling: a payment may have landed in between.
        const after = await provider.getPaymentStatus(payment.providerPaymentId);
        if (after.status === "PAID") {
          await applyPaymentStatus(payment.id, after, { actorType: "SYSTEM" });
          report.reconciled!++;
          continue;
        }
        await applyPaymentStatus(payment.id, { providerPaymentId: payment.providerPaymentId, status: "EXPIRED" }, { actorType: "SYSTEM" });
      } else if (payment) {
        await applyPaymentStatus(payment.id, { providerPaymentId: payment.providerPaymentId ?? "", status: "EXPIRED" }, { actorType: "SYSTEM" });
      }
      report.expired!++;
    } catch (err) {
      logger.error("maintenance.order_failed", { err, orderId: order.id });
    }
  }

  // Also reconcile recent pending orders whose webhook may have been lost (checked every run, capped).
  const recent = await db().payment.findMany({
    where: { status: "PENDING", providerPaymentId: { not: null }, order: { status: "PENDING", expiresAt: { gt: new Date() } }, createdAt: { lt: new Date(Date.now() - 3 * 60 * 1000) } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  for (const payment of recent) {
    try {
      const provider = findProvider(payment.provider);
      if (!provider || !payment.providerPaymentId) continue;
      const status = await provider.getPaymentStatus(payment.providerPaymentId);
      if (status.status !== "PENDING") {
        await applyPaymentStatus(payment.id, status, { actorType: "SYSTEM" });
        report.reconciled!++;
      }
    } catch (err) {
      logger.warn("maintenance.reconcile_failed", { err, paymentId: payment.id });
    }
  }

  report.releasedReservations = await releaseExpiredReservations();
  report.deliveriesRetried = await retryPendingDeliveries();
  report.restockNotified = await notifyRestocks({ limit: 100 }).catch((err) => (logger.error("stock_alert.run_failed", { err }), 0));
  report.depositsExpired = await expireDeposits();
  report.sessionsPurged = await cleanupSessions();
  report.rateLimitRowsPurged = await cleanupRateLimits();
  report.durationMs = Date.now() - started;
  logger.info("maintenance.done", report);
  return report;
}

/** Runs maintenance at most once per `intervalSec` across all instances (used via `after()`). */
export async function maybeRunMaintenance(intervalSec = 120): Promise<void> {
  try {
    if (await rateLimit("maintenance:opportunistic", 1, intervalSec)) await runMaintenance();
  } catch (err) {
    logger.error("maintenance.failed", { err });
  }
}
