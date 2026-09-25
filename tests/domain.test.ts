import { describe, expect, it } from "vitest";
import { maskValue, parseInventoryText } from "@/server/inventory/inventory.parser";
import { formatMoney, parseMoneyToCents } from "@/server/common/money";
import { detectLocale, dictionary, t } from "@/i18n";

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
    const html = t("en_US", "payment_confirmed", { product: "<b>x</b>", item: "a&b", number: 1 });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("<code>a&amp;b</code>");
  });

  it("detects locale from Telegram language_code", () => {
    expect(detectLocale("pt-br")).toBe("pt_BR");
    expect(detectLocale("pt")).toBe("pt_BR");
    expect(detectLocale("es")).toBe("en_US");
    expect(detectLocale(undefined)).toBe("en_US");
  });

  it("uses the exact delivery message from the specification", () => {
    const pt = t("pt_BR", "payment_confirmed", { product: "Serviço Digital X", item: "LINK-001", number: 7 });
    expect(pt).toContain("Pagamento confirmado!");
    expect(pt).toContain("Seu pedido foi processado.");
    expect(pt).toContain("#7");
    expect(pt).toContain("Obrigado pela compra.");
  });
});
