import type { Currency, Locale, PaymentStatus } from "@/generated/prisma/enums";

export interface CreatePaymentInput {
  orderId: string;
  orderNumber: number;
  userId: string;
  telegramId: string;
  amountCents: number;
  currency: Currency;
  description: string;
  /** Same key => provider must not create a second charge. */
  idempotencyKey: string;
  expiresAt: Date;
  locale: Locale;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
  status: PaymentStatus;
  providerReference?: string;
  checkoutUrl?: string;
  pixCopyPaste?: string;
  pixQrBase64?: string;
  metadata?: Record<string, unknown>;
}

/** Authoritative payment state, always fetched from the provider API (never trusted from the client). */
export interface PaymentStatusResult {
  providerPaymentId: string;
  status: PaymentStatus;
  amountCents?: number;
  currency?: string;
  country?: string | null;
  providerReference?: string | null;
  paymentMethodDetail?: string | null;
  raw?: unknown;
}

export interface WebhookRequest {
  headers: Headers;
  rawBody: string;
  url: URL;
}

/** Result of a signature-verified webhook. Identifies the payment; the status is re-fetched from the API. */
export interface WebhookResult {
  eventId: string;
  eventType: string;
  providerPaymentId?: string | null;
  providerReference?: string | null;
  /** Some notifications are irrelevant (e.g. unrelated event types) and only get recorded. */
  ignore?: boolean;
  payload: unknown;
}

export interface RefundResult {
  refundId: string;
  status: "REFUNDED" | "PENDING";
}

export class WebhookSignatureError extends Error {
  constructor(message = "Invalid webhook signature") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly httpStatus?: number,
    public readonly body?: unknown,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderError";
  }
}

/**
 * Adapter contract for payment gateways. To add a new gateway, implement this interface, register it
 * in `registry.ts` and add a payment method pointing to it in the dashboard settings.
 */
export interface PaymentProvider {
  readonly name: string;
  readonly supportedCurrencies: readonly Currency[];
  /** Minimum lifetime of a checkout for this provider (e.g. Stripe requires >= 30 min). */
  readonly minTtlMinutes?: number;
  /** Whether it receives webhooks (internal providers like "balance" do not). */
  readonly usesWebhooks: boolean;

  isConfigured(): boolean;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  getPaymentStatus(providerPaymentId: string): Promise<PaymentStatusResult>;
  /** Verifies the signature and extracts identifiers. Throws WebhookSignatureError when invalid. */
  handleWebhook(req: WebhookRequest): Promise<WebhookResult>;
  refundPayment(providerPaymentId: string, ctx: { orderId: string; amountCents: number; providerReference?: string | null }): Promise<RefundResult>;
  /** Optional: invalidate a checkout so a late payment cannot happen after the order expired. */
  cancelPayment?(providerPaymentId: string): Promise<void>;
}
