import { InlineKeyboard } from "grammy";
import { GrammyError } from "grammy";
import { db } from "@/server/common/db";
import { logger } from "@/server/common/logger";
import { DEFAULT_LOCALE, t } from "@/i18n";
import { sendHtml } from "@/server/notifications/telegram";
import { availableStock, localizedName } from "@/server/products/products.service";

/** Telegram allows ~30 messages/second per bot; stay well below it. */
const SEND_GAP_MS = 50;

/** Toggles the customer's "notify me when back in stock" request. Returns true when now subscribed. */
export async function toggleStockAlert(userId: string, productId: string): Promise<boolean> {
  const removed = await db().stockAlert.deleteMany({ where: { userId, productId } });
  if (removed.count > 0) return false;
  const product = await db().product.findFirst({ where: { id: productId, isActive: true, deletedAt: null }, select: { id: true } });
  if (!product) return false;
  await db().stockAlert.upsert({ where: { userId_productId: { userId, productId } }, create: { userId, productId }, update: {} });
  return true;
}

export async function hasStockAlert(userId: string, productId: string): Promise<boolean> {
  return (await db().stockAlert.count({ where: { userId, productId } })) > 0;
}

/**
 * Notifies customers waiting for products that are back in stock (oldest requests first). Each
 * request is claimed by deleting it before sending, so concurrent runs (inventory upload + cron)
 * never message a customer twice; transient send failures put the request back.
 */
export async function notifyRestocks(opts: { productId?: string; limit?: number } = {}): Promise<number> {
  const productIds = opts.productId
    ? [opts.productId]
    : (await db().stockAlert.findMany({ distinct: ["productId"], select: { productId: true } })).map((a) => a.productId);

  let sent = 0;
  let budget = opts.limit ?? 200;
  for (const productId of productIds) {
    if (budget <= 0) break;
    const product = await db().product.findFirst({ where: { id: productId, isActive: true, deletedAt: null } });
    if (!product || (await availableStock(productId)) <= 0) continue;

    const alerts = await db().stockAlert.findMany({
      where: { productId },
      include: { user: { select: { telegramId: true, locale: true, isBlocked: true } } },
      orderBy: { createdAt: "asc" },
      take: budget,
    });
    for (const alert of alerts) {
      budget--;
      const claimed = await db().stockAlert.deleteMany({ where: { id: alert.id } });
      if (claimed.count === 0 || alert.user.isBlocked) continue;
      const locale = alert.user.locale ?? DEFAULT_LOCALE;
      const kb = new InlineKeyboard().text(t(locale, "restock_view_product"), `p:${productId}`);
      try {
        await sendHtml(alert.user.telegramId, t(locale, "restock_notice", { name: localizedName(product, locale) }), kb);
        sent++;
      } catch (err) {
        // 400/403: chat gone or bot blocked - drop the request. Anything else: retry on the next run.
        const permanent = err instanceof GrammyError && (err.error_code === 403 || err.error_code === 400);
        if (!permanent) {
          await db().stockAlert.create({ data: { userId: alert.userId, productId, createdAt: alert.createdAt } }).catch(() => undefined);
        }
        logger.warn("stock_alert.send_failed", { err, productId, permanent });
      }
      await new Promise((r) => setTimeout(r, SEND_GAP_MS));
    }
  }
  if (sent) logger.info("stock_alert.notified", { sent, productId: opts.productId ?? null });
  return sent;
}
