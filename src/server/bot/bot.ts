import { Bot, Context, GrammyError, InlineKeyboard, InputFile, Keyboard, type NextFunction } from "grammy";
import type { User } from "@/generated/prisma/client";
import type { Locale } from "@/generated/prisma/enums";
import { env } from "@/server/config/env";
import { db } from "@/server/common/db";
import { AppError } from "@/server/common/errors";
import { logger } from "@/server/common/logger";
import { formatMoney, parseMoneyToCents } from "@/server/common/money";
import { rateLimit } from "@/server/common/rate-limit";
import { allTranslations, detectLocale, formatItems, t, type MessageKey } from "@/i18n";
import { bulkDiscountTiers, bulkPercentOff, discountedUnitCents, productUnitCents } from "@/lib/bulk-discounts";
import { setBotState, setLocale, upsertTelegramUser } from "@/server/users/users.service";
import { listProducts, sellableStock, localizedDescription, localizedName, productLogoUrl } from "@/server/products/products.service";
import { availablePaymentMethods, cancelOrderByUser, createOrder, getUserOrder, listUserOrders, MAX_QUANTITY_PER_ORDER, syncOrderPayment } from "@/server/orders/orders.service";
import { getSettings } from "@/server/settings/settings.service";
import { InsufficientBalanceError } from "@/server/wallet/ledger.service";
import { binancePayAvailable, cancelDeposit, claimTransaction, createDeposit, DepositError, type DepositErrorCode } from "@/server/wallet/deposit.service";
import { getOpenTicket } from "@/server/support/support.service";
import { hasStockAlert, toggleStockAlert } from "@/server/inventory/stock-alerts.service";
import { handleSupportMessage, registerSupportHandlers, showSupport, type SupportState } from "@/server/bot/support.handlers";

/** Context enriched with the stored customer. The bot is only an interface: logic lives in services. */
export interface StoreContext extends Context {
  user: User;
  locale: Locale;
  tr: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

type BotState = { await: "quantity"; productId: string } | { await: "deposit_amount" } | { await: "deposit_tx"; depositId?: string } | SupportState | null;

// ───────────────────────── Keyboards ─────────────────────────

function mainMenu(locale: Locale) {
  const tr = (k: MessageKey) => t(locale, k);
  return new Keyboard()
    .text(tr("menu_buy")).text(tr("menu_orders")).row()
    .text(tr("menu_prices")).text(tr("menu_support")).row()
    .text(tr("menu_help")).text(tr("menu_language"))
    .resized()
    .persistent()
    .placeholder(tr("menu_placeholder"));
}

const languageKeyboard = new InlineKeyboard().text("🇧🇷 Português", "lang:pt_BR").text("🇺🇸 English", "lang:en_US");

/** Price in the currencies customers can actually pay with (only R$ when PIX is the only method). */
async function priceFormatter(locale: Locale) {
  const methods = await availablePaymentMethods(locale);
  const currencies = [...new Set(methods.map((m) => m.currency))].sort(); // BRL before USD
  const shown = currencies.length ? currencies : ["BRL"];
  return (p: { priceBrlCents: number; priceUsdCents: number }) =>
    shown.map((c) => formatMoney(c === "BRL" ? p.priceBrlCents : p.priceUsdCents, c, locale)).join(" / ");
}

function isMenu(text: string, key: MessageKey): boolean {
  return allTranslations(key).includes(text);
}

// ───────────────────────── Screens ─────────────────────────

/** Welcome banner served from /public (Telegram downloads it by URL). */
const WELCOME_IMAGE_PATH = "/brand/welcome.jpg";

async function showMenu(ctx: StoreContext, opts: { banner?: boolean } = {}) {
  const text = ctx.tr("welcome", { name: ctx.from?.first_name ?? "" });
  if (opts.banner) {
    try {
      return await ctx.replyWithPhoto(`${env().APP_URL}${WELCOME_IMAGE_PATH}`, { caption: text, parse_mode: "HTML", reply_markup: mainMenu(ctx.locale) });
    } catch (err) {
      logger.warn("bot.welcome_image_failed", { err }); // fall back to text
    }
  }
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: mainMenu(ctx.locale) });
}

/** Richest product-button look Telegram accepted so far (icons need a Premium bot owner). Per instance. */
type ButtonLook = "icons" | "colors" | "plain";
const BUTTON_LOOKS: ButtonLook[] = ["icons", "colors", "plain"];
let buttonLook: ButtonLook = "icons";

/**
 * Splits buttons into rows of up to 3 (like a service grid), keeping each label readable on a phone:
 * 3 per row while every label in it is short, 2 while they are medium, 1 for long ones.
 */
function gridRows<T extends { label: string }>(buttons: T[]): T[][] {
  const perRow = (len: number) => (len <= 14 ? 3 : len <= 22 ? 2 : 1);
  const rows: T[][] = [];
  let row: T[] = [];
  let cap = 3; // most buttons the current row can hold
  for (const b of buttons) {
    const len = b.label.length;
    if (row.length && row.length >= Math.min(cap, perRow(len))) {
      rows.push(row);
      row = [];
      cap = 3;
    }
    cap = Math.min(cap, perRow(len));
    row.push(b);
  }
  if (row.length) rows.push(row);
  return rows;
}

async function showProducts(ctx: StoreContext) {
  // Sold-out products stay listed (at the end, in red) so customers can ask to be notified when they are back.
  const products = (await listProducts()).sort((a, b) => Number(b.sellable > 0) - Number(a.sellable > 0));
  if (!products.length) return ctx.reply(ctx.tr("no_products"));
  const price = await priceFormatter(ctx.locale);
  // Grid of "Name · price" buttons with the service logo on the left; sold-out ones in red.
  const buttons = products.map((p) => ({ p, label: `${localizedName(p, ctx.locale)} · ${price(p)}` }));
  const keyboard = (look: ButtonLook) => {
    const kb = new InlineKeyboard();
    for (const row of gridRows(buttons)) {
      for (const { p, label } of row) {
        kb.text(label, `p:${p.id}`);
        if (look !== "plain" && p.sellable <= 0) kb.style("danger");
        if (look === "icons" && p.buttonEmojiId) kb.icon(p.buttonEmojiId);
      }
      kb.row();
    }
    return kb;
  };
  for (const look of BUTTON_LOOKS.slice(BUTTON_LOOKS.indexOf(buttonLook))) {
    try {
      await ctx.reply(ctx.tr("choose_product"), { parse_mode: "HTML", reply_markup: keyboard(look) });
      buttonLook = look;
      return;
    } catch (err) {
      // Telegram refuses icons (bot owner without Premium) or styles: fall back to a simpler look.
      if (look === "plain" || !(err instanceof GrammyError && err.error_code === 400)) throw err;
      logger.warn("bot.product_buttons_look_failed", { err, look });
    }
  }
}

async function showProduct(ctx: StoreContext, productId: string) {
  const product = await db().product.findFirst({ where: { id: productId, isActive: true, deletedAt: null } });
  if (!product) return ctx.reply(ctx.tr("no_products"));
  const stock = await sellableStock(product);
  const text = ctx.tr("product_details", {
    name: localizedName(product, ctx.locale),
    description: localizedDescription(product, ctx.locale),
    price: (await priceFormatter(ctx.locale))(product),
    stock: stock > 0 ? String(stock) : "0",
  });
  if (stock <= 0) {
    const subscribed = await hasStockAlert(ctx.user.id, product.id);
    return ctx.reply(`${text}\n\n${ctx.tr("out_of_stock")}`, { parse_mode: "HTML", reply_markup: stockAlertKeyboard(ctx, product.id, subscribed) });
  }

  if (!(await availablePaymentMethods(ctx.locale)).length) return ctx.reply(`${text}\n\n${ctx.tr("no_payment_methods")}`, { parse_mode: "HTML" });
  const kb = quantityKeyboard(ctx, product.id, stock);
  const discounts = await bulkDiscountsText(ctx, product);
  const body = `${text}${discounts ? `\n\n${discounts}` : ""}\n\n${ctx.tr("choose_quantity")}`;
  const logo = productLogoUrl(product, true);
  if (logo) {
    try {
      // Telegram photo captions are limited to 1024 characters.
      if (body.length <= 1024) return await ctx.replyWithPhoto(logo, { caption: body, parse_mode: "HTML", reply_markup: kb });
      await ctx.replyWithPhoto(logo);
    } catch (err) {
      logger.warn("bot.product_logo_failed", { err, productId: product.id }); // fall back to text only
    }
  }
  await ctx.reply(body, { parse_mode: "HTML", reply_markup: kb });
}

/** "5-10 un. → R$ 8,00 each" per discount tier (empty when the product has no quantity discounts). */
async function bulkDiscountsText(ctx: StoreContext, product: { priceBrlCents: number; priceUsdCents: number; bulkDiscounts: unknown }): Promise<string> {
  const tiers = bulkDiscountTiers(product.bulkDiscounts);
  if (!tiers.length) return "";
  const price = await priceFormatter(ctx.locale);
  const lines = tiers.map((tier, i) => {
    const next = tiers[i + 1];
    const range = !next ? `${tier.minQty}+` : next.minQty - 1 > tier.minQty ? `${tier.minQty}-${next.minQty - 1}` : String(tier.minQty);
    const each = price({
      priceBrlCents: discountedUnitCents(product.priceBrlCents, [tier], tier.minQty),
      priceUsdCents: discountedUnitCents(product.priceUsdCents, [tier], tier.minQty),
    });
    return ctx.tr("bulk_discount_line", { range, price: each });
  });
  return [ctx.tr("bulk_discounts_title"), ...lines].join("\n");
}

const QUANTITY_PRESETS = [1, 2, 3, 5, 10, 15, 20, 25];

/** Preset quantities (capped by stock and by the per-order limit), four per row, plus a custom amount. */
function quantityKeyboard(ctx: StoreContext, productId: string, stock: number) {
  const kb = new InlineKeyboard();
  const max = Math.min(stock, MAX_QUANTITY_PER_ORDER);
  QUANTITY_PRESETS.filter((q) => q <= max).forEach((q, i) => {
    if (i > 0 && i % 4 === 0) kb.row();
    kb.text(ctx.tr("quantity_button", { quantity: q }), `qty:${productId}:${q}`);
  });
  if (max > 1) kb.row().text(ctx.tr("custom_quantity_button"), `qc:${productId}`);
  return kb.row().text(ctx.tr("back"), "menu:buy");
}

/** Customer typed a quantity after tapping "Custom quantity". */
async function handleCustomQuantity(ctx: StoreContext, productId: string, text: string) {
  const product = await db().product.findFirst({ where: { id: productId, isActive: true, deletedAt: null } });
  if (!product) {
    await setBotState(ctx.user.id, null);
    return ctx.reply(ctx.tr("no_products"));
  }
  const max = Math.min(await sellableStock(product), MAX_QUANTITY_PER_ORDER);
  const quantity = /^\d{1,4}$/.test(text) ? Number(text) : NaN;
  if (!(quantity >= 1 && quantity <= max)) return ctx.reply(ctx.tr("invalid_quantity", { max: Math.max(max, 1) }));
  await setBotState(ctx.user.id, null);
  await showPaymentMethods(ctx, productId, quantity);
}

/** After the quantity is chosen: payment methods with the total for that quantity. */
async function showPaymentMethods(ctx: StoreContext, productId: string, quantity: number) {
  const product = await db().product.findFirst({ where: { id: productId, isActive: true, deletedAt: null } });
  if (!product) return ctx.reply(ctx.tr("no_products"));
  const stock = await sellableStock(product);
  if (stock <= 0) return ctx.reply(ctx.tr("out_of_stock"), { parse_mode: "HTML", reply_markup: stockAlertKeyboard(ctx, product.id, await hasStockAlert(ctx.user.id, product.id)) });
  if (stock < quantity) return ctx.reply(ctx.tr("not_enough_stock", { stock }), { parse_mode: "HTML", reply_markup: quantityKeyboard(ctx, product.id, stock) });

  const methods = await availablePaymentMethods(ctx.locale);
  if (!methods.length) return ctx.reply(ctx.tr("no_payment_methods"));
  const kb = new InlineKeyboard();
  for (const m of methods) {
    const total = productUnitCents(product, m.currency, quantity) * quantity;
    const label = ctx.locale === "pt_BR" ? m.labelPt : m.labelEn;
    kb.text(`${label} — ${formatMoney(total, m.currency, ctx.locale)}`, `pay:${product.id}:${quantity}:${m.key}`).row();
  }
  kb.text(ctx.tr("back"), `p:${product.id}`);
  let summary = ctx.tr("quantity_summary", { product: localizedName(product, ctx.locale), quantity });
  const tiers = bulkDiscountTiers(product.bulkDiscounts);
  const percent = bulkPercentOff(tiers, quantity);
  if (percent > 0) {
    const each = (await priceFormatter(ctx.locale))({
      priceBrlCents: discountedUnitCents(product.priceBrlCents, tiers, quantity),
      priceUsdCents: discountedUnitCents(product.priceUsdCents, tiers, quantity),
    });
    summary += `\n${ctx.tr("quantity_discount", { percent: ctx.locale === "pt_BR" ? String(percent).replace(".", ",") : percent, price: each })}`;
  }
  await ctx.reply(`${summary}\n\n${ctx.tr("choose_payment")}`, { parse_mode: "HTML", reply_markup: kb });
}

function stockAlertKeyboard(ctx: StoreContext, productId: string, subscribed: boolean) {
  return new InlineKeyboard().text(ctx.tr(subscribed ? "notify_me_on" : "notify_me"), `ntf:${productId}`).row().text(ctx.tr("back"), "menu:buy");
}

/** Blue button that copies the PIX "copia e cola" code with one tap (Telegram limits it to 256 chars). */
function addCopyPixButton(ctx: StoreContext, kb: InlineKeyboard, code: string) {
  if (code.length > 256) return;
  kb.copyText(ctx.tr("copy_pix_button"), code).style("primary").row();
}

async function startCheckout(ctx: StoreContext, productId: string, methodKey: string, quantity: number) {
  try {
    const order = await createOrder(ctx.user, productId, methodKey, quantity);
    const header = ctx.tr("order_created", {
      number: order.number,
      product: order.productName,
      quantity: order.quantity,
      amount: formatMoney(order.amountCents, order.currency, ctx.locale),
      minutes: Math.max(1, Math.round((order.expiresAt.getTime() - Date.now()) / 60000)),
    });
    const kb = new InlineKeyboard();

    if (order.method.provider === "balance") {
      return ctx.reply(`${header}\n\n${ctx.tr("balance_paid")}`, { parse_mode: "HTML" });
    }
    if (order.payment.checkoutUrl && !order.payment.pixCopyPaste) kb.url(ctx.tr("pay_button"), order.payment.checkoutUrl).row();
    if (order.payment.pixCopyPaste) addCopyPixButton(ctx, kb, order.payment.pixCopyPaste);
    kb.text(ctx.tr("check_status"), `st:${order.orderId}`).row().text(ctx.tr("cancel_order"), `cx:${order.orderId}`);

    if (order.payment.pixCopyPaste) {
      const caption = `${header}\n\n${ctx.tr("pix_instructions", { code: order.payment.pixCopyPaste })}`;
      if (order.payment.pixQrBase64 && caption.length <= 1024) {
        return ctx.replyWithPhoto(new InputFile(Buffer.from(order.payment.pixQrBase64, "base64"), "pix.png"), { caption, parse_mode: "HTML", reply_markup: kb });
      }
      if (order.payment.pixQrBase64) {
        await ctx.replyWithPhoto(new InputFile(Buffer.from(order.payment.pixQrBase64, "base64"), "pix.png"));
      }
      return ctx.reply(caption, { parse_mode: "HTML", reply_markup: kb });
    }
    return ctx.reply(`${header}\n\n${ctx.tr("checkout_instructions")}`, { parse_mode: "HTML", reply_markup: kb });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      const product = await db().product.findUnique({ where: { id: productId } });
      return ctx.reply(
        ctx.tr("insufficient_balance", {
          balance: formatMoney(err.balanceCents, "USD", ctx.locale),
          price: formatMoney(product ? productUnitCents(product, "USD", quantity) * quantity : 0, "USD", ctx.locale),
        }),
        { reply_markup: new InlineKeyboard().text(ctx.tr("deposit_button"), "dep:new") },
      );
    }
    if (err instanceof AppError) {
      if (err.code === "OUT_OF_STOCK") {
        // Fewer units left than requested: offer the quantities still available.
        const product = await db().product.findUnique({ where: { id: productId } });
        const stock = product ? await sellableStock(product) : 0;
        if (stock > 0) return ctx.reply(ctx.tr("not_enough_stock", { stock }), { parse_mode: "HTML", reply_markup: quantityKeyboard(ctx, productId, stock) });
        return ctx.reply(ctx.tr("out_of_stock"), { parse_mode: "HTML", reply_markup: stockAlertKeyboard(ctx, productId, await hasStockAlert(ctx.user.id, productId)) });
      }
      if (err.code === "TOO_MANY_PENDING") return ctx.reply(ctx.tr("too_many_pending"));
      if (err.code === "RATE_LIMITED") return ctx.reply(ctx.tr("too_many_requests"));
      if (err.code === "PAYMENT_PROVIDER_ERROR" || err.code === "METHOD_UNAVAILABLE") return ctx.reply(ctx.tr("payment_error"));
    }
    throw err;
  }
}

async function showOrders(ctx: StoreContext) {
  const orders = await listUserOrders(ctx.user.id, 10);
  if (!orders.length) return ctx.reply(ctx.tr("orders_empty"));
  const kb = new InlineKeyboard();
  for (const o of orders) {
    const product = `${o.quantity > 1 ? `${o.quantity}x ` : ""}${o.productName}`.slice(0, 24);
    kb.text(t(ctx.locale, "order_button", { number: o.number, product, status: t(ctx.locale, `status_${o.status}` as MessageKey) }), `o:${o.id}`).row();
  }
  await ctx.reply(ctx.tr("orders_title"), { parse_mode: "HTML", reply_markup: kb });
}

async function showOrder(ctx: StoreContext, orderId: string) {
  const found = await getUserOrder(ctx.user.id, orderId);
  if (!found) return ctx.reply(ctx.tr("orders_empty"));
  const { order, items } = found;
  let text = ctx.tr("order_details", {
    number: order.number,
    product: order.productName,
    quantity: order.quantity,
    amount: formatMoney(order.amountCents, order.currency, ctx.locale),
    method: order.paymentMethod,
    status: ctx.tr(`status_${order.status}` as MessageKey),
    date: order.createdAt.toLocaleString(ctx.locale === "pt_BR" ? "pt-BR" : "en-US", { timeZone: "America/Sao_Paulo" }),
  });
  if (items.length) text += t(ctx.locale, "order_access", {}, { items: formatItems(items, ctx.locale) });
  const kb = new InlineKeyboard();
  if (order.status === "PENDING") {
    if (order.payment?.checkoutUrl && !order.payment.pixCopyPaste) kb.url(ctx.tr("pay_button"), order.payment.checkoutUrl).row();
    if (order.payment?.pixCopyPaste) addCopyPixButton(ctx, kb, order.payment.pixCopyPaste);
    kb.text(ctx.tr("check_status"), `st:${order.id}`).row().text(ctx.tr("cancel_order"), `cx:${order.id}`);
  }
  await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
}

async function checkStatus(ctx: StoreContext, orderId: string) {
  const found = await getUserOrder(ctx.user.id, orderId);
  if (!found) return;
  if (!(await rateLimit(`bot:status:${ctx.user.id}`, 6, 60))) return ctx.reply(ctx.tr("too_many_requests"));
  if (found.order.status === "PENDING") {
    // Asks the payment provider's API - the customer's "I paid" is never enough to deliver.
    await syncOrderPayment(orderId, { actorType: "BOT" }).catch((err) => logger.warn("bot.sync_failed", { err, orderId }));
  }
  const fresh = await getUserOrder(ctx.user.id, orderId);
  if (!fresh) return;
  if (fresh.order.status === "PENDING") return ctx.reply(ctx.tr("order_still_pending", { number: fresh.order.number }));
  // Delivery message itself is sent by the delivery service; here we only report the status.
  return ctx.reply(ctx.tr("order_not_pending", { number: fresh.order.number, status: ctx.tr(`status_${fresh.order.status}` as MessageKey) }));
}

async function showPrices(ctx: StoreContext) {
  const products = await listProducts();
  if (!products.length) return ctx.reply(ctx.tr("no_products"));
  const price = await priceFormatter(ctx.locale);
  const lines = products.map((p) => ctx.tr("price_line", { name: localizedName(p, ctx.locale), price: price(p), stock: p.sellable }));
  await ctx.reply([ctx.tr("prices_title"), "", ...lines].join("\n"), { parse_mode: "HTML" });
}

async function showHelp(ctx: StoreContext) {
  const { supportContact } = await getSettings();
  await ctx.reply(ctx.tr("help_text") + (supportContact ? ctx.tr("help_support", { contact: supportContact }) : ""), { parse_mode: "HTML" });
}

// ───────────────────────── Balance / Binance Pay ─────────────────────────

async function showBalance(ctx: StoreContext) {
  const kb = new InlineKeyboard();
  if (await binancePayAvailable()) kb.text(ctx.tr("deposit_button"), "dep:new");
  await ctx.reply(ctx.tr("balance_info", { balance: formatMoney(ctx.user.balanceCents, "USD", ctx.locale) }), { parse_mode: "HTML", reply_markup: kb });
}

async function askDepositAmount(ctx: StoreContext) {
  if (!(await binancePayAvailable())) return ctx.reply(ctx.tr("deposit_disabled"));
  const s = (await getSettings()).binancePay;
  if (!s.requireExactAmount) {
    // Open amount: pay any value first, then send the transaction id.
    const kb = new InlineKeyboard().text(ctx.tr("deposit_paid_button"), "dep:claim");
    return ctx.reply(
      ctx.tr("deposit_open_instructions", {
        payId: env().BINANCE_PAY_ID ?? "",
        assets: s.acceptedAssets.join(", "),
        hours: s.claimWindowHours,
      }),
      { parse_mode: "HTML", reply_markup: kb },
    );
  }
  const kb = new InlineKeyboard();
  s.presetAmountsCents.forEach((c, i) => {
    kb.text(`${(c / 100).toFixed(2)} ${s.asset}`, `dep:a:${c}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text(ctx.tr("deposit_custom_amount"), "dep:custom");
  await ctx.reply(ctx.tr("deposit_choose_amount", { asset: s.asset }), { reply_markup: kb });
}

async function startDeposit(ctx: StoreContext, cents: number) {
  try {
    const d = await createDeposit(ctx.user, cents);
    await setBotState(ctx.user.id, null);
    const kb = new InlineKeyboard().text(ctx.tr("deposit_paid_button"), `dep:tx:${d.id}`).row().text(ctx.tr("deposit_cancel_button"), `dep:cx:${d.id}`);
    await ctx.reply(
      ctx.tr("deposit_instructions", {
        amount: (d.expectedCents / 100).toFixed(2),
        asset: d.asset,
        payId: env().BINANCE_PAY_ID ?? "",
        expires: d.expiresAt.toLocaleString(ctx.locale === "pt_BR" ? "pt-BR" : "en-US", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }),
      }),
      { parse_mode: "HTML", reply_markup: kb },
    );
  } catch (err) {
    if (err instanceof DepositError) return replyDepositError(ctx, err.depositCode);
    throw err;
  }
}

async function replyDepositError(ctx: StoreContext, code: DepositErrorCode) {
  const s = (await getSettings()).binancePay;
  const pending = await db().deposit.findFirst({ where: { userId: ctx.user.id, status: "PENDING" }, orderBy: { createdAt: "desc" } });
  const map: Record<DepositErrorCode, string> = {
    DISABLED: ctx.tr("deposit_disabled"),
    INVALID_AMOUNT: ctx.tr("deposit_invalid_amount", { min: (s.minDepositCents / 100).toFixed(2), max: (s.maxDepositCents / 100).toFixed(2) }),
    RATE_LIMITED: ctx.tr("too_many_requests"),
    TX_INVALID: ctx.tr("deposit_tx_invalid"),
    TX_USED: ctx.tr("deposit_tx_used"),
    NO_PENDING: ctx.tr("deposit_no_pending"),
    TOO_MANY_ATTEMPTS: ctx.tr("deposit_too_many_attempts"),
    TX_NOT_FOUND: ctx.tr("deposit_tx_not_found"),
    TX_MISMATCH: s.requireExactAmount
      ? ctx.tr("deposit_tx_mismatch", { amount: pending ? (pending.expectedCents / 100).toFixed(2) : "-", asset: pending?.asset ?? s.asset })
      : ctx.tr("deposit_tx_rejected", { assets: s.acceptedAssets.join(", ") }),
    UNAVAILABLE: ctx.tr("deposit_unavailable"),
  };
  await ctx.reply(map[code], { parse_mode: "HTML" });
}

async function handleDepositTx(ctx: StoreContext, txId: string) {
  await ctx.reply(ctx.tr("deposit_verifying"));
  try {
    const r = await claimTransaction(ctx.user, txId);
    await setBotState(ctx.user.id, null);
    await ctx.reply(
      ctx.tr("deposit_confirmed", {
        amount: `${(r.creditedCents / 100).toFixed(2)} ${r.asset}`,
        balance: formatMoney(r.balanceAfterCents, "USD", ctx.locale),
      }),
      { parse_mode: "HTML" },
    );
  } catch (err) {
    if (err instanceof DepositError) {
      if (["TX_USED", "NO_PENDING", "TOO_MANY_ATTEMPTS"].includes(err.depositCode)) await setBotState(ctx.user.id, null);
      return replyDepositError(ctx, err.depositCode);
    }
    throw err;
  }
}

// ───────────────────────── Bot wiring ─────────────────────────

async function loadUser(ctx: StoreContext, next: NextFunction) {
  if (!ctx.from || ctx.chat?.type !== "private") return; // private chats only
  if (!(await rateLimit(`bot:${ctx.from.id}`, 40, 60))) {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => undefined);
    return;
  }
  ctx.user = await upsertTelegramUser(ctx.from);
  if (ctx.user.isBlocked) return;
  ctx.locale = ctx.user.locale ?? detectLocale(ctx.from.language_code);
  ctx.tr = (key, vars) => t(ctx.locale, key, vars);

  const type = ctx.callbackQuery ? "callback" : ctx.message?.text?.startsWith("/") ? "command" : ctx.message ? "message" : "other";
  // Log intent only (no free text, which could contain transaction ids or personal data).
  db().botEvent
    .create({
      data: {
        userId: ctx.user.id,
        telegramId: BigInt(ctx.from.id),
        type,
        payload: { data: ctx.callbackQuery?.data?.split(":").slice(0, 2).join(":") ?? ctx.message?.text?.match(/^\/\w+/)?.[0] ?? null },
      },
    })
    .catch(() => undefined);
  await next();
}

export function createBot(): Bot<StoreContext> {
  const e = env();
  const bot = new Bot<StoreContext>(e.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_BOT_INFO ? { botInfo: JSON.parse(process.env.TELEGRAM_BOT_INFO) } : undefined);

  bot.use(loadUser);
  registerSupportHandlers(bot); // before the generic text handler so /suporte is matched

  bot.command("start", async (ctx) => {
    await setBotState(ctx.user.id, null);
    if (!ctx.user.locale) {
      return ctx.reply(t(ctx.locale, "lang_prompt"), { reply_markup: languageKeyboard });
    }
    await showMenu(ctx, { banner: true });
    const payload = ctx.match;
    const paid = typeof payload === "string" ? /^paid_(\d+)$/.exec(payload) : null;
    if (paid) {
      const order = await db().order.findFirst({ where: { userId: ctx.user.id, number: Number(paid[1]) } });
      if (order) await checkStatus(ctx, order.id);
    }
  });
  bot.command(["language", "idioma"], (ctx) => ctx.reply(t(ctx.locale, "lang_prompt"), { reply_markup: languageKeyboard }));
  bot.command(["buy", "comprar"], showProducts);
  bot.command(["orders", "pedidos"], showOrders);
  bot.command(["prices", "precos"], showPrices);
  bot.command(["balance", "saldo"], showBalance);
  bot.command(["help", "ajuda"], showHelp);

  bot.callbackQuery(/^lang:(pt_BR|en_US)$/, async (ctx) => {
    const locale = ctx.match[1] as Locale;
    ctx.user = await setLocale(ctx.user.id, locale);
    ctx.locale = locale;
    await ctx.answerCallbackQuery();
    await ctx.reply(t(locale, "lang_set"), { reply_markup: mainMenu(locale) });
    await showMenu(ctx, { banner: true });
  });
  bot.callbackQuery("menu:buy", async (ctx) => {
    await ctx.answerCallbackQuery();
    await showProducts(ctx);
  });
  bot.callbackQuery(/^p:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showProduct(ctx, ctx.match[1]!);
  });
  bot.callbackQuery(/^ntf:(\w+)$/, async (ctx) => {
    const productId = ctx.match[1]!;
    const on = await toggleStockAlert(ctx.user.id, productId);
    await ctx.answerCallbackQuery({ text: ctx.tr(on ? "notify_me_subscribed" : "notify_me_cancelled") });
    await ctx.editMessageReplyMarkup({ reply_markup: stockAlertKeyboard(ctx, productId, on) }).catch(() => undefined);
  });
  bot.callbackQuery(/^qty:(\w+):(\d{1,3})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const quantity = Number(ctx.match[2]);
    if (quantity < 1 || quantity > MAX_QUANTITY_PER_ORDER) return;
    await showPaymentMethods(ctx, ctx.match[1]!, quantity);
  });
  bot.callbackQuery(/^pay:(\w+):(\d{1,3}):([a-z0-9_]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const quantity = Number(ctx.match[2]);
    if (quantity < 1 || quantity > MAX_QUANTITY_PER_ORDER) return;
    await startCheckout(ctx, ctx.match[1]!, ctx.match[3]!, quantity);
  });
  bot.callbackQuery(/^qc:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const product = await db().product.findFirst({ where: { id: ctx.match[1]!, isActive: true, deletedAt: null } });
    if (!product) return ctx.reply(ctx.tr("no_products"));
    const max = Math.min(await sellableStock(product), MAX_QUANTITY_PER_ORDER);
    if (max <= 0) return ctx.reply(ctx.tr("out_of_stock"), { parse_mode: "HTML", reply_markup: stockAlertKeyboard(ctx, product.id, await hasStockAlert(ctx.user.id, product.id)) });
    await setBotState(ctx.user.id, { await: "quantity", productId: product.id });
    await ctx.reply(ctx.tr("custom_quantity_prompt", { max }));
  });
  // Buttons sent before quantities existed (no quantity in the data) buy a single unit.
  bot.callbackQuery(/^pay:(\w+):([a-z0-9_]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await startCheckout(ctx, ctx.match[1]!, ctx.match[2]!, 1);
  });
  bot.callbackQuery(/^st:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await checkStatus(ctx, ctx.match[1]!);
  });
  bot.callbackQuery(/^cx:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const r = await cancelOrderByUser(ctx.user.id, ctx.match[1]!);
    if (r) await ctx.reply(ctx.tr("order_cancelled", { number: r.number }));
    else await showOrder(ctx, ctx.match[1]!);
  });
  bot.callbackQuery(/^o:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await showOrder(ctx, ctx.match[1]!);
  });

  bot.callbackQuery("dep:new", async (ctx) => {
    await ctx.answerCallbackQuery();
    await askDepositAmount(ctx);
  });
  bot.callbackQuery(/^dep:a:(\d{1,9})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await startDeposit(ctx, Number(ctx.match[1]));
  });
  bot.callbackQuery("dep:custom", async (ctx) => {
    await ctx.answerCallbackQuery();
    const s = (await getSettings()).binancePay;
    await setBotState(ctx.user.id, { await: "deposit_amount" });
    await ctx.reply(ctx.tr("deposit_custom_prompt", { asset: s.asset, min: (s.minDepositCents / 100).toFixed(2), max: (s.maxDepositCents / 100).toFixed(2) }));
  });
  bot.callbackQuery("dep:claim", async (ctx) => {
    await ctx.answerCallbackQuery();
    await setBotState(ctx.user.id, { await: "deposit_tx" });
    await ctx.reply(ctx.tr("deposit_send_tx_prompt"), { parse_mode: "HTML" });
  });
  bot.callbackQuery(/^dep:tx:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await setBotState(ctx.user.id, { await: "deposit_tx", depositId: ctx.match[1]! });
    await ctx.reply(ctx.tr("deposit_send_tx_prompt"), { parse_mode: "HTML" });
  });
  bot.callbackQuery(/^dep:cx:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await cancelDeposit(ctx.user.id, ctx.match[1]!);
    await setBotState(ctx.user.id, null);
    await ctx.reply(ctx.tr("deposit_cancelled"));
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (isMenu(text, "menu_buy")) return clearStateThen(ctx, showProducts);
    if (isMenu(text, "menu_orders")) return clearStateThen(ctx, showOrders);
    if (isMenu(text, "menu_prices")) return clearStateThen(ctx, showPrices);
    if (isMenu(text, "menu_balance")) return clearStateThen(ctx, showBalance);
    if (isMenu(text, "menu_help")) return clearStateThen(ctx, showHelp);
    if (isMenu(text, "menu_support")) return clearStateThen(ctx, showSupport);
    if (isMenu(text, "menu_language")) return ctx.reply(t(ctx.locale, "lang_prompt"), { reply_markup: languageKeyboard });

    const state = ctx.user.botState as BotState;
    if (state?.await === "quantity") return handleCustomQuantity(ctx, state.productId, text);
    if (state?.await === "deposit_amount") {
      const cents = parseMoneyToCents(text);
      if (cents === null) return replyDepositError(ctx, "INVALID_AMOUNT");
      return startDeposit(ctx, cents);
    }
    if (state?.await === "deposit_tx") return handleDepositTx(ctx, text);
    if (state?.await === "support_message") return handleSupportMessage(ctx, state, text);

    if (!ctx.user.locale) return ctx.reply(t(ctx.locale, "lang_prompt"), { reply_markup: languageKeyboard });
    // A customer with an open ticket can simply type: the message goes to the ticket.
    if (await getOpenTicket(ctx.user.id)) return handleSupportMessage(ctx, null, text);
    await ctx.reply(ctx.tr("unknown_command"), { reply_markup: mainMenu(ctx.locale) });
  });

  // Screenshots for support (largest size is the last one).
  bot.on("message:photo", async (ctx) => {
    const state = ctx.user.botState as BotState;
    const photo = ctx.message.photo.at(-1);
    if (photo && (state?.await === "support_message" || (await getOpenTicket(ctx.user.id)))) {
      return handleSupportMessage(ctx, state?.await === "support_message" ? state : null, ctx.message.caption, photo.file_id);
    }
    await ctx.reply(ctx.tr("unknown_command"), { reply_markup: mainMenu(ctx.locale) });
  });

  bot.on("callback_query", (ctx) => ctx.answerCallbackQuery()); // stale buttons

  bot.catch(async (err) => {
    logger.error("bot.error", { err: err.error, updateId: err.ctx.update.update_id });
    const ctx = err.ctx as StoreContext;
    if (ctx.chat && ctx.locale) await ctx.reply(t(ctx.locale, "generic_error")).catch(() => undefined);
  });

  return bot;
}

async function clearStateThen(ctx: StoreContext, fn: (ctx: StoreContext) => Promise<unknown>) {
  if (ctx.user.botState) await setBotState(ctx.user.id, null);
  await fn(ctx);
}

let instance: Bot<StoreContext> | undefined;
export function getBot(): Bot<StoreContext> {
  if (!instance) instance = createBot();
  return instance;
}
