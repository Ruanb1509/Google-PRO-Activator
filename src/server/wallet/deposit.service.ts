import { randomInt } from "node:crypto";
import type { Prisma, User } from "@/generated/prisma/client";
import type { DepositStatus } from "@/generated/prisma/enums";
import { db } from "@/server/common/db";
import { AppError, Errors, isUniqueViolation } from "@/server/common/errors";
import { logger } from "@/server/common/logger";
import { rateLimit } from "@/server/common/rate-limit";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { getSettings } from "@/server/settings/settings.service";
import { moveBalance } from "@/server/wallet/ledger.service";
import { BinanceApiError, binanceConfigured, decimalToCents, findPayTransaction } from "@/server/wallet/binance-pay.client";

export type DepositErrorCode =
  | "DISABLED"
  | "INVALID_AMOUNT"
  | "RATE_LIMITED"
  | "TX_INVALID"
  | "TX_USED"
  | "NO_PENDING"
  | "TOO_MANY_ATTEMPTS"
  | "TX_NOT_FOUND"
  | "TX_MISMATCH"
  | "UNAVAILABLE";

export class DepositError extends AppError {
  constructor(public readonly depositCode: DepositErrorCode, message: string = depositCode) {
    super(`DEPOSIT_${depositCode}`, message, 400);
  }
}

const TX_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_ATTEMPTS = 10;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
/** A user may send the tx id some time after the deposit window closed (payment made in time). */
const LATE_CLAIM_MS = 24 * 60 * 60 * 1000;

export async function binancePayAvailable(): Promise<boolean> {
  const s = await getSettings();
  return s.binancePay.enabled && binanceConfigured();
}

/**
 * Starts a top-up. With `requireExactAmount`, a random cents offset is added so that the amount itself
 * identifies the depositor: somebody who learns another user's transaction id cannot claim it,
 * because it will not match the exact amount of *their* pending deposit.
 */
export async function createDeposit(user: User, requestedCents: number) {
  const settings = (await getSettings()).binancePay;
  if (!settings.enabled || !binanceConfigured()) throw new DepositError("DISABLED");
  if (!Number.isInteger(requestedCents) || requestedCents < settings.minDepositCents || requestedCents > settings.maxDepositCents) {
    throw new DepositError("INVALID_AMOUNT");
  }
  if (!(await rateLimit(`deposit:create:${user.id}`, 6, 3600))) throw new DepositError("RATE_LIMITED");

  // Only one open deposit per user.
  await db().deposit.updateMany({ where: { userId: user.id, status: "PENDING" }, data: { status: "EXPIRED" } });

  let expectedCents = requestedCents;
  if (settings.requireExactAmount) {
    const base = requestedCents - (requestedCents % 100); // whole units + unique cents
    const taken = new Set(
      (
        await db().deposit.findMany({
          where: { status: "PENDING", expiresAt: { gt: new Date(Date.now() - LATE_CLAIM_MS) }, expectedCents: { gte: base, lt: base + 100 } },
          select: { expectedCents: true },
        })
      ).map((d) => d.expectedCents),
    );
    const free = Array.from({ length: 99 }, (_, i) => base + i + 1).filter((c) => !taken.has(c));
    if (!free.length) throw new DepositError("UNAVAILABLE", "No unique amount available, try another value");
    expectedCents = free[randomInt(free.length)]!;
  }

  const deposit = await db().deposit.create({
    data: {
      userId: user.id,
      provider: "binance_pay",
      requestedCents,
      expectedCents,
      asset: settings.asset,
      expiresAt: new Date(Date.now() + settings.depositTtlMinutes * 60 * 1000),
    },
  });
  return deposit;
}

export async function cancelDeposit(userId: string, depositId: string): Promise<boolean> {
  const r = await db().deposit.updateMany({ where: { id: depositId, userId, status: "PENDING" }, data: { status: "EXPIRED" } });
  return r.count > 0;
}

/**
 * Verifies a Binance Pay transaction id sent by the customer against the store's own Binance account
 * and credits the balance. The id alone proves nothing: the transaction must exist in OUR history,
 * be incoming, in the right asset, inside the deposit window, match the exact amount and never have
 * been claimed before (unique constraint on provider_tx_id).
 */
export async function verifyDeposit(user: User, rawTxId: string): Promise<{ creditedCents: number; balanceAfterCents: number; asset: string }> {
  const settings = (await getSettings()).binancePay;
  if (!settings.enabled || !binanceConfigured()) throw new DepositError("DISABLED");
  if (!(await rateLimit(`deposit:verify:${user.id}`, 6, 600))) throw new DepositError("RATE_LIMITED");

  const txId = rawTxId.trim();
  if (!TX_ID_RE.test(txId)) throw new DepositError("TX_INVALID");
  if (await db().deposit.findUnique({ where: { providerTxId: txId } })) throw new DepositError("TX_USED");

  const deposit = await db().deposit.findFirst({
    where: { userId: user.id, status: "PENDING", expiresAt: { gt: new Date(Date.now() - LATE_CLAIM_MS) } },
    orderBy: { createdAt: "desc" },
  });
  if (!deposit) throw new DepositError("NO_PENDING");

  const { attempts } = await db().deposit.update({ where: { id: deposit.id }, data: { attempts: { increment: 1 } } });
  if (attempts > MAX_ATTEMPTS) {
    await db().deposit.update({ where: { id: deposit.id }, data: { status: "REJECTED" } });
    await audit({ actorType: "BOT", action: AuditActions.DEPOSIT_REJECTED, resourceType: "deposit", resourceId: deposit.id, details: { reason: "too_many_attempts" } });
    throw new DepositError("TOO_MANY_ATTEMPTS");
  }

  const windowStart = deposit.createdAt.getTime() - CLOCK_SKEW_MS;
  const windowEnd = Math.min(Date.now(), deposit.expiresAt.getTime() + CLOCK_SKEW_MS);

  let tx;
  try {
    tx = await findPayTransaction(txId, { startTime: windowStart, endTime: windowEnd });
  } catch (err) {
    logger.error("deposit.binance_error", { err, depositId: deposit.id });
    throw new DepositError("UNAVAILABLE", err instanceof BinanceApiError ? err.message : "Binance unavailable");
  }
  if (!tx) throw new DepositError("TX_NOT_FOUND");

  const cents = decimalToCents(tx.amount);
  const currencies = new Set([tx.currency, ...(tx.fundsDetail ?? []).map((f) => f.currency)]);
  const checks = {
    incoming: cents !== null && cents > 0,
    asset: currencies.size === 1 && currencies.has(deposit.asset),
    time: tx.transactionTime >= windowStart && tx.transactionTime <= deposit.expiresAt.getTime() + CLOCK_SKEW_MS,
    amount: settings.requireExactAmount ? cents === deposit.expectedCents : cents !== null && cents >= settings.minDepositCents,
  };
  if (!checks.incoming || !checks.asset || !checks.time || !checks.amount) {
    logger.warn("deposit.mismatch", { depositId: deposit.id, checks, txId });
    throw new DepositError("TX_MISMATCH");
  }

  const credited = cents!;
  try {
    const result = await db().$transaction(async (dbTx) => {
      const upd = await dbTx.deposit.updateMany({
        where: { id: deposit.id, status: "PENDING" },
        data: {
          status: "CONFIRMED",
          providerTxId: String(tx.transactionId),
          creditedCents: credited,
          payerId: tx.payerInfo?.binanceId != null ? String(tx.payerInfo.binanceId) : null,
          rawTransaction: tx as unknown as Prisma.InputJsonValue,
          confirmedAt: new Date(),
        },
      });
      if (upd.count === 0) throw new DepositError("NO_PENDING");
      const moved = await moveBalance(dbTx, { userId: user.id, amountCents: credited, type: "DEPOSIT", depositId: deposit.id, note: `Binance Pay ${tx.transactionId}` });
      await audit({ actorType: "BOT", action: AuditActions.DEPOSIT_CONFIRMED, resourceType: "deposit", resourceId: deposit.id, details: { txId: String(tx.transactionId), typed: txId, credited, asset: deposit.asset, userId: user.id } }, dbTx);
      return moved;
    });
    return { creditedCents: credited, balanceAfterCents: result.balanceAfterCents, asset: deposit.asset };
  } catch (err) {
    if (isUniqueViolation(err)) throw new DepositError("TX_USED");
    throw err;
  }
}

// Deposits are always keyed by Binance's own transactionId, never by the id the customer typed:
// the lookup also matches a transfer's orderId, so keying by the typed string would let the same
// transfer be claimed twice (once per identifier).

/**
 * Open-amount top-up (default mode): the customer sends ANY amount to the store's Binance Pay ID and
 * then the transaction id. The amount is read from the store's own Binance history and credited.
 * Guarantees: the transaction must exist in OUR account, be incoming, be in an accepted USD stablecoin,
 * be recent (claim window) and can be claimed only once, by anyone (unique provider_tx_id).
 */
export async function claimTransaction(user: User, rawTxId: string): Promise<{ creditedCents: number; balanceAfterCents: number; asset: string }> {
  const settings = (await getSettings()).binancePay;
  if (!settings.enabled || !binanceConfigured()) throw new DepositError("DISABLED");
  if (settings.requireExactAmount) return verifyDeposit(user, rawTxId);
  if (!(await rateLimit(`deposit:verify:${user.id}`, 6, 600))) throw new DepositError("RATE_LIMITED");

  const txId = rawTxId.trim();
  if (!TX_ID_RE.test(txId)) throw new DepositError("TX_INVALID");
  if (await db().deposit.findUnique({ where: { providerTxId: txId } })) throw new DepositError("TX_USED");

  const now = Date.now();
  let tx;
  try {
    tx = await findPayTransaction(txId, { startTime: now - settings.claimWindowHours * 60 * 60 * 1000, endTime: now });
  } catch (err) {
    logger.error("deposit.binance_error", { err, userId: user.id });
    throw new DepositError("UNAVAILABLE", err instanceof BinanceApiError ? err.message : "Binance unavailable");
  }
  if (!tx) throw new DepositError("TX_NOT_FOUND");

  const cents = decimalToCents(tx.amount);
  const incoming = cents !== null && cents > 0;
  const assetOk = settings.acceptedAssets.includes(tx.currency);
  if (!incoming || !assetOk) {
    logger.warn("deposit.claim_rejected", { userId: user.id, txId, incoming, asset: tx.currency });
    throw new DepositError("TX_MISMATCH");
  }

  const credited = cents!;
  try {
    return await db().$transaction(async (dbTx) => {
      const deposit = await dbTx.deposit.create({
        data: {
          userId: user.id,
          provider: "binance_pay",
          status: "CONFIRMED",
          requestedCents: credited,
          expectedCents: credited,
          creditedCents: credited,
          asset: tx.currency,
          providerTxId: String(tx.transactionId),
          payerId: tx.payerInfo?.binanceId != null ? String(tx.payerInfo.binanceId) : null,
          rawTransaction: tx as unknown as Prisma.InputJsonValue,
          attempts: 1,
          expiresAt: new Date(),
          confirmedAt: new Date(),
        },
      });
      const moved = await moveBalance(dbTx, { userId: user.id, amountCents: credited, type: "DEPOSIT", depositId: deposit.id, note: `Binance Pay ${tx.transactionId}` });
      await audit({ actorType: "BOT", action: AuditActions.DEPOSIT_CONFIRMED, resourceType: "deposit", resourceId: deposit.id, details: { txId: String(tx.transactionId), typed: txId, credited, asset: tx.currency, userId: user.id, mode: "open_amount" } }, dbTx);
      return { creditedCents: credited, balanceAfterCents: moved.balanceAfterCents, asset: tx.currency };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DepositError("TX_USED");
    throw err;
  }
}

export async function expireDeposits(): Promise<number> {
  const r = await db().deposit.updateMany({
    where: { status: "PENDING", expiresAt: { lt: new Date(Date.now() - LATE_CLAIM_MS) } },
    data: { status: "EXPIRED" },
  });
  return r.count;
}

// ───────────────────────── Admin ─────────────────────────

export async function listDeposits(f: { status?: DepositStatus; userId?: string; page: number; pageSize: number }) {
  const where: Prisma.DepositWhereInput = { ...(f.status ? { status: f.status } : {}), ...(f.userId ? { userId: f.userId } : {}) };
  const [total, items] = await Promise.all([
    db().deposit.count({ where }),
    db().deposit.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      omit: { rawTransaction: true },
      include: { user: { select: { id: true, telegramId: true, username: true, firstName: true } } },
    }),
  ]);
  return { total, page: f.page, pageSize: f.pageSize, items };
}

/** Manual credit/debit by an ADMIN (e.g. support compensation). Always audited, never negative. */
export async function adjustBalance(userId: string, amountCents: number, note: string, adminId: string, ip: string | null) {
  if (!Number.isInteger(amountCents) || amountCents === 0) throw Errors.badRequest("Valor inválido");
  const res = await db().$transaction((tx) => moveBalance(tx, { userId, amountCents, type: "ADJUSTMENT", adminId, note }));
  await audit({ actorType: "ADMIN", adminId, ip, action: AuditActions.BALANCE_ADJUSTED, resourceType: "user", resourceId: userId, details: { amountCents, note } });
  return res;
}
