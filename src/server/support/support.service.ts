import { InlineKeyboard } from "grammy";
import type { Prisma, User } from "@/generated/prisma/client";
import type { TicketStatus, TicketType } from "@/generated/prisma/enums";
import { db } from "@/server/common/db";
import { env } from "@/server/config/env";
import { AppError, Errors, isUniqueViolation } from "@/server/common/errors";
import { logger } from "@/server/common/logger";
import { rateLimit } from "@/server/common/rate-limit";
import { escapeHtml, t } from "@/i18n";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { alertAdmins, sendHtml, telegramApi } from "@/server/notifications/telegram";

export const MAX_MESSAGE_LENGTH = 3500;

export class SupportError extends AppError {
  constructor(public readonly supportCode: "RATE_LIMITED" | "EMPTY" | "TOO_LONG" | "ORDER_NOT_FOUND" | "NO_OPEN_TICKET") {
    super(`SUPPORT_${supportCode}`, supportCode, 400);
  }
}

function cleanText(text: string | undefined | null, hasPhoto: boolean): string {
  const value = (text ?? "").trim();
  if (!value && !hasPhoto) throw new SupportError("EMPTY");
  if (value.length > MAX_MESSAGE_LENGTH) throw new SupportError("TOO_LONG");
  return value;
}

export async function getOpenTicket(userId: string) {
  return db().supportTicket.findFirst({ where: { userId, status: { not: "CLOSED" } }, include: { order: { select: { number: true } } } });
}

async function notifyTeam(ticket: { id: string; number: number; type: TicketType }, user: Pick<User, "username" | "firstName" | "telegramId">, text: string, isNew: boolean, hasPhoto: boolean) {
  const who = user.username ? `@${user.username}` : (user.firstName ?? user.telegramId.toString());
  const kind = ticket.type === "PRE_SALE" ? "pré-compra" : "pós-compra";
  const preview = text ? escapeHtml(text.slice(0, 300)) : "";
  await alertAdmins(
    `💬 ${isNew ? "Novo ticket" : "Nova mensagem no ticket"} <b>#${ticket.number}</b> (${kind}) de ${escapeHtml(who)}${hasPhoto ? " 📎 imagem" : ""}\n\n${preview}\n\n${env().APP_URL}/support/${ticket.id}`,
  );
}

/**
 * Customer message from the bot. Opens a ticket (pre- or post-sale) or appends to the customer's open one.
 * A partial unique index guarantees at most one open ticket per customer, even under concurrency.
 */
export async function submitCustomerMessage(
  user: User,
  input: { type?: TicketType; orderId?: string | null; text?: string | null; telegramFileId?: string | null },
): Promise<{ ticketId: string; number: number; created: boolean }> {
  if (!(await rateLimit(`support:${user.id}`, 20, 600))) throw new SupportError("RATE_LIMITED");
  const text = cleanText(input.text, Boolean(input.telegramFileId));

  let ticket = await getOpenTicket(user.id);
  let created = false;
  if (!ticket) {
    if (!input.type) throw new SupportError("NO_OPEN_TICKET");
    if (input.orderId) {
      const order = await db().order.findFirst({ where: { id: input.orderId, userId: user.id }, select: { id: true } });
      if (!order) throw new SupportError("ORDER_NOT_FOUND");
    }
    try {
      ticket = await db().supportTicket.create({
        data: { userId: user.id, type: input.type, orderId: input.orderId ?? null },
        include: { order: { select: { number: true } } },
      });
      created = true;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      ticket = await getOpenTicket(user.id); // created concurrently
      if (!ticket) throw err;
    }
  }

  await db().$transaction([
    db().supportMessage.create({ data: { ticketId: ticket.id, author: "CUSTOMER", text, telegramFileId: input.telegramFileId ?? null } }),
    db().supportTicket.update({ where: { id: ticket.id }, data: { status: "OPEN", lastMessageAt: new Date() } }),
  ]);
  await notifyTeam(ticket, user, text, created, Boolean(input.telegramFileId)).catch((err) => logger.warn("support.notify_failed", { err }));
  return { ticketId: ticket.id, number: ticket.number, created };
}

export async function closeByCustomer(userId: string, ticketId: string): Promise<number | null> {
  const ticket = await db().supportTicket.findFirst({ where: { id: ticketId, userId, status: { not: "CLOSED" } } });
  if (!ticket) return null;
  await db().supportTicket.update({ where: { id: ticket.id }, data: { status: "CLOSED", closedAt: new Date() } });
  return ticket.number;
}

// ───────────────────────── Admin ─────────────────────────

export async function listTickets(f: { status?: TicketStatus; type?: TicketType; q?: string; page: number; pageSize: number }) {
  const where: Prisma.SupportTicketWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.type ? { type: f.type } : {}),
  };
  if (f.q) {
    const q = f.q.trim().replace(/^#/, "");
    where.OR = [
      ...(/^\d{1,9}$/.test(q) ? [{ number: Number(q) }, { order: { number: Number(q) } }] : []),
      ...(/^\d{5,20}$/.test(q) ? [{ user: { telegramId: BigInt(q) } }] : []),
      { user: { username: { contains: q.replace(/^@/, ""), mode: "insensitive" } } },
      { messages: { some: { text: { contains: q, mode: "insensitive" } } } },
    ];
  }
  const [total, items, counts] = await Promise.all([
    db().supportTicket.count({ where }),
    db().supportTicket.findMany({
      where,
      // Waiting for us first, then most recent activity.
      orderBy: [{ status: "asc" }, { lastMessageAt: "desc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        user: { select: { id: true, telegramId: true, username: true, firstName: true, locale: true } },
        order: { select: { id: true, number: true, productName: true, status: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { text: true, author: true, createdAt: true, telegramFileId: true } },
        _count: { select: { messages: true } },
      },
    }),
    db().supportTicket.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return {
    total,
    page: f.page,
    pageSize: f.pageSize,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<Record<TicketStatus, number>>,
    items: items.map(({ messages, _count, ...tk }) => ({ ...tk, lastMessage: messages[0] ?? null, messageCount: _count.messages })),
  };
}

export async function getTicket(id: string) {
  const ticket = await db().supportTicket.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, telegramId: true, username: true, firstName: true, locale: true, country: true, balanceCents: true, createdAt: true } },
      order: { select: { id: true, number: true, productName: true, status: true, amountCents: true, currency: true, paymentMethod: true, createdAt: true, deliveredAt: true } },
      messages: { orderBy: { createdAt: "asc" }, include: { admin: { select: { name: true, email: true } } } },
    },
  });
  if (!ticket) throw Errors.notFound("Ticket");
  const recentOrders = await db().order.findMany({
    where: { userId: ticket.userId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, number: true, productName: true, status: true, amountCents: true, currency: true, createdAt: true },
  });
  return {
    ...ticket,
    messages: ticket.messages.map(({ telegramFileId, ...m }) => ({ ...m, hasImage: Boolean(telegramFileId) })),
    recentOrders,
  };
}

/** Support reply: stored, then delivered to the customer in the bot (in their language). */
export async function replyToTicket(ticketId: string, adminId: string, rawText: string, ip: string | null) {
  const text = cleanText(rawText, false);
  const ticket = await db().supportTicket.findUnique({ where: { id: ticketId }, include: { user: true } });
  if (!ticket) throw Errors.notFound("Ticket");
  await db().$transaction([
    db().supportMessage.create({ data: { ticketId, author: "SUPPORT", adminId, text } }),
    db().supportTicket.update({ where: { id: ticketId }, data: { status: "ANSWERED", closedAt: null, lastMessageAt: new Date() } }),
  ]);
  await audit({ actorType: "ADMIN", adminId, ip, action: AuditActions.SUPPORT_REPLIED, resourceType: "support_ticket", resourceId: ticketId, details: { number: ticket.number } });

  const locale = ticket.user.locale ?? "en_US";
  const kb = new InlineKeyboard().text(t(locale, "support_reply_button"), "sup:write").row().text(t(locale, "support_close_button"), `sup:close:${ticketId}`);
  try {
    await sendHtml(ticket.user.telegramId, t(locale, "support_reply", { number: ticket.number, text }), kb);
    return { delivered: true };
  } catch (err) {
    // e.g. the customer blocked the bot; the reply stays in the ticket history.
    logger.warn("support.reply_delivery_failed", { err, ticketId });
    return { delivered: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function setTicketStatus(ticketId: string, status: "OPEN" | "CLOSED", adminId: string, ip: string | null) {
  const ticket = await db().supportTicket.findUnique({ where: { id: ticketId }, include: { user: true } });
  if (!ticket) throw Errors.notFound("Ticket");
  try {
    await db().supportTicket.update({ where: { id: ticketId }, data: { status, closedAt: status === "CLOSED" ? new Date() : null } });
  } catch (err) {
    if (isUniqueViolation(err)) throw Errors.conflict("O cliente já tem outro ticket aberto");
    throw err;
  }
  await audit({ actorType: "ADMIN", adminId, ip, action: AuditActions.SUPPORT_STATUS_CHANGED, resourceType: "support_ticket", resourceId: ticketId, details: { status } });
  if (status === "CLOSED" && ticket.status !== "CLOSED") {
    await sendHtml(ticket.user.telegramId, t(ticket.user.locale ?? "en_US", "support_closed_by_team", { number: ticket.number })).catch(() => undefined);
  }
}

/** Downloads a customer screenshot from Telegram (the bot token never reaches the browser). */
export async function fetchMessageImage(messageId: string): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  const msg = await db().supportMessage.findUnique({ where: { id: messageId }, select: { telegramFileId: true } });
  if (!msg?.telegramFileId) return null;
  const file = await telegramApi().getFile(msg.telegramFileId);
  if (!file.file_path) return null;
  const res = await fetch(`https://api.telegram.org/file/bot${env().TELEGRAM_BOT_TOKEN}/${file.file_path}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;
  const ext = file.file_path.split(".").pop()?.toLowerCase();
  const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return { body: await res.arrayBuffer(), contentType };
}

export async function openTicketsCount(): Promise<number> {
  return db().supportTicket.count({ where: { status: "OPEN" } });
}
