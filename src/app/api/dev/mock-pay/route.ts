import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/server/common/db";
import { mockPaymentsEnabled } from "@/server/config/env";
import { Errors } from "@/server/common/errors";
import { route } from "@/server/common/http";
import { escapeHtml } from "@/i18n";
import { MockProvider } from "@/server/payments/providers/mock.provider";
import { processWebhook } from "@/server/webhooks/webhook.service";

export const dynamic = "force-dynamic";

/**
 * DEV ONLY - simulated checkout page of the mock gateway. Approving changes the "remote" state and
 * then sends an HMAC-signed webhook through the exact same pipeline used by real providers.
 */
async function loadPayment(id: string | null) {
  if (!mockPaymentsEnabled()) throw Errors.notFound();
  if (!id) throw Errors.badRequest("missing id");
  const payment = await db().payment.findFirst({ where: { provider: "mock", providerPaymentId: id }, include: { order: true } });
  if (!payment) throw Errors.notFound("Payment");
  return payment;
}

export const GET = route(async ({ req }) => {
  const payment = await loadPayment(req.nextUrl.searchParams.get("id"));
  const amount = `${(payment.amountCents / 100).toFixed(2)} ${payment.currency}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock checkout</title>
<style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;margin:0}main{background:#1e293b;padding:24px;border-radius:12px;max-width:360px;width:calc(100% - 32px)}button{width:100%;padding:12px;margin-top:8px;border:0;border-radius:8px;font-size:16px;cursor:pointer}.ok{background:#22c55e}.ko{background:#ef4444;color:#fff}small{color:#94a3b8}</style></head>
<body><main><h2>🧪 Mock checkout</h2><p>Order <b>#${payment.order.number}</b><br>${escapeHtml(payment.order.productName)}<br><b>${amount}</b></p>
<p>Status: <b>${escapeHtml(((payment.metadata as { mockStatus?: string } | null)?.mockStatus ?? "PENDING"))}</b></p>
<form method="post"><input type="hidden" name="id" value="${escapeHtml(payment.providerPaymentId ?? "")}">
<button class="ok" name="action" value="PAID">Aprovar pagamento</button>
<button class="ko" name="action" value="FAILED">Recusar pagamento</button></form>
<small>Disponível apenas com PAYMENTS_MOCK_ENABLED=true fora de produção.</small></main></body></html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
});

export const POST = route(async ({ req, ip }) => {
  const form = await req.formData();
  const payment = await loadPayment(String(form.get("id") ?? ""));
  const action = String(form.get("action")) === "PAID" ? "PAID" : "FAILED";
  await db().payment.update({
    where: { id: payment.id },
    data: { metadata: { ...((payment.metadata as object) ?? {}), mockStatus: action, mockCountry: payment.currency === "BRL" ? "BR" : "US" } },
  });

  const body = JSON.stringify({ eventId: randomUUID(), type: `payment.${action.toLowerCase()}`, paymentId: payment.providerPaymentId });
  const webhookReq = new Request(new URL("/api/webhooks/mock", req.url), {
    method: "POST",
    headers: { "content-type": "application/json", "x-mock-signature": MockProvider.sign(body) },
    body,
  });
  const res = await processWebhook("mock", webhookReq, ip);
  return NextResponse.redirect(new URL(`/api/dev/mock-pay?id=${encodeURIComponent(payment.providerPaymentId ?? "")}&r=${res.status}`, req.url), 303);
});
