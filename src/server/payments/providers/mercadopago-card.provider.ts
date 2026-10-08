import { env } from "@/server/config/env";
import type { PaymentStatus } from "@/generated/prisma/enums";
import { mapMercadoPagoStatus, MercadoPagoProvider, mpDate, type MpPayment } from "@/server/payments/providers/mercadopago.provider";
import { ProviderError, type CreatePaymentInput, type CreatePaymentResult, type PaymentStatusResult, type RefundResult, type WebhookResult } from "@/server/payments/payment-provider";

interface MpPreference {
  id: string;
  init_point: string;
  external_reference?: string;
}

const MAX_INSTALLMENTS = 12;

/** Which of the payments made for one checkout counts (a declined card followed by an approved one, etc.). */
const STATUS_PRIORITY: PaymentStatus[] = ["REFUNDED", "PAID", "PENDING", "FAILED", "CANCELLED", "EXPIRED"];

/**
 * Credit card through Mercado Pago Checkout Pro: the customer pays on Mercado Pago's page (card data
 * never touches the store), in up to 12 installments. `providerPaymentId` is the checkout
 * (preference) id; the card payment itself is found by the order id (`external_reference`).
 *
 * Notifications of these payments arrive at the PIX webhook (/api/webhooks/mercadopago, the one set
 * in the Mercado Pago panel): the webhook service finds the order through `resolveOrderId`.
 */
export class MercadoPagoCardProvider extends MercadoPagoProvider {
  readonly name: string = "mercadopago_card";
  readonly usesWebhooks = false;
  readonly notifiedVia = "mercadopago";
  readonly minTtlMinutes = 30; // time to type the card data and go through 3DS

  isConfigured(): boolean {
    const e = env();
    return Boolean(e.MERCADOPAGO_ACCESS_TOKEN && e.MERCADOPAGO_WEBHOOK_SECRET);
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (input.currency !== "BRL") throw new ProviderError(this.name, "Mercado Pago card only supports BRL");
    const botUrl = `https://t.me/${env().TELEGRAM_BOT_USERNAME}`;
    const pref = await this.request<MpPreference>(
      "POST",
      "/checkout/preferences",
      {
        items: [{ id: input.orderId, title: input.description.slice(0, 200), quantity: 1, unit_price: input.amountCents / 100, currency_id: "BRL" }],
        external_reference: input.orderId,
        // Credit card only (no boleto, PIX, debit or prepaid cards).
        payment_methods: {
          excluded_payment_types: [{ id: "ticket" }, { id: "bank_transfer" }, { id: "atm" }, { id: "debit_card" }, { id: "prepaid_card" }],
          installments: MAX_INSTALLMENTS,
        },
        // Approved or rejected right away: no "in review" payments for instantly delivered products.
        binary_mode: true,
        expires: true,
        expiration_date_from: mpDate(new Date(Date.now() - 60_000)),
        expiration_date_to: mpDate(input.expiresAt),
        back_urls: { success: botUrl, failure: botUrl, pending: botUrl },
        auto_return: "approved",
        metadata: { order_id: input.orderId, order_number: input.orderNumber },
      },
      input.idempotencyKey,
    );
    return { providerPaymentId: pref.id, status: "PENDING", checkoutUrl: pref.init_point };
  }

  /** Payments made for an order, newest first. */
  private async paymentsOf(orderId: string): Promise<MpPayment[]> {
    const r = await this.request<{ results?: MpPayment[] }>("GET", `/v1/payments/search?external_reference=${encodeURIComponent(orderId)}&sort=date_created&criteria=desc&limit=20`);
    return (r.results ?? []).filter((p) => p.external_reference === orderId);
  }

  async getPaymentStatus(preferenceId: string): Promise<PaymentStatusResult> {
    const pref = await this.request<MpPreference>("GET", `/checkout/preferences/${encodeURIComponent(preferenceId)}`);
    const payments = pref.external_reference ? await this.paymentsOf(pref.external_reference) : [];
    const rank = (p: MpPayment) => STATUS_PRIORITY.indexOf(mapMercadoPagoStatus(p.status));
    const best = [...payments].sort((a, b) => rank(a) - rank(b))[0];
    if (!best) return { providerPaymentId: preferenceId, status: "PENDING" };
    return {
      providerPaymentId: preferenceId,
      // A declined card is not the end: the customer can try another card while the checkout is open.
      status: mapMercadoPagoStatus(best.status) === "FAILED" ? "PENDING" : mapMercadoPagoStatus(best.status),
      amountCents: Math.round(best.transaction_amount * 100),
      currency: best.currency_id,
      country: "BR",
      providerReference: String(best.id), // the card payment (used for refunds)
      paymentMethodDetail: best.payment_method_id ?? null,
      raw: { status: best.status, status_detail: best.status_detail, external_reference: best.external_reference, payment_type: best.payment_type_id },
    };
  }

  async handleWebhook(): Promise<WebhookResult> {
    throw new ProviderError(this.name, "Notifications arrive through the mercadopago webhook");
  }

  async refundPayment(preferenceId: string, ctx: { orderId: string; providerReference?: string | null }): Promise<RefundResult> {
    const paymentId = ctx.providerReference ?? (await this.getPaymentStatus(preferenceId)).providerReference;
    if (!paymentId) throw new ProviderError(this.name, "No card payment found for this order");
    return super.refundPayment(paymentId, ctx);
  }

  /** Closes the checkout so the customer can no longer pay an expired order. */
  async cancelPayment(preferenceId: string): Promise<void> {
    await this.request("PUT", `/checkout/preferences/${encodeURIComponent(preferenceId)}`, { expires: true, expiration_date_to: mpDate(new Date()) });
  }
}
