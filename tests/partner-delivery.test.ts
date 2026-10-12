import { describe, expect, it } from "vitest";
import { deliveredValues } from "@/server/supplier/partner-api.client";
import { splitBundle, splitLinks } from "@/server/inventory/inventory.parser";
import { formatItems } from "@/i18n";

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
    expect(deliveredValues({ quantity: 3, delivery: { content: "Email: a Password: p Email: b Password: q" } })).toEqual(["Email: a Password: p", "Email: b Password: q"]);
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

describe("ready accounts (order #110: two CapCut accounts under a single \"Código 1\")", () => {
  const a = "Email: mdvev20@x.team\nPassword: premium123";
  const b = "Email: jzuom54@x.team\nPassword: premium123";
  const c = "Email: iuimg77@x.team\nPassword: premium123";

  it("splits bundled accounts whatever the quantity asked", () => {
    expect(splitBundle(`${a}\n${b}`)).toEqual([a, b]);
    expect(deliveredValues({ quantity: 1, delivery: { content: `${a}\n${b}` } })).toEqual([a, b]);
    expect(deliveredValues({ quantity: 3, lines: [{ orderCode: "1", content: `${a}\n${b}` }, { orderCode: "2", content: c }] })).toEqual([a, b, c]);
  });

  it("keeps a single account whole, even with a repeated word in another label", () => {
    expect(splitBundle(a)).toEqual([a]);
    const recovery = "Email: a@x.team\nRecovery Email: r@x.team\nPassword: p";
    expect(splitBundle(recovery)).toEqual([recovery]);
  });

  it("labels accounts as Conta/Account in the delivery message", () => {
    expect(formatItems([a, c], "pt_BR")).toContain("<b>Conta 1:</b>");
    expect(formatItems([a, c], "en_US")).toContain("<b>Account 2:</b>");
    expect(formatItems(["ABC-123", "DEF-456"], "pt_BR")).toContain("<b>Código 1:</b>");
    expect(formatItems(["https://a.example/x", "https://b.example/y"], "pt_BR")).toContain("<b>Link 2:</b>");
  });
});
