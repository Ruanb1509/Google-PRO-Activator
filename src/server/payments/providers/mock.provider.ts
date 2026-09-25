import { db } from "@/server/common/db";
import { env, mockPaymentsEnabled } from "@/server/config/env";
import { hmacSha256Hex, safeEqual } from "@/server/common/crypto";
import type { PaymentStatus } from "@/generated/prisma/enums";
import {
  WebhookSignatureError,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type PaymentProvider,
  type PaymentStatusResult,
  type RefundResult,
  type WebhookRequest,
  type WebhookResult,
} from "@/server/payments/payment-provider";

/**
 * Fake gateway for local/preview testing of the full flow (order -> signed webhook -> delivery).
 * It behaves like a real provider: the "remote" state lives in payment.metadata.mockStatus and is
 * only changed by the simulated checkout page, which then sends an HMAC-signed webhook.
 * It can never be enabled in production.
 */
export class MockProvider implements PaymentProvider {
  readonly name = "mock";
  readonly supportedCurrencies = ["BRL", "USD"] as const;
  readonly usesWebhooks = true;

  isConfigured(): boolean {
    return mockPaymentsEnabled() && Boolean(env().MOCK_WEBHOOK_SECRET);
  }

  static sign(body: string): string {
    return hmacSha256Hex(env().MOCK_WEBHOOK_SECRET ?? "", body);
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const id = `mock_${input.orderId}`;
    return {
      providerPaymentId: id,
      status: "PENDING",
      checkoutUrl: `${env().APP_URL}/api/dev/mock-pay?id=${encodeURIComponent(id)}`,
      pixCopyPaste: input.currency === "BRL" ? `MOCKPIX-${input.orderNumber}-${input.amountCents}` : undefined,
      metadata: { mockStatus: "PENDING" },
    };
  }

  async getPaymentStatus(providerPaymentId: string): Promise<PaymentStatusResult> {
    const p = await db().payment.findFirst({ where: { provider: this.name, providerPaymentId } });
    const status = ((p?.metadata as { mockStatus?: PaymentStatus } | null)?.mockStatus ?? "PENDING") as PaymentStatus;
    return { providerPaymentId, status, amountCents: p?.amountCents, currency: p?.currency, country: (p?.metadata as { mockCountry?: string } | null)?.mockCountry ?? null };
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookResult> {
    if (!this.isConfigured()) throw new WebhookSignatureError("Mock provider disabled");
    const sig = req.headers.get("x-mock-signature") ?? "";
    if (!safeEqual(sig, MockProvider.sign(req.rawBody))) throw new WebhookSignatureError();
    const body = JSON.parse(req.rawBody) as { eventId: string; type: string; paymentId: string };
    return { eventId: body.eventId, eventType: body.type, providerPaymentId: body.paymentId, payload: body };
  }

  async refundPayment(providerPaymentId: string): Promise<RefundResult> {
    const p = await db().payment.findFirst({ where: { provider: this.name, providerPaymentId } });
    if (p) await db().payment.update({ where: { id: p.id }, data: { metadata: { ...((p.metadata as object) ?? {}), mockStatus: "REFUNDED" } } });
    return { refundId: `mockref_${providerPaymentId}`, status: "REFUNDED" };
  }
}
