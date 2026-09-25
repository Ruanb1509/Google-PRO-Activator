import { env } from "@/server/config/env";
import { hmacSha256Hex, safeEqual } from "@/server/common/crypto";
import type { PaymentStatus } from "@/generated/prisma/enums";
import {
  ProviderError,
  WebhookSignatureError,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type PaymentProvider,
  type PaymentStatusResult,
  type RefundResult,
  type WebhookRequest,
  type WebhookResult,
} from "@/server/payments/payment-provider";

const API = "https://api.stripe.com/v1";

interface StripeCheckoutSession {
  id: string;
  status: "open" | "complete" | "expired";
  payment_status: "paid" | "unpaid" | "no_payment_required";
  amount_total: number | null;
  currency: string | null;
  url: string | null;
  payment_intent: string | { id: string; status?: string } | null;
  client_reference_id: string | null;
  customer_details?: { address?: { country?: string | null } | null } | null;
}

interface StripePaymentIntent {
  id: string;
  status: string;
  amount_received: number;
  latest_charge?: { refunded?: boolean; amount_refunded?: number; payment_method_details?: { card?: { country?: string } } } | string | null;
}

/** Encodes nested objects the way Stripe expects (a[b][0][c]=v). */
export function formEncode(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object" && item !== null) parts.push(formEncode(item as Record<string, unknown>, `${key}[${i}]`));
        else parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === "object") {
      parts.push(formEncode(v as Record<string, unknown>, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

/** Verifies the `Stripe-Signature` header ("t=<ts>,v1=<sig>[,v1=...]"): HMAC_SHA256(secret, "<t>.<rawBody>"). */
export function verifyStripeSignature(args: { secret: string; header: string | null; rawBody: string; nowMs?: number; toleranceSec?: number }): boolean {
  if (!args.header) return false;
  let ts: string | undefined;
  const signatures: string[] = [];
  for (const part of args.header.split(",")) {
    const [k, v] = part.trim().split("=");
    if (k === "t") ts = v;
    if (k === "v1" && v) signatures.push(v);
  }
  if (!ts || signatures.length === 0) return false;
  const expected = hmacSha256Hex(args.secret, `${ts}.${args.rawBody}`);
  if (!signatures.some((s) => safeEqual(s, expected))) return false;
  const age = Math.abs((args.nowMs ?? Date.now()) / 1000 - Number(ts));
  return age <= (args.toleranceSec ?? 300);
}

function sessionStatus(s: StripeCheckoutSession): PaymentStatus {
  if (s.status === "complete" && s.payment_status === "paid") return "PAID";
  if (s.status === "expired") return "EXPIRED";
  return "PENDING";
}

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  readonly supportedCurrencies = ["USD", "BRL"] as const;
  readonly minTtlMinutes = 31; // Stripe Checkout sessions must live at least 30 minutes
  readonly usesWebhooks = true;

  isConfigured(): boolean {
    const e = env();
    return Boolean(e.STRIPE_SECRET_KEY && e.STRIPE_WEBHOOK_SECRET);
  }

  private async request<T>(method: "GET" | "POST", path: string, params?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
    const qs = method === "GET" && params ? `?${formEncode(params)}` : "";
    const res = await fetch(`${API}${path}${qs}`, {
      method,
      headers: {
        authorization: `Bearer ${env().STRIPE_SECRET_KEY}`,
        "content-type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      body: method === "POST" && params ? formEncode(params) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) throw new ProviderError(this.name, `HTTP ${res.status} on ${method} ${path}`, res.status, data);
    return data;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const e = env();
    const botUrl = `https://t.me/${e.TELEGRAM_BOT_USERNAME}`;
    const session = await this.request<StripeCheckoutSession>(
      "POST",
      "/checkout/sessions",
      {
        mode: "payment",
        client_reference_id: input.orderId,
        success_url: `${botUrl}?start=paid_${input.orderNumber}`,
        cancel_url: botUrl,
        expires_at: Math.floor(input.expiresAt.getTime() / 1000),
        locale: input.locale === "pt_BR" ? "pt-BR" : "en",
        billing_address_collection: "required", // gives us the payer country (used for reports / BRL rules)
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amountCents,
              product_data: { name: input.description.slice(0, 250) },
            },
          },
        ],
        metadata: { order_id: input.orderId, order_number: input.orderNumber },
        payment_intent_data: { metadata: { order_id: input.orderId, order_number: input.orderNumber } },
      },
      input.idempotencyKey,
    );
    return { providerPaymentId: session.id, status: sessionStatus(session), checkoutUrl: session.url ?? undefined };
  }

  async getPaymentStatus(providerPaymentId: string): Promise<PaymentStatusResult> {
    const s = await this.request<StripeCheckoutSession>("GET", `/checkout/sessions/${encodeURIComponent(providerPaymentId)}`, {
      expand: ["payment_intent", "payment_intent.latest_charge"],
    });
    let status = sessionStatus(s);
    const pi = typeof s.payment_intent === "object" ? (s.payment_intent as StripePaymentIntent | null) : null;
    const charge = pi && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
    if (charge?.refunded) status = "REFUNDED";
    return {
      providerPaymentId: s.id,
      status,
      amountCents: s.amount_total ?? undefined,
      currency: s.currency?.toUpperCase(),
      country: s.customer_details?.address?.country ?? charge?.payment_method_details?.card?.country ?? null,
      providerReference: pi?.id ?? (typeof s.payment_intent === "string" ? s.payment_intent : null),
      paymentMethodDetail: "card",
      raw: { status: s.status, payment_status: s.payment_status },
    };
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookResult> {
    const secret = env().STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new WebhookSignatureError("Stripe webhook secret not configured");
    if (!verifyStripeSignature({ secret, header: req.headers.get("stripe-signature"), rawBody: req.rawBody })) {
      throw new WebhookSignatureError();
    }
    const event = JSON.parse(req.rawBody) as { id: string; type: string; data: { object: Record<string, unknown> } };
    const obj = event.data.object;
    const relevantSession = [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
    ].includes(event.type);
    if (relevantSession) {
      return { eventId: event.id, eventType: event.type, providerPaymentId: String(obj.id), payload: event };
    }
    if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
      const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : null;
      return { eventId: event.id, eventType: event.type, providerReference: pi, payload: event };
    }
    return { eventId: event.id, eventType: event.type, ignore: true, payload: { id: event.id, type: event.type } };
  }

  async refundPayment(providerPaymentId: string, ctx: { orderId: string; providerReference?: string | null }): Promise<RefundResult> {
    let paymentIntent = ctx.providerReference;
    if (!paymentIntent) paymentIntent = (await this.getPaymentStatus(providerPaymentId)).providerReference ?? null;
    if (!paymentIntent) throw new ProviderError(this.name, "Payment intent not found for refund");
    const r = await this.request<{ id: string; status: string }>("POST", "/refunds", { payment_intent: paymentIntent }, `refund-${ctx.orderId}`);
    return { refundId: r.id, status: r.status === "succeeded" ? "REFUNDED" : "PENDING" };
  }

  async cancelPayment(providerPaymentId: string): Promise<void> {
    await this.request("POST", `/checkout/sessions/${encodeURIComponent(providerPaymentId)}/expire`);
  }
}
