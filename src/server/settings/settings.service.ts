import { z } from "zod";
import { db } from "@/server/common/db";
import type { Currency } from "@/generated/prisma/enums";

/**
 * A payment method shown to customers. The method decides provider + currency, so adding a new
 * gateway is: implement a PaymentProvider adapter + add a method here (from the dashboard).
 */
export const paymentMethodSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,32}$/),
  provider: z.string().regex(/^[a-z0-9_]{2,32}$/),
  currency: z.enum(["BRL", "USD"]),
  enabled: z.boolean(),
  labelPt: z.string().min(1).max(40),
  labelEn: z.string().min(1).max(40),
  /** Languages for which this method is listed first (suggestion only, never a restriction). */
  suggestedForLocales: z.array(z.enum(["pt_BR", "en_US"])).default([]),
});
export type PaymentMethodConfig = z.infer<typeof paymentMethodSchema>;

export const storeSettingsSchema = z.object({
  paymentMethods: z.array(paymentMethodSchema).min(1),
  /** Countries treated as "Brazil" in reports and BRL checks (country comes from the payment provider). */
  brlCountries: z.array(z.string().length(2)).default(["BR"]),
  lowStockThreshold: z.number().int().min(0).max(100000),
  orderTtlMinutes: z.number().int().min(5).max(24 * 60),
  maxPendingOrdersPerUser: z.number().int().min(1).max(20),
  supportContact: z.string().max(200).default(""),
  binancePay: z.object({
    enabled: z.boolean(),
    asset: z.string().regex(/^[A-Z]{2,10}$/),
    minDepositCents: z.number().int().min(100),
    maxDepositCents: z.number().int().min(100),
    depositTtlMinutes: z.number().int().min(10).max(7 * 24 * 60),
    /**
     * false (default): the customer sends ANY amount and then the transaction id; the amount read from
     * the Binance API is credited. true: the customer picks an amount first and must send an exact,
     * unique value (a stolen transaction id can't be claimed by someone else).
     */
    requireExactAmount: z.boolean(),
    presetAmountsCents: z.array(z.number().int().min(100)).max(6),
    /** USD stablecoins accepted 1:1 as store credit. */
    acceptedAssets: z.array(z.string().regex(/^[A-Z0-9]{2,10}$/)).min(1).default(["USDT", "USDC", "FDUSD"]),
    /** Open-amount mode: how old (hours) a transaction may be when its id is sent. */
    claimWindowHours: z.number().int().min(1).max(24 * 30).default(24),
  }),
});
export type StoreSettings = z.infer<typeof storeSettingsSchema>;

export const DEFAULT_SETTINGS: StoreSettings = {
  paymentMethods: [
    { key: "pix", provider: "mercadopago", currency: "BRL", enabled: true, labelPt: "PIX", labelEn: "PIX (Brazil)", suggestedForLocales: ["pt_BR"] },
    { key: "card", provider: "stripe", currency: "USD", enabled: true, labelPt: "Cartão internacional", labelEn: "Card", suggestedForLocales: ["en_US"] },
    { key: "balance", provider: "balance", currency: "USD", enabled: true, labelPt: "Saldo da conta", labelEn: "Account balance", suggestedForLocales: [] },
    { key: "mock", provider: "mock", currency: "BRL", enabled: false, labelPt: "Pagamento de teste", labelEn: "Test payment", suggestedForLocales: [] },
  ],
  brlCountries: ["BR"],
  lowStockThreshold: 10,
  orderTtlMinutes: 30,
  maxPendingOrdersPerUser: 3,
  supportContact: "",
  binancePay: {
    enabled: false,
    asset: "USDT",
    minDepositCents: 200,
    maxDepositCents: 50000,
    depositTtlMinutes: 60,
    requireExactAmount: false,
    presetAmountsCents: [500, 1000, 2000, 5000],
    acceptedAssets: ["USDT", "USDC", "FDUSD"],
    claimWindowHours: 24,
  },
};

const KEY = "store";
let cache: { value: StoreSettings; at: number } | undefined;
const CACHE_MS = 15_000;

export async function getSettings(): Promise<StoreSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const row = await db().setting.findUnique({ where: { key: KEY } });
  const stored = (row?.value as Partial<StoreSettings> | null) ?? {};
  // Nested objects are merged too, so settings saved by older versions pick up new keys.
  const merged = { ...DEFAULT_SETTINGS, ...stored, binancePay: { ...DEFAULT_SETTINGS.binancePay, ...(stored.binancePay ?? {}) } };
  const parsed = storeSettingsSchema.safeParse(merged);
  const value = parsed.success ? parsed.data : DEFAULT_SETTINGS;
  cache = { value, at: Date.now() };
  return value;
}

export async function saveSettings(value: StoreSettings, adminId: string): Promise<StoreSettings> {
  const parsed = storeSettingsSchema.parse(value);
  await db().setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: parsed, updatedBy: adminId },
    update: { value: parsed, updatedBy: adminId },
  });
  cache = undefined;
  return parsed;
}

export function methodCurrency(method: PaymentMethodConfig): Currency {
  return method.currency;
}
