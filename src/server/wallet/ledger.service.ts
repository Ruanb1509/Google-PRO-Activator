import type { LedgerType } from "@/generated/prisma/enums";
import { db, type Tx } from "@/server/common/db";
import { AppError, isUniqueViolation } from "@/server/common/errors";

export class InsufficientBalanceError extends AppError {
  constructor(public readonly balanceCents: number) {
    super("INSUFFICIENT_BALANCE", "Insufficient balance", 409);
  }
}

/**
 * Atomic balance movement + append-only ledger entry.
 * - Debits use a conditional UPDATE (balance >= amount) so concurrent purchases can't overdraw.
 * - (order_id, type) and deposit_id are unique, so the same purchase/refund/deposit is applied once.
 */
export async function moveBalance(
  tx: Tx,
  args: { userId: string; amountCents: number; type: LedgerType; orderId?: string; depositId?: string; adminId?: string; note?: string },
): Promise<{ balanceAfterCents: number }> {
  if (!Number.isInteger(args.amountCents) || args.amountCents === 0) throw new AppError("INVALID_AMOUNT", "Invalid amount");
  const rows = await tx.$queryRaw<{ balance_cents: number }[]>`
    UPDATE users SET balance_cents = balance_cents + ${args.amountCents}
    WHERE id = ${args.userId} AND balance_cents + ${args.amountCents} >= 0
    RETURNING balance_cents`;
  if (!rows[0]) {
    const u = await tx.user.findUnique({ where: { id: args.userId }, select: { balanceCents: true } });
    throw new InsufficientBalanceError(u?.balanceCents ?? 0);
  }
  await tx.balanceTransaction.create({
    data: {
      userId: args.userId,
      type: args.type,
      amountCents: args.amountCents,
      balanceAfterCents: rows[0].balance_cents,
      orderId: args.orderId,
      depositId: args.depositId,
      adminId: args.adminId,
      note: args.note?.slice(0, 500),
    },
  });
  return { balanceAfterCents: rows[0].balance_cents };
}

/** Runs moveBalance in its own transaction; returns null if this exact movement was already applied. */
export async function moveBalanceOnce(args: Parameters<typeof moveBalance>[1]): Promise<{ balanceAfterCents: number } | null> {
  try {
    return await db().$transaction((tx) => moveBalance(tx, args));
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function hasLedgerEntry(orderId: string, type: LedgerType): Promise<boolean> {
  return (await db().balanceTransaction.count({ where: { orderId, type } })) > 0;
}
