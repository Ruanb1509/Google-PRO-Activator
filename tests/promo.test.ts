import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/orders/orders.service", () => ({ availablePaymentMethods: async () => [{ currency: "BRL" }] }));
const { promoMessage } = await import("@/server/products/promo.service");

const gemini = { id: "p1", name: "Google Gemini PRO", nameEn: null, priceBrlCents: 2000, priceUsdCents: 400, bulkDiscounts: [{ minQty: 5, percentOff: 10 }, { minQty: 11, percentOff: 20 }, { minQty: 25, percentOff: 30 }] };

describe("quantity-discount promotion", () => {
  it("lists the price of every quantity tier", async () => {
    const text = (await promoMessage(gemini, "pt_BR")).replace(/\s/g, " ");
    expect(text).toContain("<b>Promoção: Google Gemini PRO</b>");
    for (const line of ["• 1-4 un. → R$ 20,00 cada", "• 5-10 un. → R$ 18,00 cada", "• 11-24 un. → R$ 16,00 cada", "• 25+ un. → R$ 14,00 cada"]) expect(text).toContain(line);
  });
});
