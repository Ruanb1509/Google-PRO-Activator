import { describe, expect, it } from "vitest";
import { deliveryFile } from "@/server/notifications/delivery-file";

describe("deliveryFile", () => {
  const values = ["https://a.example/1", 'code "x"', "https://a.example/2"];

  it("writes one item per line in TXT", () => {
    const f = deliveryFile(values, "txt", 42, "pt_BR");
    expect(f.filename).toBe("pedido-42.txt");
    expect(f.content.toString("utf8")).toBe(`${values.join("\n")}\n`);
  });

  it("separates multi-line items with a blank line in TXT", () => {
    expect(deliveryFile(["a\nb", "c"], "txt", 1, "en_US").content.toString("utf8")).toBe("a\nb\n\nc\n");
  });

  it("writes a quoted CSV with a BOM and item labels", () => {
    const f = deliveryFile(values, "csv", 7, "en_US");
    expect(f.filename).toBe("order-7.csv");
    const text = f.content.toString("utf8");
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text.slice(1).split("\r\n")).toEqual(['n,type,value', '"1","Link","https://a.example/1"', '"2","Code","code ""x"""', '"3","Link","https://a.example/2"', ""]);
  });
});
