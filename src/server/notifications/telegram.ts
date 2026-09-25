import { Api, InputFile } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import { env } from "@/server/config/env";
import { logger } from "@/server/common/logger";

let api: Api | undefined;

/** Telegram Bot API client for outbound messages (the token never leaves the server). */
export function telegramApi(): Api {
  if (!api) api = new Api(env().TELEGRAM_BOT_TOKEN);
  return api;
}

export async function sendHtml(chatId: bigint | number | string, html: string, replyMarkup?: InlineKeyboardMarkup): Promise<void> {
  await telegramApi().sendMessage(String(chatId), html, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export async function sendPhotoBase64(chatId: bigint | number | string, base64: string, captionHtml: string, replyMarkup?: InlineKeyboardMarkup): Promise<void> {
  await telegramApi().sendPhoto(String(chatId), new InputFile(Buffer.from(base64, "base64"), "pix.png"), {
    caption: captionHtml,
    parse_mode: "HTML",
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

/** Operational alerts to the store owner (low stock, delivery failures...). Never throws. */
export async function alertAdmins(html: string): Promise<void> {
  const ids = env().ADMIN_ALERT_CHAT_IDS.split(",").map((s) => s.trim()).filter(Boolean);
  await Promise.all(
    ids.map((id) =>
      sendHtml(id, html).catch((err) => logger.warn("telegram.admin_alert_failed", { err, chatId: id })),
    ),
  );
}
