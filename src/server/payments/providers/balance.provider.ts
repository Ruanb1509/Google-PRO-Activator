import { db } from "@/server/common/db";
import { hasLedgerEntry, moveBalanceOnce } from "@/server/wallet/ledger.service";
import {
  ProviderError,
  WebhookSignatureError,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type PaymentProvider,
  type PaymentStatusResult,
  type RefundResult,
} from "@/server/payments/payment-provider";

/**
 * Internal provider: pays with store credit (topped up through Binance Pay). The "confirmation" is the
 * atomic ledger debit itself, done by the backend - never by anything the customer claims.
 */
export class BalanceProvider implements PaymentProvider {
  readonly name = "balance";
  readonly supportedCurrencies = ["USD"] as const;
  readonly usesWebhooks = false;

  isConfigured(): boolean {
    return true;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (input.currency !== "USD") throw new ProviderError(this.name, "Balance is kept in USD");
    // Idempotent: a second call for the same order finds the unique (order_id, PURCHASE) entry.
    await moveBalanceOnce({ userId: input.userId, amountCents: -input.amountCents, type: "PURCHASE", orderId: input.orderId, note: `Order #${input.orderNumber}` });
    return { providerPaymentId: `bal_${input.orderId}`, status: "PAID" };
  }

  async getPaymentStatus(providerPaymentId: string): Promise<PaymentStatusResult> {
    const orderId = providerPaymentId.replace(/^bal_/, "");
    const [paid, refunded] = await Promise.all([hasLedgerEntry(orderId, "PURCHASE"), hasLedgerEntry(orderId, "REFUND")]);
    const order = await db().order.findUnique({ where: { id: orderId }, select: { amountCents: true } });
    return {
      providerPaymentId,
      status: refunded ? "REFUNDED" : paid ? "PAID" : "PENDING",
      amountCents: order?.amountCents,
      currency: "USD",
      paymentMethodDetail: "balance",
    };
  }

  async handleWebhook(): Promise<never> {
    throw new WebhookSignatureError("Balance provider does not accept webhooks");
  }

  async refundPayment(providerPaymentId: string, ctx: { orderId: string; amountCents: number }): Promise<RefundResult> {
    const order = await db().order.findUniqueOrThrow({ where: { id: ctx.orderId }, select: { userId: true, number: true } });
    await moveBalanceOnce({ userId: order.userId, amountCents: ctx.amountCents, type: "REFUND", orderId: ctx.orderId, note: `Refund order #${order.number}` });
    return { refundId: `balref_${ctx.orderId}`, status: "REFUNDED" };
  }
}
