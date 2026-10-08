import { describe, expect, it } from "vitest";
import { bulkDiscountTiers, bulkPercentOff, formatBulkDiscounts, parseBulkDiscounts, productUnitCents } from "@/lib/bulk-discounts";

// Gemini Pro: supplier $0.90 -> $0.80 (5+), $0.70 (11+), $0.60 (25+); sold at 2x the cost.
const gemini = { priceBrlCents: 904, priceUsdCents: 180, bulkDiscounts: [{ minQty: 25, percentOff: 33.33 }, { minQty: 5, percentOff: 11.11 }, { minQty: 11, percentOff: 22.22 }] };

describe("bulk discounts", () => {
  it("applies the highest tier reached", () => {
    const tiers = bulkDiscountTiers(gemini.bulkDiscounts);
    expect([1, 4, 5, 10, 11, 24, 25, 100].map((q) => bulkPercentOff(tiers, q))).toEqual([0, 0, 11.11, 11.11, 22.22, 22.22, 33.33, 33.33]);
  });

  it("keeps the 2x margin over the supplier's tier prices", () => {
    expect([1, 5, 11, 25].map((q) => productUnitCents(gemini, "USD", q))).toEqual([180, 160, 140, 120]);
    expect(productUnitCents(gemini, "BRL", 25)).toBe(603);
  });

  it("ignores malformed or excessive tiers", () => {
    expect(bulkDiscountTiers(null)).toEqual([]);
    expect(bulkDiscountTiers([{ minQty: 5, percentOff: 80 }, { minQty: 1, percentOff: 10 }, { minQty: "5", percentOff: 10 }])).toEqual([]);
    expect(productUnitCents({ priceBrlCents: 1000, priceUsdCents: 200 }, "BRL", 50)).toBe(1000);
  });

  it("parses and formats the admin text", () => {
    expect(parseBulkDiscounts("25:33,33, 5:11,11; 11:22,22%")).toEqual([
      { minQty: 5, percentOff: 11.11 },
      { minQty: 11, percentOff: 22.22 },
      { minQty: 25, percentOff: 33.33 },
    ]);
    expect(parseBulkDiscounts("  ")).toEqual([]);
    expect(formatBulkDiscounts([{ minQty: 5, percentOff: 11.11 }, { minQty: 25, percentOff: 30 }])).toBe("5:11,11, 25:30");
    expect(() => parseBulkDiscounts("5:60")).toThrow();
    expect(() => parseBulkDiscounts("1:10")).toThrow();
    expect(() => parseBulkDiscounts("5:10, 5:20")).toThrow();
    expect(() => parseBulkDiscounts("abc")).toThrow();
  });
});
