/**
 * End-to-end tests of the transactional core against a REAL PostgreSQL.
 * Run with: TEST_DATABASE_URL=postgresql://... npm run test:integration
 * (the database is migrated first; its data is wiped by these tests!)
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

const sent: { chatId: string; html: string }[] = [];
vi.mock("@/server/notifications/telegram", () => ({
  sendHtml: vi.fn(async (chatId: unknown, html: string) => {
    sent.push({ chatId: String(chatId), html });
  }),
  sendPhotoBase64: vi.fn(async () => undefined),
  alertAdmins: vi.fn(async () => undefined),
  telegramApi: vi.fn(),
}));

const binanceTx = { current: null as null | Record<string, unknown> };
vi.mock("@/server/wallet/binance-pay.client", async (orig) => {
  const real = await orig<typeof import("@/server/wallet/binance-pay.client")>();
  return {
    ...real,
    binanceConfigured: () => true,
    findPayTransaction: vi.fn(async (txId: string) => (binanceTx.current && binanceTx.current.transactionId === txId ? binanceTx.current : null)),
  };
});

const run = Boolean(process.env.TEST_DATABASE_URL);

describe.skipIf(!run)("purchase flow (PostgreSQL)", async () => {
  const { db } = await import("@/server/common/db");
  const { addItems } = await import("@/server/inventory/inventory.service");
  const { createOrder, refundOrder, syncOrderPayment } = await import("@/server/orders/orders.service");
  const { processWebhook } = await import("@/server/webhooks/webhook.service");
  const { MockProvider } = await import("@/server/payments/providers/mock.provider");
  const { saveSettings, DEFAULT_SETTINGS } = await import("@/server/settings/settings.service");
  const { moveBalanceOnce } = await import("@/server/wallet/ledger.service");
  const { createDeposit, verifyDeposit, claimTransaction, DepositError } = await import("@/server/wallet/deposit.service");
  const { runMaintenance } = await import("@/server/admin/maintenance.service");
  const { hashPassword } = await import("@/server/auth/password");

  let adminId = "";
  let productId = "";

  async function user(n: number) {
    return db().user.create({ data: { telegramId: BigInt(9_000_000 + n), firstName: `U${n}`, locale: "pt_BR" } });
  }

  async function mockPay(orderId: string, eventId: string, status: "PAID" | "FAILED" = "PAID") {
    const payment = await db().payment.findUniqueOrThrow({ where: { orderId } });
    await db().payment.update({ where: { id: payment.id }, data: { metadata: { ...((payment.metadata as object) ?? {}), mockStatus: status, mockCountry: "BR" } } });
    const body = JSON.stringify({ eventId, type: `payment.${status.toLowerCase()}`, paymentId: payment.providerPaymentId });
    const req = new Request("http://localhost/api/webhooks/mock", { method: "POST", headers: { "x-mock-signature": MockProvider.sign(body) }, body });
    return processWebhook("mock", req, "127.0.0.1");
  }

  beforeAll(async () => {
    await db().$executeRawUnsafe(
      `TRUNCATE balance_transactions, deposits, payment_events, payments, order_events, inventory_item_events, inventory_items, orders, products, bot_events, users, audit_logs, admin_sessions, admins, settings, rate_limits RESTART IDENTITY CASCADE`,
    );
    adminId = (await db().admin.create({ data: { email: "t@t.dev", name: "T", role: "ADMIN", passwordHash: await hashPassword("Test-Password-123") } })).id;
    await saveSettings(
      {
        ...DEFAULT_SETTINGS,
        paymentMethods: DEFAULT_SETTINGS.paymentMethods.map((m) => (m.key === "mock" ? { ...m, enabled: true } : m)),
        binancePay: { ...DEFAULT_SETTINGS.binancePay, enabled: true },
        maxPendingOrdersPerUser: 5,
      },
      adminId,
    );
    productId = (await db().product.create({ data: { name: "Serviço Digital X", priceBrlCents: 2000, priceUsdCents: 400 } })).id;
  });

  it("adds stock and detects duplicates before inserting", async () => {
    const first = await addItems({ productId, text: "LINK-001\nLINK-002\nLINK-003\nLINK-004\nLINK-005\nLINK-001\nbad\u0002" }, adminId, null);
    expect(first).toMatchObject({ added: 5, duplicates: 1, invalid: 1 });
    const again = await addItems({ productId, text: "LINK-003\nLINK-006" }, adminId, null);
    expect(again).toMatchObject({ added: 1, duplicates: 1, invalid: 0 });
  });

  it("never reserves the same item twice under concurrency (6 items, 20 buyers)", async () => {
    const buyers = await Promise.all(Array.from({ length: 20 }, (_, i) => user(i)));
    const results = await Promise.allSettled(buyers.map((u) => createOrder(u, productId, "mock")));
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(6);
    expect(failed.every((f) => (f.reason as { code?: string }).code === "OUT_OF_STOCK")).toBe(true);
    const reserved = await db().inventoryItem.findMany({ where: { productId, status: "RESERVED" } });
    expect(reserved).toHaveLength(6);
    expect(new Set(reserved.map((r) => r.orderId)).size).toBe(6);
  });

  it("delivers exactly once even with duplicate and concurrent webhooks", async () => {
    const orders = await db().order.findMany({ where: { productId, status: "PENDING" } });
    sent.length = 0;
    await Promise.all(
      orders.flatMap((o) => [mockPay(o.id, `evt-${o.id}`), mockPay(o.id, `evt-${o.id}`), mockPay(o.id, `evt2-${o.id}`)]),
    );
    const after = await db().order.findMany({ where: { id: { in: orders.map((o) => o.id) } }, include: { inventoryItem: true } });
    expect(after.every((o) => o.status === "DELIVERED")).toBe(true);
    const itemIds = after.map((o) => o.inventoryItem?.id);
    expect(new Set(itemIds).size).toBe(orders.length);
    expect(after.every((o) => o.inventoryItem?.status === "SOLD")).toBe(true);
    expect(sent).toHaveLength(orders.length); // one delivery message per order
    expect(sent[0]!.html).toMatch(/LINK-00\d/);
    const events = await db().paymentEvent.count();
    expect(events).toBe(orders.length * 2); // same event id stored once
  });

  it("rejects webhooks with an invalid signature", async () => {
    const req = new Request("http://localhost/api/webhooks/mock", { method: "POST", headers: { "x-mock-signature": "forged" }, body: "{}" });
    const res = await processWebhook("mock", req, "1.2.3.4");
    expect(res.status).toBe(401);
  });

  it("marks a paid order without stock as PAID (not delivered) and alerts", async () => {
    await addItems({ productId, text: "LINK-100" }, adminId, null);
    const u = await user(100);
    const order = await createOrder(u, productId, "mock");
    // Simulate the reserved item being lost (e.g. marked invalid by staff), leaving no stock.
    await db().inventoryItem.updateMany({ where: { orderId: order.orderId }, data: { status: "INVALID", orderId: null, userId: null, reservedUntil: null } });
    await mockPay(order.orderId, "evt-oos");
    const o = await db().order.findUniqueOrThrow({ where: { id: order.orderId }, include: { inventoryItem: true, events: true } });
    expect(o.status).toBe("PAID");
    expect(o.inventoryItem).toBeNull();
    expect(o.events.some((e) => e.type === "OUT_OF_STOCK_AFTER_PAYMENT")).toBe(true);
  });

  it("pays with balance atomically (no overdraft under concurrency)", async () => {
    await addItems({ productId, text: "BAL-1\nBAL-2\nBAL-3" }, adminId, null);
    const u = await user(200);
    await moveBalanceOnce({ userId: u.id, amountCents: 500, type: "ADJUSTMENT", note: "test" }); // enough for 1 x US$4
    const fresh = await db().user.findUniqueOrThrow({ where: { id: u.id } });
    const results = await Promise.allSettled([createOrder(fresh, productId, "balance"), createOrder(fresh, productId, "balance"), createOrder(fresh, productId, "balance")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const after = await db().user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.balanceCents).toBe(100);
    const delivered = await db().order.findMany({ where: { userId: u.id, status: "DELIVERED" } });
    expect(delivered).toHaveLength(1);
    // Unpaid balance orders must not keep stock reserved.
    const stuck = await db().inventoryItem.count({ where: { status: "RESERVED", order: { userId: u.id, status: { not: "PENDING" } } } });
    expect(stuck).toBe(0);

    // Refund returns credit; delivered item stays SOLD.
    await refundOrder(delivered[0]!.id, adminId, null);
    const refunded = await db().order.findUniqueOrThrow({ where: { id: delivered[0]!.id }, include: { inventoryItem: true } });
    expect(refunded.status).toBe("REFUNDED");
    expect(refunded.inventoryItem?.status).toBe("SOLD");
    expect((await db().user.findUniqueOrThrow({ where: { id: u.id } })).balanceCents).toBe(500);
    // Refund is idempotent.
    await expect(refundOrder(delivered[0]!.id, adminId, null)).rejects.toThrow();
    expect((await db().user.findUniqueOrThrow({ where: { id: u.id } })).balanceCents).toBe(500);
  });

  it("credits any amount sent via Binance Pay, read from the API (open-amount mode)", async () => {
    const u = await user(250);
    binanceTx.current = { transactionId: "TX-OPEN-0001", transactionTime: Date.now() - 60_000, amount: "7.53000000", currency: "USDT", orderType: "C2C", payerInfo: { binanceId: 7 } };
    const r = await claimTransaction(u, "TX-OPEN-0001");
    expect(r).toMatchObject({ creditedCents: 753, balanceAfterCents: 753, asset: "USDT" });
    // Single use, for anyone.
    await expect(claimTransaction(u, "TX-OPEN-0001")).rejects.toMatchObject({ depositCode: "TX_USED" });
    await expect(claimTransaction(await user(251), "TX-OPEN-0001")).rejects.toMatchObject({ depositCode: "TX_USED" });
    // Outgoing transfers and non-accepted assets are rejected; unknown ids are not found.
    binanceTx.current = { transactionId: "TX-OUT-0001", transactionTime: Date.now(), amount: "-5.00", currency: "USDT", orderType: "C2C" };
    await expect(claimTransaction(u, "TX-OUT-0001")).rejects.toMatchObject({ depositCode: "TX_MISMATCH" });
    binanceTx.current = { transactionId: "TX-BTC-0001", transactionTime: Date.now(), amount: "0.001", currency: "BTC", orderType: "C2C" };
    await expect(claimTransaction(u, "TX-BTC-0001")).rejects.toMatchObject({ depositCode: "TX_MISMATCH" });
    await expect(claimTransaction(u, "TX-NOPE-0001")).rejects.toMatchObject({ depositCode: "TX_NOT_FOUND" });
    expect((await db().user.findUniqueOrThrow({ where: { id: u.id } })).balanceCents).toBe(753);
    const dep = await db().deposit.findUniqueOrThrow({ where: { providerTxId: "TX-OPEN-0001" } });
    expect(dep).toMatchObject({ status: "CONFIRMED", creditedCents: 753, payerId: "7" });
  });

  it("verifies Binance Pay deposits (exact-amount mode, single use)", async () => {
    const { getSettings } = await import("@/server/settings/settings.service");
    const current = await getSettings();
    await saveSettings({ ...current, binancePay: { ...current.binancePay, requireExactAmount: true } }, adminId);
    const u = await user(300);
    const d = await createDeposit(u, 1000);
    expect(d.expectedCents).toBeGreaterThan(1000);
    expect(d.expectedCents).toBeLessThan(1100);

    binanceTx.current = { transactionId: "TX-WRONG-AMOUNT", transactionTime: Date.now(), amount: "10.00", currency: "USDT", orderType: "C2C" };
    await expect(verifyDeposit(u, "TX-WRONG-AMOUNT")).rejects.toMatchObject({ depositCode: "TX_MISMATCH" });

    const amount = (d.expectedCents / 100).toFixed(2);
    binanceTx.current = { transactionId: "TX-GOOD-0001", transactionTime: Date.now(), amount, currency: "USDT", orderType: "C2C", payerInfo: { binanceId: 42 } };
    const r = await verifyDeposit(u, "TX-GOOD-0001");
    expect(r.creditedCents).toBe(d.expectedCents);
    expect((await db().user.findUniqueOrThrow({ where: { id: u.id } })).balanceCents).toBe(d.expectedCents);

    // Same transaction can never be claimed again (by anyone).
    const other = await user(301);
    await createDeposit(other, 1000);
    await expect(verifyDeposit(other, "TX-GOOD-0001")).rejects.toBeInstanceOf(DepositError);
    await expect(verifyDeposit(u, "TX-GOOD-0001")).rejects.toMatchObject({ depositCode: "TX_USED" });
  });

  it("expires unpaid orders and releases their reservation", async () => {
    await addItems({ productId, text: "EXP-1" }, adminId, null);
    const u = await user(400);
    const o = await createOrder(u, productId, "mock");
    await db().order.update({ where: { id: o.orderId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await db().inventoryItem.updateMany({ where: { orderId: o.orderId }, data: { reservedUntil: new Date(Date.now() - 1000) } });
    await runMaintenance();
    const after = await db().order.findUniqueOrThrow({ where: { id: o.orderId } });
    expect(after.status).toBe("EXPIRED");
    expect(await db().inventoryItem.count({ where: { orderId: o.orderId } })).toBe(0);
    // A late "paid" answer from the provider still ends in a sale (money was taken).
    await mockPay(o.orderId, "evt-late");
    expect((await db().order.findUniqueOrThrow({ where: { id: o.orderId } })).status).toBe("DELIVERED");
    expect(await syncOrderPayment(o.orderId)).toBe("PAID");
  });
});
