import { describe, expect, it } from "vitest";
import { deliveredValues } from "@/server/supplier/partner-api.client";
import { splitLinks } from "@/server/inventory/inventory.parser";

describe("supplier delivered values", () => {
  it("splits a bulk ready-account delivery sent as a single value", () => {
    const content = "Email: a1@x.team Password: p1 Email: b2@x.team Password: p2";
    expect(deliveredValues({ quantity: 2, delivery: { content } })).toEqual(["Email: a1@x.team Password: p1", "Email: b2@x.team Password: p2"]);
    expect(deliveredValues({ quantity: 2, delivery: { content: "Email: a1@x.team\nPassword: p1\n\nEmail: b2@x.team\nPassword: p2" } })).toEqual([
      "Email: a1@x.team\nPassword: p1",
      "Email: b2@x.team\nPassword: p2",
    ]);
    expect(deliveredValues({ quantity: 2, delivery: { link: "https://a\nhttps://b" } })).toEqual(["https://a", "https://b"]);
  });

  it("keeps per-unit lines and unsplittable values as they are", () => {
    expect(deliveredValues({ quantity: 2, lines: [{ orderCode: "A", code: "X" }, { orderCode: "B", code: "Y" }] })).toEqual(["X", "Y"]);
    expect(deliveredValues({ quantity: 1, delivery: { content: "Email: a Password: p" } })).toEqual(["Email: a Password: p"]);
    expect(deliveredValues({ quantity: 3, delivery: { content: "Email: a Password: p Email: b Password: q" } })).toEqual(["Email: a Password: p Email: b Password: q"]);
  });
});

describe("multi-link values (order #113: two links delivered under a single \"Link 1\")", () => {
  const a = "https://serviceactivation.example.com/activate-plan/subscription/new/AAA_x-1==";
  const b = "https://serviceactivation.example.com/activate-plan/subscription/new/BBB_y-2==";
  const c = "https://serviceactivation.example.com/activate-plan/subscription/new/CCC_z-3==";

  it("splits a value made only of links, whatever the separator", () => {
    expect(splitLinks(`${a}\n\n${b}`)).toEqual([a, b]);
    expect(splitLinks(`${a}\n${b} ${c}`)).toEqual([a, b, c]);
    expect(splitLinks(`  ${a}  `)).toEqual([`  ${a}  `]);
    expect(splitLinks(`Email: x ${a} ${b}`)).toEqual([`Email: x ${a} ${b}`]);
  });

  it("stores one item per link even when a line or the delivery holds several", () => {
    expect(deliveredValues({ quantity: 2, delivery: { link: `${a}\n\n${b}` } })).toEqual([a, b]);
    expect(deliveredValues({ quantity: 1, delivery: { link: `${a}\n\n${b}` } })).toEqual([a, b]);
    expect(deliveredValues({ quantity: 3, lines: [{ orderCode: "1", link: `${a}\n${b}` }, { orderCode: "2", link: c }] })).toEqual([a, b, c]);
  });
});
