import { describe, expect, it } from "vitest";
import { maskValue, parseInventoryText } from "@/server/inventory/inventory.parser";
import { formatMoney, parseMoneyToCents } from "@/server/common/money";
import { detectLocale, dictionary, formatItems, t } from "@/i18n";

describe("inventory parser", () => {
  it("parses one item per line, ignoring blanks and in-text duplicates", () => {
    const r = parseInventoryText("LINK-001\n\nLINK-002\r\nLINK-001\n  LINK-003  \n");
    expect(r.valid).toEqual(["LINK-001", "LINK-002", "LINK-003"]);
    expect(r.duplicatesInInput).toEqual(["LINK-001"]);
    expect(r.invalid).toEqual([]);
  });

  it("flags invalid lines", () => {
    const r = parseInventoryText(`ok\nbad\u0001value\n${"x".repeat(3000)}`);
    expect(r.valid).toEqual(["ok"]);
    expect(r.invalid.map((i) => i.reason)).toEqual(["control_characters", "too_long"]);
    expect(r.invalid[0]!.line).toBe(2);
  });

  it("reads the first CSV column and skips a header", () => {
    const r = parseInventoryText('code,note\n"ABC-1",first\nABC-2;second\nhttps://x.com/a?b=1,c=2\n', { csv: true });
    expect(r.valid).toEqual(["ABC-1", "ABC-2", "https://x.com/a?b=1,c=2"]);
  });

  it("keeps only the links of a supplier order export", () => {
    const text =
      "Field,Value\nProduct,Gemini Pro por 18 meses\nPrice,1.15 USDT\nOrderCode,FGC5QAHS2\nQuantity,2\nTotal,2.30 USDT\n\n#,Content\n" +
      "1,https://serviceactivation.in/subscription/new/ESIA3ayXCicv\n2,https://serviceactivation.in/subscription/new/TXTaH12tDSGY\n";
    const links = ["https://serviceactivation.in/subscription/new/ESIA3ayXCicv", "https://serviceactivation.in/subscription/new/TXTaH12tDSGY"];
    for (const csv of [true, false]) {
      const r = parseInventoryText(text, { csv });
      expect(r.valid).toEqual(links);
      expect(r.ignored).toBe(7);
      expect(r.invalid).toEqual([]);
    }
  });

  it("masks values", () => {
    expect(maskValue("https://example.com/invite/ABCDEFGH")).toBe("https://example.com••••EFGH");
    expect(maskValue("ABCD-EFGH-IJKL")).toBe("••••JKL");
    expect(maskValue("ABC")).toBe("••••");
    expect(maskValue("ABCDEFGHIJ")).toBe("••••IJ"); // 10-char code: only 2 chars visible
  });
});

describe("money", () => {
  it("parses user input to cents", () => {
    expect(parseMoneyToCents("20")).toBe(2000);
    expect(parseMoneyToCents("20,5")).toBe(2050);
    expect(parseMoneyToCents("4.00")).toBe(400);
    expect(parseMoneyToCents("-1")).toBeNull();
    expect(parseMoneyToCents("1.234")).toBeNull();
  });

  it("formats BRL and USD", () => {
    expect(formatMoney(2000, "BRL", "pt_BR").replace(/\s/g, " ")).toBe("R$ 20,00");
    expect(formatMoney(400, "USD", "en_US")).toBe("$4.00");
  });
});

describe("i18n", () => {
  it("pt-BR and en-US have exactly the same keys", () => {
    expect(Object.keys(dictionary("en_US")).sort()).toEqual(Object.keys(dictionary("pt_BR")).sort());
  });

  it("interpolates and escapes HTML in variables", () => {
    expect(t("pt_BR", "order_cancelled", { number: 42 })).toBe("Pedido #42 cancelado.");
    const html = t("en_US", "payment_confirmed", { product: "<b>x</b>", quantity: 1, number: 1 }, { items: formatItems(["a&b"]) });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("<code>a&amp;b</code>");
  });

  it("lists every delivered item, escaped, one per line", () => {
    expect(formatItems(["L1"])).toBe("<code>L1</code>");
    expect(formatItems(["L1", "<L2>"], "pt_BR")).toBe("<b>Código 1:</b>\n<code>L1</code>\n\n<b>Código 2:</b>\n<code>&lt;L2&gt;</code>");
    expect(formatItems(["https://a.com/1", "https://a.com/2"], "en_US")).toBe("<b>Link 1:</b>\n<code>https://a.com/1</code>\n\n<b>Link 2:</b>\n<code>https://a.com/2</code>");
    const html = t("pt_BR", "payment_confirmed", { product: "{items}", quantity: 2, number: 3 }, { items: formatItems(["L1", "L2"], "pt_BR") });
    expect(html).toContain("{items} (x2)"); // placeholders inside variables are not expanded
    expect(html).toContain("<b>Código 1:</b>\n<code>L1</code>\n\n<b>Código 2:</b>\n<code>L2</code>");
  });

  it("detects locale from Telegram language_code", () => {
    expect(detectLocale("pt-br")).toBe("pt_BR");
    expect(detectLocale("pt")).toBe("pt_BR");
    expect(detectLocale("es")).toBe("en_US");
    expect(detectLocale(undefined)).toBe("en_US");
  });

  it("uses the exact delivery message from the specification", () => {
    const pt = t("pt_BR", "payment_confirmed", { product: "Serviço Digital X", quantity: 1, number: 7 }, { items: formatItems(["LINK-001"]) });
    expect(pt).toContain("Pagamento confirmado!");
    expect(pt).toContain("Seu pedido foi processado.");
    expect(pt).toContain("#7");
    expect(pt).toContain("Obrigado pela compra.");
  });
});
