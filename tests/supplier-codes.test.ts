import { describe, expect, it } from "vitest";
import { supplierOrderCodes } from "@/lib/supplier-codes";
import { supplierCodeHtml } from "@/i18n";

describe("supplier order codes", () => {
  it("extracts unique codes from supplier batches and ignores manual uploads", () => {
    const items = [{ batchId: "supplier:ORD-1" }, { batchId: "supplier:ORD-1" }, { batchId: "3f2c-uuid" }, { batchId: null }, { batchId: "supplier:ORD-2" }];
    expect(supplierOrderCodes(items)).toEqual(["ORD-1", "ORD-2"]);
  });

  it("renders the customer block escaped, and nothing without codes", () => {
    expect(supplierCodeHtml([], "pt_BR")).toBe("");
    const html = supplierCodeHtml(["A<1>", "B2"], "pt_BR");
    expect(html).toContain("<code>A&lt;1&gt;</code>, <code>B2</code>");
    expect(supplierCodeHtml(["X"], "en_US")).toContain("Order code");
  });
});
