import { GrammyError, InlineKeyboard } from "grammy";
import type { Locale } from "@/generated/prisma/enums";
import { DEFAULT_LOCALE, escapeHtml, t } from "@/i18n";
import { bulkDiscountTiers, discountedUnitCents } from "@/lib/bulk-discounts";
import { db } from "@/server/common/db";
import { AppError, Errors } from "@/server/common/errors";
import { logger } from "@/server/common/logger";
import { formatMoney } from "@/server/common/money";
import { rateLimit } from "@/server/common/rate-limit";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { alertAdmins, sendHtml } from "@/server/notifications/telegram";
import { availablePaymentMethods } from "@/server/orders/orders.service";
import { localizedName } from "@/server/products/products.service";

/** Telegram allows ~30 messages/second per bot; stay well below it. */
const SEND_GAP_MS = 50;
/** Stop before the function's 300 s limit and report how far it got. */
const TIME_BUDGET_MS = 270_000;

type PromoProduct = { id: string; name: string; nameEn: string | null; priceBrlCents: number; priceUsdCents: number; bulkDiscounts: unknown };

async function activeProduct(productId: string) {
  const product = await db().product.findFirst({ where: { id: productId, isActive: true, deletedAt: null } });
  if (!product) throw Errors.notFound("Product");
  if (!bulkDiscountTiers(product.bulkDiscounts).length) throw new AppError("NO_DISCOUNTS", "Este produto não tem desconto por quantidade configurado", 409);
  return product;
}

/** Customers who can receive the message (the bot only knows users who started it). */
function recipientsWhere() {
  return { isBlocked: false };
}

/** The promotion text in the customer's language, with the price of each quantity tier. */
export async function promoMessage(product: PromoProduct, locale: Locale): Promise<string> {
  const tiers = bulkDiscountTiers(product.bulkDiscounts);
  const currencies = [...new Set((await availablePaymentMethods(locale)).map((m) => m.currency))].sort();
  const shown = currencies.length ? currencies : ["BRL"];
  const price = (quantity: number) =>
    shown.map((c) => formatMoney(discountedUnitCents(c === "BRL" ? product.priceBrlCents : product.priceUsdCents, tiers, quantity), c, locale)).join(" / ");
  const steps = [{ from: 1 }, ...tiers.map((tier) => ({ from: tier.minQty }))];
  const lines = steps.map((step, i) => {
    const next = steps[i + 1];
    const range = !next ? `${step.from}+` : next.from - 1 > step.from ? `${step.from}-${next.from - 1}` : String(step.from);
    return `• ${t(locale, "bulk_discount_line", { range, price: price(step.from) })}`;
  });
  return t(locale, "promo_bulk_discount", { name: localizedName(product, locale) }, { lines: lines.join("\n") });
}

export async function promoPreview(productId: string) {
  const product = await activeProduct(productId);
  const [recipients, pt, en] = await Promise.all([db().user.count({ where: recipientsWhere() }), promoMessage(product, "pt_BR"), promoMessage(product, "en_US")]);
  return { recipients, messages: { pt_BR: pt, en_US: en } };
}

/**
 * Sends the quantity-discount promotion of a product to every customer. Starts the sending and
 * returns right away; admins get a summary alert at the end. Once per product every 30 minutes, so a
 * double click never messages customers twice.
 */
export async function startPromoBroadcast(productId: string, actor: { adminId: string; ip: string | null }): Promise<{ recipients: number; run: () => Promise<void> }> {
  const product = await activeProduct(productId);
  if (!(await rateLimit(`promo:broadcast:${productId}`, 1, 30 * 60))) {
    throw new AppError("RATE_LIMITED", "O aviso deste produto já foi enviado há pouco. Aguarde 30 minutos para enviar de novo.", 429);
  }
  const recipients = await db().user.count({ where: recipientsWhere() });
  await audit({ actorType: "ADMIN", adminId: actor.adminId, ip: actor.ip, action: AuditActions.PROMO_BROADCAST, resourceType: "product", resourceId: productId, details: { recipients } });
  return { recipients, run: () => sendPromo(product) };
}

async function sendPromo(product: PromoProduct): Promise<void> {
  const started = Date.now();
  const messages = new Map<Locale, string>();
  const textFor = async (locale: Locale) => messages.get(locale) ?? messages.set(locale, await promoMessage(product, locale)).get(locale)!;
  let sent = 0;
  let failed = 0;
  let total = 0;
  let cursor: string | undefined;
  let timedOut = false;

  outer: for (;;) {
    const users = await db().user.findMany({
      where: recipientsWhere(),
      select: { id: true, telegramId: true, locale: true, languageCode: true },
      orderBy: { id: "asc" },
      take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!users.length) break;
    for (const user of users) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        timedOut = true;
        break outer;
      }
      total++;
      const locale = user.locale ?? (user.languageCode?.startsWith("pt") ? "pt_BR" : DEFAULT_LOCALE);
      const kb = new InlineKeyboard().text(t(locale, "promo_view_product"), `p:${product.id}`);
      try {
        await sendHtml(user.telegramId, await textFor(locale), kb);
        sent++;
      } catch (err) {
        failed++;
        // 403 = the customer blocked the bot; not worth logging one by one.
        if (!(err instanceof GrammyError && (err.error_code === 403 || err.error_code === 400))) logger.warn("promo.send_failed", { err, userId: user.id });
      }
      await new Promise((r) => setTimeout(r, SEND_GAP_MS));
    }
    cursor = users.at(-1)!.id;
  }

  logger.info("promo.broadcast_done", { productId: product.id, sent, failed, timedOut });
  await alertAdmins(
    `📣 Aviso de desconto de <b>${escapeHtml(product.name)}</b> enviado para <b>${sent}</b> cliente(s)` +
      (failed ? ` · ${failed} não receberam (bloquearam o bot)` : "") +
      (timedOut ? `\n⚠️ Tempo esgotado após ${total} clientes — parte da lista não recebeu.` : ""),
  );
}
