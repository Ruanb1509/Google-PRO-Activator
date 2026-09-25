import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "@/server/common/crypto";
import { mapMercadoPagoStatus, verifyMercadoPagoSignature } from "@/server/payments/providers/mercadopago.provider";
import { formEncode, verifyStripeSignature } from "@/server/payments/providers/stripe.provider";
import { decimalToCents, signQuery } from "@/server/wallet/binance-pay.client";

describe("Mercado Pago webhook signature", () => {
  const secret = "mp-secret";
  const now = 1_760_000_000_000;
  const ts = String(now / 1000);
  const sign = (dataId: string, requestId: string) =>
    hmacSha256Hex(secret, `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`);

  it("accepts a valid signature", () => {
    const v1 = sign("123456", "req-1");
    expect(verifyMercadoPagoSignature({ secret, xSignature: `ts=${ts},v1=${v1}`, xRequestId: "req-1", dataId: "123456", nowMs: now })).toBe(true);
  });

  it("rejects wrong secret, tampered id and replays", () => {
    const v1 = sign("123456", "req-1");
    expect(verifyMercadoPagoSignature({ secret: "other", xSignature: `ts=${ts},v1=${v1}`, xRequestId: "req-1", dataId: "123456", nowMs: now })).toBe(false);
    expect(verifyMercadoPagoSignature({ secret, xSignature: `ts=${ts},v1=${v1}`, xRequestId: "req-1", dataId: "999", nowMs: now })).toBe(false);
    expect(verifyMercadoPagoSignature({ secret, xSignature: `ts=${ts},v1=${v1}`, xRequestId: "req-1", dataId: "123456", nowMs: now + 3_600_000 })).toBe(false);
    expect(verifyMercadoPagoSignature({ secret, xSignature: null, xRequestId: "req-1", dataId: "123456", nowMs: now })).toBe(false);
  });

  it("maps statuses", () => {
    expect(mapMercadoPagoStatus("approved")).toBe("PAID");
    expect(mapMercadoPagoStatus("pending")).toBe("PENDING");
    expect(mapMercadoPagoStatus("rejected")).toBe("FAILED");
    expect(mapMercadoPagoStatus("refunded")).toBe("REFUNDED");
    expect(mapMercadoPagoStatus("charged_back")).toBe("REFUNDED");
    expect(mapMercadoPagoStatus("cancelled")).toBe("CANCELLED");
  });
});

describe("Stripe webhook signature", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const now = 1_760_000_000_000;
  const t = Math.floor(now / 1000);

  it("accepts a valid signature (with multiple v1 values)", () => {
    const sig = hmacSha256Hex(secret, `${t}.${body}`);
    expect(verifyStripeSignature({ secret, header: `t=${t},v1=deadbeef,v1=${sig}`, rawBody: body, nowMs: now })).toBe(true);
  });

  it("rejects modified body and old timestamps", () => {
    const sig = hmacSha256Hex(secret, `${t}.${body}`);
    expect(verifyStripeSignature({ secret, header: `t=${t},v1=${sig}`, rawBody: body + " ", nowMs: now })).toBe(false);
    expect(verifyStripeSignature({ secret, header: `t=${t},v1=${sig}`, rawBody: body, nowMs: now + 600_000 })).toBe(false);
  });

  it("form-encodes nested params", () => {
    const s = formEncode({ mode: "payment", line_items: [{ quantity: 1, price_data: { unit_amount: 400 } }], expand: ["payment_intent"] });
    expect(decodeURIComponent(s)).toBe("mode=payment&line_items[0][quantity]=1&line_items[0][price_data][unit_amount]=400&expand[0]=payment_intent");
  });
});

describe("Binance Pay helpers", () => {
  it("signs queries like the official docs example", () => {
    const secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j";
    const query = "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
    expect(signQuery(query, secret)).toBe("c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
  });

  it("converts decimal strings to cents without float errors", () => {
    expect(decimalToCents("10.03000000")).toBe(1003);
    expect(decimalToCents("0.1")).toBe(10);
    expect(decimalToCents("4")).toBe(400);
    expect(decimalToCents("-5.50")).toBe(-550);
    expect(decimalToCents("1.239")).toBe(123);
    expect(decimalToCents("abc")).toBeNull();
  });
});
