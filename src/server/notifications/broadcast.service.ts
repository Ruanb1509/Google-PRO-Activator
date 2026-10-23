import { GrammyError, InputFile } from "grammy";
import type { Locale } from "@/generated/prisma/enums";
import { DEFAULT_LOCALE, escapeHtml } from "@/i18n";
import { db } from "@/server/common/db";
import { AppError, Errors } from "@/server/common/errors";
import { CAPTION_LIMIT, type UploadedImage } from "@/server/common/image-upload";
import { logger } from "@/server/common/logger";
import { rateLimit } from "@/server/common/rate-limit";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { alertAdmins, sendHtml, telegramApi } from "@/server/notifications/telegram";

export const MAX_BROADCAST_LENGTH = 3500;
/** Telegram allows ~30 messages/second per bot; stay well below it. */
const SEND_GAP_MS = 50;
/** Stop before the function's 300 s limit and report how far it got. */
const TIME_BUDGET_MS = 270_000;

export interface BroadcastInput {
  /** Sent to customers in Portuguese — and to everyone when there is no English text. */
  textPt: string;
  textEn?: string;
  image?: UploadedImage;
}

/** Customers who can receive the message (the bot only knows users who started it). */
function recipientsWhere() {
  return { isBlocked: false };
}

export async function broadcastPreview() {
  const [recipients, english] = await Promise.all([
    db().user.count({ where: recipientsWhere() }),
    db().user.count({ where: { ...recipientsWhere(), OR: [{ locale: "en_US" }, { locale: null, NOT: { languageCode: { startsWith: "pt" } } }] } }),
  ]);
  return { recipients, english, portuguese: recipients - english };
}

/**
 * General announcement to every customer in the bot. Starts the sending and returns right away;
 * admins get a summary alert at the end. Once every 5 minutes, so a double click never messages
 * customers twice.
 */
export async function startBroadcast(input: BroadcastInput, actor: { adminId: string; ip: string | null }): Promise<{ recipients: number; run: () => Promise<void> }> {
  const textPt = input.textPt.trim();
  const textEn = input.textEn?.trim() || undefined;
  if (!textPt) throw Errors.badRequest("Escreva a mensagem do aviso");
  if (!(await rateLimit("broadcast:general", 1, 5 * 60))) {
    throw new AppError("RATE_LIMITED", "Um aviso geral foi enviado há pouco. Aguarde 5 minutos para enviar outro.", 429);
  }
  const recipients = await db().user.count({ where: recipientsWhere() });
  await audit({
    actorType: "ADMIN",
    adminId: actor.adminId,
    ip: actor.ip,
    action: AuditActions.BROADCAST_SENT,
    resourceType: "broadcast",
    details: { recipients, text: textPt.slice(0, 500), english: Boolean(textEn), image: Boolean(input.image) },
  });
  return { recipients, run: () => sendBroadcast({ textPt, textEn, image: input.image }) };
}

async function sendBroadcast({ textPt, textEn, image }: BroadcastInput): Promise<void> {
  const started = Date.now();
  const htmlFor = (locale: Locale) => escapeHtml(locale === "en_US" && textEn ? textEn : textPt);
  // The photo is uploaded once; every following customer gets Telegram's file_id.
  let photo: string | undefined;
  let sent = 0;
  let failed = 0;
  let total = 0;
  let cursor: string | undefined;
  let timedOut = false;

  const deliver = async (chatId: string, html: string) => {
    if (!image) return sendHtml(chatId, html);
    const fitsCaption = html.length <= CAPTION_LIMIT;
    const msg = await telegramApi().sendPhoto(chatId, photo ?? new InputFile(image.data, `aviso.${image.contentType.split("/")[1]}`), fitsCaption ? { caption: html, parse_mode: "HTML" } : {});
    photo ??= msg.photo.at(-1)?.file_id;
    if (!fitsCaption) await sendHtml(chatId, html);
  };

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
      try {
        await deliver(String(user.telegramId), htmlFor(locale));
        sent++;
      } catch (err) {
        failed++;
        // 403 = the customer blocked the bot; not worth logging one by one.
        if (!(err instanceof GrammyError && (err.error_code === 403 || err.error_code === 400))) logger.warn("broadcast.send_failed", { err, userId: user.id });
      }
      await new Promise((r) => setTimeout(r, SEND_GAP_MS));
    }
    cursor = users.at(-1)!.id;
  }

  logger.info("broadcast.done", { sent, failed, timedOut });
  await alertAdmins(
    `📢 Aviso geral enviado para <b>${sent}</b> cliente(s)` +
      (failed ? ` · ${failed} não receberam (bloquearam o bot)` : "") +
      (timedOut ? `\n⚠️ Tempo esgotado após ${total} clientes — parte da lista não recebeu.` : ""),
  );
}
