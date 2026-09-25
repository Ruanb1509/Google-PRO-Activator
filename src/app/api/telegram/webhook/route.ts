import { after, type NextRequest } from "next/server";
import { webhookCallback } from "grammy";
import { getBot } from "@/server/bot/bot";
import { env } from "@/server/config/env";
import { logger } from "@/server/common/logger";
import { safeEqual } from "@/server/common/crypto";
import { maybeRunMaintenance } from "@/server/admin/maintenance.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

let handler: ((req: Request) => Promise<Response>) | undefined;

/**
 * Telegram -> bot updates. Telegram signs nothing, so we require the secret token configured via
 * setWebhook (header X-Telegram-Bot-Api-Secret-Token); grammY rejects requests without it.
 */
export async function POST(req: NextRequest) {
  // Checked here explicitly (before grammY initialises the bot) so forged requests never reach it.
  const given = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqual(given, env().TELEGRAM_WEBHOOK_SECRET)) {
    logger.warn("telegram.webhook_rejected", { ip: req.headers.get("x-forwarded-for") });
    return new Response("unauthorized", { status: 401 });
  }
  handler ??= webhookCallback(getBot(), "std/http", {
    secretToken: env().TELEGRAM_WEBHOOK_SECRET,
    onTimeout: "return",
    timeoutMilliseconds: 50_000,
  });
  after(() => maybeRunMaintenance());
  try {
    return await handler(req);
  } catch (err) {
    logger.error("telegram.webhook_failed", { err });
    // 200 avoids Telegram retrying the same update forever; the error is logged.
    return new Response("ok", { status: 200 });
  }
}
