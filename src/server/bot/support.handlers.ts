import { InlineKeyboard, type Bot } from "grammy";
import type { TicketType } from "@/generated/prisma/enums";
import { t, type MessageKey } from "@/i18n";
import { setBotState } from "@/server/users/users.service";
import { getUserOrder, listUserOrders } from "@/server/orders/orders.service";
import { closeByCustomer, getOpenTicket, submitCustomerMessage, SupportError } from "@/server/support/support.service";
import type { StoreContext } from "@/server/bot/bot";

/** Conversation state while the customer is writing to support. */
export type SupportState = { await: "support_message"; type?: TicketType; orderId?: string };

function closeKeyboard(ctx: StoreContext, ticketId: string) {
  return new InlineKeyboard().text(ctx.tr("support_close_button"), `sup:close:${ticketId}`);
}

/** Entry point (menu button / command): shows the open ticket or asks pre-sale vs post-sale. */
export async function showSupport(ctx: StoreContext) {
  const open = await getOpenTicket(ctx.user.id);
  if (open) {
    await setBotState(ctx.user.id, { await: "support_message" });
    const kb = new InlineKeyboard().text(ctx.tr("support_write_button"), "sup:write").row().text(ctx.tr("support_close_button"), `sup:close:${open.id}`);
    return ctx.reply(ctx.tr("support_open_ticket", { number: open.number, status: ctx.tr(`support_status_${open.status}` as MessageKey) }), {
      parse_mode: "HTML",
      reply_markup: kb,
    });
  }
  const kb = new InlineKeyboard().text(ctx.tr("support_pre"), "sup:pre").row().text(ctx.tr("support_post"), "sup:post");
  await ctx.reply(ctx.tr("support_intro"), { parse_mode: "HTML", reply_markup: kb });
}

/** Stores a customer message (text and/or photo) in their ticket, opening one if needed. */
export async function handleSupportMessage(ctx: StoreContext, state: SupportState | null, text: string | undefined, telegramFileId?: string) {
  try {
    const r = await submitCustomerMessage(ctx.user, { type: state?.type, orderId: state?.orderId, text, telegramFileId });
    // Keep the conversation open: further messages go to the same ticket until a menu button is used.
    await setBotState(ctx.user.id, { await: "support_message" });
    await ctx.reply(ctx.tr(r.created ? "support_created" : "support_added", { number: r.number }), {
      parse_mode: "HTML",
      reply_markup: closeKeyboard(ctx, r.ticketId),
    });
  } catch (err) {
    if (!(err instanceof SupportError)) throw err;
    if (err.supportCode === "NO_OPEN_TICKET") return showSupport(ctx);
    const key: Record<Exclude<SupportError["supportCode"], "NO_OPEN_TICKET">, MessageKey> = {
      RATE_LIMITED: "too_many_requests",
      EMPTY: "support_empty",
      TOO_LONG: "support_too_long",
      ORDER_NOT_FOUND: "generic_error",
    };
    await ctx.reply(t(ctx.locale, key[err.supportCode]));
  }
}

export function registerSupportHandlers(bot: Bot<StoreContext>) {
  bot.command(["support", "suporte"], showSupport);

  bot.callbackQuery("sup:pre", async (ctx) => {
    await ctx.answerCallbackQuery();
    await setBotState(ctx.user.id, { await: "support_message", type: "PRE_SALE" } satisfies SupportState);
    await ctx.reply(ctx.tr("support_write"));
  });

  bot.callbackQuery("sup:post", async (ctx) => {
    await ctx.answerCallbackQuery();
    const orders = await listUserOrders(ctx.user.id, 10);
    if (!orders.length) {
      return ctx.reply(ctx.tr("support_no_orders"), { reply_markup: new InlineKeyboard().text(ctx.tr("support_pre"), "sup:pre") });
    }
    const kb = new InlineKeyboard();
    for (const o of orders) {
      kb.text(t(ctx.locale, "order_button", { number: o.number, product: o.productName.slice(0, 24), status: t(ctx.locale, `status_${o.status}` as MessageKey) }), `sup:o:${o.id}`).row();
    }
    await ctx.reply(ctx.tr("support_choose_order"), { reply_markup: kb });
  });

  bot.callbackQuery(/^sup:o:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const found = await getUserOrder(ctx.user.id, ctx.match[1]!);
    if (!found) return showSupport(ctx);
    await setBotState(ctx.user.id, { await: "support_message", type: "POST_SALE", orderId: found.order.id } satisfies SupportState);
    await ctx.reply(ctx.tr("support_write_order", { number: found.order.number }), { parse_mode: "HTML" });
  });

  bot.callbackQuery("sup:write", async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await getOpenTicket(ctx.user.id))) return showSupport(ctx);
    await setBotState(ctx.user.id, { await: "support_message" } satisfies SupportState);
    await ctx.reply(ctx.tr("support_write"));
  });

  bot.callbackQuery(/^sup:close:(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const number = await closeByCustomer(ctx.user.id, ctx.match[1]!);
    await setBotState(ctx.user.id, null);
    if (number !== null) await ctx.reply(ctx.tr("support_closed", { number }));
  });
}
