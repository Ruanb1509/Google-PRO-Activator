import type { Currency } from "@/generated/prisma/enums";

export function formatMoney(cents: number, currency: Currency | "USDT" | string, locale: "pt_BR" | "en_US" = "pt_BR"): string {
  const value = cents / 100;
  if (currency === "BRL" || currency === "USD") {
    return new Intl.NumberFormat(locale === "pt_BR" ? "pt-BR" : "en-US", { style: "currency", currency }).format(value);
  }
  return `${value.toFixed(2)} ${currency}`;
}

/** Parses "20", "20.5", "20,50" into integer cents. Returns null on invalid input. */
export function parseMoneyToCents(input: string | number): number | null {
  const s = String(input).trim().replace(",", ".");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
