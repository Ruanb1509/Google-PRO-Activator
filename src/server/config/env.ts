import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  VERCEL_ENV: z.enum(["development", "preview", "production"]).optional(),
  APP_URL: z.url(),

  DATABASE_URL: z.string().min(1),

  /** 32-byte key (base64 or hex) used for AES-256-GCM encryption of inventory values and TOTP secrets. */
  ENCRYPTION_KEY: z.string().min(32),
  /** Secret used for HMAC hashing (session tokens, inventory duplicate detection). */
  HASH_SECRET: z.string().min(32),
  /** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. */
  CRON_SECRET: z.string().min(16),
  /** Optional token to read /api/metrics. */
  METRICS_TOKEN: z.string().min(16).optional(),

  TELEGRAM_BOT_TOKEN: z.string().min(20),
  TELEGRAM_BOT_USERNAME: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/),
  /** Comma separated chat ids that receive operational alerts (low stock, delivery failures). */
  ADMIN_ALERT_CHAT_IDS: z.string().optional().default(""),

  MERCADOPAGO_ACCESS_TOKEN: z.string().optional(),
  MERCADOPAGO_WEBHOOK_SECRET: z.string().optional(),
  MERCADOPAGO_PAYER_EMAIL: z.email().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  BINANCE_API_KEY: z.string().optional(),
  BINANCE_API_SECRET: z.string().optional(),
  BINANCE_PAY_ID: z.string().optional(),
  BINANCE_API_BASE_URL: z.url().default("https://api.binance.com"),

  /** Enables the fake gateway for local/preview testing. Always disabled when VERCEL_ENV=production. */
  PAYMENTS_MOCK_ENABLED: bool,
  MOCK_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Parsed & validated environment. Lazy so that `next build` works without runtime secrets. */
export function env(): Env {
  if (cached) return cached;
  // Empty values (e.g. `METRICS_TOKEN=` copied from .env.example) are treated as not set.
  const source = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production" || (process.env.NODE_ENV === "production" && !process.env.VERCEL_ENV);
}

export function mockPaymentsEnabled(): boolean {
  return env().PAYMENTS_MOCK_ENABLED && !isProduction();
}
