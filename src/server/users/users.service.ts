import { Prisma, type User } from "@/generated/prisma/client";
import type { Locale } from "@/generated/prisma/enums";
import { db } from "@/server/common/db";
import { Errors } from "@/server/common/errors";

export interface TelegramProfile {
  id: number;
  username?: string;
  first_name?: string;
  language_code?: string;
}

/** Creates or refreshes a customer from a Telegram update (only minimal profile data is kept). */
export async function upsertTelegramUser(from: TelegramProfile): Promise<User> {
  const data = {
    username: from.username?.slice(0, 64) ?? null,
    firstName: from.first_name?.slice(0, 64) ?? null,
    languageCode: from.language_code?.slice(0, 16) ?? null,
    lastSeenAt: new Date(),
  };
  return db().user.upsert({
    where: { telegramId: BigInt(from.id) },
    create: { telegramId: BigInt(from.id), ...data },
    update: data,
  });
}

export async function setLocale(userId: string, locale: Locale): Promise<User> {
  return db().user.update({ where: { id: userId }, data: { locale } });
}

export async function setBotState(userId: string, state: Prisma.InputJsonValue | null): Promise<void> {
  await db().user.update({ where: { id: userId }, data: { botState: state === null ? Prisma.DbNull : state } });
}

export interface CustomerListFilters {
  q?: string;
  page: number;
  pageSize: number;
}

export async function listCustomers(f: CustomerListFilters) {
  const where: Prisma.UserWhereInput = {};
  if (f.q) {
    const q = f.q.trim();
    where.OR = [
      { username: { contains: q.replace(/^@/, ""), mode: "insensitive" } },
      { firstName: { contains: q, mode: "insensitive" } },
      ...(/^\d{1,20}$/.test(q) ? [{ telegramId: BigInt(q) }] : []),
    ];
  }
  const [total, users] = await Promise.all([
    db().user.count({ where }),
    db().user.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
  ]);
  const ids = users.map((u) => u.id);
  const stats = ids.length
    ? await db().order.groupBy({
        by: ["userId", "currency"],
        where: { userId: { in: ids }, status: { in: ["PAID", "DELIVERED"] } },
        _count: { _all: true },
        _sum: { amountCents: true },
      })
    : [];
  const items = users.map((u) => {
    const mine = stats.filter((s) => s.userId === u.id);
    return {
      ...u,
      purchases: mine.reduce((n, s) => n + s._count._all, 0),
      spentBrlCents: mine.find((s) => s.currency === "BRL")?._sum.amountCents ?? 0,
      spentUsdCents: mine.find((s) => s.currency === "USD")?._sum.amountCents ?? 0,
    };
  });
  return { total, page: f.page, pageSize: f.pageSize, items };
}

export async function getCustomer(id: string) {
  const user = await db().user.findUnique({
    where: { id },
    include: {
      orders: { orderBy: { createdAt: "desc" }, take: 50 },
      deposits: { orderBy: { createdAt: "desc" }, take: 50 },
      ledger: { orderBy: { createdAt: "desc" }, take: 50 },
    },
  });
  if (!user) throw Errors.notFound("Customer");
  return user;
}

export async function setBlocked(id: string, isBlocked: boolean) {
  return db().user.update({ where: { id }, data: { isBlocked } });
}
