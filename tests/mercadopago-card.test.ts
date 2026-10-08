import { afterEach, describe, expect, it, vi } from "vitest";

process.env.MERCADOPAGO_ACCESS_TOKEN ??= "TEST-token";
process.env.MERCADOPAGO_WEBHOOK_SECRET ??= "test-mp-secret";
const { MercadoPagoCardProvider } = await import("@/server/payments/providers/mercadopago-card.provider");

/** Fake Mercado Pago API: answers by path, records the requests. */
function mockApi(routes: Record<string, unknown>) {
  const calls: { method: string; path: string; body: any }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const path = url.replace("https://api.mercadopago.com", "");
    calls.push({ method: init.method ?? "GET", path, body: init.body ? JSON.parse(String(init.body)) : null });
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    return new Response(JSON.stringify(key ? routes[key] : {}), { status: key ? 200 : 404 });
  });
  return calls;
}

const payment = (id: number, status: string) => ({ id, status, transaction_amount: 36, currency_id: "BRL", external_reference: "order1", payment_method_id: "master" });

afterEach(() => vi.unstubAllGlobals());

describe("Mercado Pago credit card (Checkout Pro)", () => {
  const card = new MercadoPagoCardProvider();

  it("creates a credit-card-only checkout for the order", async () => {
    const calls = mockApi({ "/checkout/preferences": { id: "pref1", init_point: "https://mp.example/checkout" } });
    const r = await card.createPayment({ orderId: "order1", orderNumber: 7, userId: "u", telegramId: "1", amountCents: 3600, currency: "BRL", description: "2x Gemini #7", idempotencyKey: "order1", expiresAt: new Date(Date.now() + 30 * 60_000), locale: "pt_BR" });
    expect(r).toMatchObject({ providerPaymentId: "pref1", status: "PENDING", checkoutUrl: "https://mp.example/checkout" });
    const body = calls[0]!.body;
    expect(body.external_reference).toBe("order1");
    expect(body.items[0].unit_price).toBe(36);
    expect(body.binary_mode).toBe(true);
    expect(body.payment_methods.excluded_payment_types.map((t: { id: string }) => t.id)).toEqual(expect.arrayContaining(["bank_transfer", "ticket", "debit_card"]));
  });

  it("is paid when any card payment of the order was approved, and keeps the payment id for refunds", async () => {
    mockApi({ "/checkout/preferences/pref1": { id: "pref1", external_reference: "order1" }, "/v1/payments/search": { results: [payment(2, "rejected"), payment(1, "approved")] } });
    expect(await card.getPaymentStatus("pref1")).toMatchObject({ status: "PAID", amountCents: 3600, currency: "BRL", providerReference: "1" });
  });

  it("stays pending after a declined card (the customer may try another one)", async () => {
    mockApi({ "/checkout/preferences/pref1": { id: "pref1", external_reference: "order1" }, "/v1/payments/search": { results: [payment(2, "rejected")] } });
    expect((await card.getPaymentStatus("pref1")).status).toBe("PENDING");
    mockApi({ "/checkout/preferences/pref1": { id: "pref1", external_reference: "order1" }, "/v1/payments/search": { results: [] } });
    expect((await card.getPaymentStatus("pref1")).status).toBe("PENDING");
  });

  it("refunds the card payment, not the checkout", async () => {
    const calls = mockApi({ "/v1/payments/1/refunds": { id: 9, status: "approved" } });
    expect(await card.refundPayment("pref1", { orderId: "order1", providerReference: "1" })).toEqual({ refundId: "9", status: "REFUNDED" });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v1/payments/1/refunds" });
  });
});

describe("card surcharge", () => {
  it("adds the method's surcharge after the quantity discount", async () => {
    const { methodAmountCents } = await import("@/server/orders/orders.service");
    const product = { priceBrlCents: 2000, priceUsdCents: 400, bulkDiscounts: [{ minQty: 5, percentOff: 10 }] };
    expect(methodAmountCents(product, { currency: "BRL", surchargePercent: 0 }, 1)).toBe(2000);
    expect(methodAmountCents(product, { currency: "BRL", surchargePercent: 4.99 }, 1)).toBe(2100);
    expect(methodAmountCents(product, { currency: "BRL", surchargePercent: 4.99 }, 5)).toBe(9449);
  });
});
