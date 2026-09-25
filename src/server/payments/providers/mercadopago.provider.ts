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

const API = "https://api.mercadopago.com";

interface MpPayment {
  id: number;
  status: string;
  status_detail?: string;
  transaction_amount: number;
  currency_id: string;
  external_reference?: string;
  payment_method_id?: string;
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } };
}

/** Mercado Pago -> internal status */
export function mapMercadoPagoStatus(status: string): PaymentStatus {
  switch (status) {
    case "approved":
    case "authorized":
      return "PAID";
    case "refunded":
    case "charged_back":
      return "REFUNDED";
    case "cancelled":
      return "CANCELLED";
    case "rejected":
      return "FAILED";
    default:
      return "PENDING"; // pending, in_process, in_mediation
  }
}

/** Mercado Pago expects ISO-8601 with an explicit offset, e.g. 2026-09-24T20:00:00.000-03:00 */
function mpDate(d: Date): string {
  const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return brt.toISOString().replace("Z", "-03:00");
}

/**
 * Verifies the `x-signature` header: "ts=<unix>,v1=<hmac>" where
 * hmac = HMAC_SHA256(secret, "id:<data.id>;request-id:<x-request-id>;ts:<ts>;")
 */
export function verifyMercadoPagoSignature(args: { secret: string; xSignature: string | null; xRequestId: string | null; dataId: string | null; nowMs?: number; toleranceSec?: number }): boolean {
  if (!args.xSignature) return false;
  const parts = Object.fromEntries(
    args.xSignature.split(",").map((p) => {
      const [k, ...v] = p.trim().split("=");
      return [k, v.join("=")];
    }),
  );
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return false;
  let manifest = "";
  if (args.dataId) manifest += `id:${/^[a-z0-9]+$/i.test(args.dataId) ? args.dataId.toLowerCase() : args.dataId};`;
  if (args.xRequestId) manifest += `request-id:${args.xRequestId};`;
  manifest += `ts:${ts};`;
  const expected = hmacSha256Hex(args.secret, manifest);
  if (!safeEqual(expected, v1)) return false;
  // Replay protection (ts may be in seconds or milliseconds).
  const tsMs = ts.length > 11 ? Number(ts) : Number(ts) * 1000;
  const tolerance = (args.toleranceSec ?? 600) * 1000;
  return Math.abs((args.nowMs ?? Date.now()) - tsMs) <= tolerance;
}

export class MercadoPagoProvider implements PaymentProvider {
  readonly name = "mercadopago";
  readonly supportedCurrencies = ["BRL"] as const;
  readonly usesWebhooks = true;

  isConfigured(): boolean {
    const e = env();
    return Boolean(e.MERCADOPAGO_ACCESS_TOKEN && e.MERCADOPAGO_WEBHOOK_SECRET && e.MERCADOPAGO_PAYER_EMAIL);
  }

  private async request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${env().MERCADOPAGO_ACCESS_TOKEN}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) throw new ProviderError(this.name, `HTTP ${res.status} on ${method} ${path}`, res.status, data);
    return data;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    if (input.currency !== "BRL") throw new ProviderError(this.name, "PIX only supports BRL");
    const e = env();
    const payment = await this.request<MpPayment>(
      "POST",
      "/v1/payments",
      {
        transaction_amount: input.amountCents / 100,
        description: input.description.slice(0, 200),
        payment_method_id: "pix",
        external_reference: input.orderId,
        // No per-payment notification_url: notifications come from the webhook configured in the
        // Mercado Pago panel (/api/webhooks/mercadopago), which is signed with the secret key.
        date_of_expiration: mpDate(input.expiresAt),
        // Minimal payer data: a store-controlled e-mail, no customer personal data is sent.
        payer: { email: e.MERCADOPAGO_PAYER_EMAIL },
        metadata: { order_id: input.orderId, order_number: input.orderNumber },
      },
      input.idempotencyKey,
    );
    const tx = payment.point_of_interaction?.transaction_data;
    return {
      providerPaymentId: String(payment.id),
      status: mapMercadoPagoStatus(payment.status),
      pixCopyPaste: tx?.qr_code,
      pixQrBase64: tx?.qr_code_base64,
      checkoutUrl: tx?.ticket_url,
      metadata: { statusDetail: payment.status_detail },
    };
  }

  async getPaymentStatus(providerPaymentId: string): Promise<PaymentStatusResult> {
    const p = await this.request<MpPayment>("GET", `/v1/payments/${encodeURIComponent(providerPaymentId)}`);
    return {
      providerPaymentId: String(p.id),
      status: mapMercadoPagoStatus(p.status),
      amountCents: Math.round(p.transaction_amount * 100),
      currency: p.currency_id,
      country: "BR", // PIX is a Brazilian payment rail
      paymentMethodDetail: p.payment_method_id ?? null,
      raw: { status: p.status, status_detail: p.status_detail, external_reference: p.external_reference },
    };
  }

  async handleWebhook(req: WebhookRequest): Promise<WebhookResult> {
    const secret = env().MERCADOPAGO_WEBHOOK_SECRET;
    if (!secret) throw new WebhookSignatureError("Mercado Pago webhook secret not configured");
    let body: { id?: string | number; type?: string; action?: string; data?: { id?: string | number } } = {};
    try {
      body = JSON.parse(req.rawBody || "{}");
    } catch {
      throw new WebhookSignatureError("Malformed body");
    }
    const dataId = req.url.searchParams.get("data.id") ?? (body.data?.id != null ? String(body.data.id) : null);
    const valid = verifyMercadoPagoSignature({
      secret,
      xSignature: req.headers.get("x-signature"),
      xRequestId: req.headers.get("x-request-id"),
      dataId,
    });
    if (!valid) throw new WebhookSignatureError();

    const type = body.type ?? req.url.searchParams.get("type") ?? "unknown";
    const eventId = `${body.id ?? req.headers.get("x-request-id")}:${body.action ?? type}`;
    return {
      eventId,
      eventType: body.action ?? type,
      providerPaymentId: type === "payment" ? dataId : null,
      ignore: type !== "payment",
      payload: body,
    };
  }

  async refundPayment(providerPaymentId: string, ctx: { orderId: string }): Promise<RefundResult> {
    const r = await this.request<{ id: number; status: string }>(
      "POST",
      `/v1/payments/${encodeURIComponent(providerPaymentId)}/refunds`,
      {},
      `refund-${ctx.orderId}`,
    );
    return { refundId: String(r.id), status: r.status === "approved" ? "REFUNDED" : "PENDING" };
  }

  async cancelPayment(providerPaymentId: string): Promise<void> {
    await this.request("PUT", `/v1/payments/${encodeURIComponent(providerPaymentId)}`, { status: "cancelled" });
  }
}
