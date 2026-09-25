import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/common/db";
import { isUniqueViolation } from "@/server/common/errors";
import { logger } from "@/server/common/logger";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { findProvider } from "@/server/payments/registry";
import { WebhookSignatureError } from "@/server/payments/payment-provider";
import { applyPaymentStatus } from "@/server/orders/payment-lifecycle.service";

export interface WebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Pipeline for every payment webhook:
 *  1. verify signature (provider adapter)       -> 401 when invalid
 *  2. record event, unique (provider, event_id)  -> duplicates are acknowledged and ignored
 *  3. fetch the AUTHORITATIVE status from the provider API (payload content is never trusted)
 *  4. apply it transactionally (idempotent), then deliver
 */
export async function processWebhook(providerName: string, req: Request, ip: string | null): Promise<WebhookResponse> {
  const provider = findProvider(providerName);
  if (!provider || !provider.usesWebhooks) return { status: 404, body: { error: "unknown provider" } };

  const rawBody = await req.text();
  if (rawBody.length > 1_000_000) return { status: 413, body: { error: "payload too large" } };

  let wh;
  try {
    wh = await provider.handleWebhook({ headers: req.headers, rawBody, url: new URL(req.url) });
  } catch (err) {
    if (err instanceof WebhookSignatureError || err instanceof SyntaxError) {
      logger.warn("webhook.rejected", { provider: providerName, reason: err.message, ip });
      await audit({ actorType: "WEBHOOK", action: AuditActions.WEBHOOK_REJECTED, resourceType: "provider", resourceId: providerName, ip, details: { reason: err.message } });
      return { status: 401, body: { error: "invalid signature" } };
    }
    throw err;
  }

  // 2) Dedupe. If a previous delivery of the same event crashed before finishing, process it again.
  let event;
  try {
    event = await db().paymentEvent.create({
      data: { provider: providerName, eventId: wh.eventId, eventType: wh.eventType, signatureValid: true, payload: wh.payload as Prisma.InputJsonValue },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    event = await db().paymentEvent.findUniqueOrThrow({ where: { provider_eventId: { provider: providerName, eventId: wh.eventId } } });
    if (event.processedAt) return { status: 200, body: { ok: true, duplicate: true } };
  }

  await audit({ actorType: "WEBHOOK", action: AuditActions.WEBHOOK_RECEIVED, resourceType: "payment_event", resourceId: event.id, ip, details: { provider: providerName, eventType: wh.eventType } });

  if (wh.ignore) {
    await db().paymentEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return { status: 200, body: { ok: true, ignored: true } };
  }

  const payment = wh.providerPaymentId
    ? await db().payment.findFirst({ where: { provider: providerName, providerPaymentId: wh.providerPaymentId } })
    : wh.providerReference
      ? await db().payment.findFirst({ where: { provider: providerName, providerReference: wh.providerReference } })
      : null;

  if (!payment?.providerPaymentId) {
    await db().paymentEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), error: "payment_not_found" } });
    return { status: 200, body: { ok: true, unknownPayment: true } };
  }

  try {
    const status = await provider.getPaymentStatus(payment.providerPaymentId);
    const outcome = await applyPaymentStatus(payment.id, status, { actorType: "WEBHOOK" });
    await db().paymentEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), paymentId: payment.id, error: null } });
    return { status: 200, body: { ok: true, result: outcome.kind } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("webhook.processing_failed", { err, provider: providerName, eventId: wh.eventId });
    await db().paymentEvent.update({ where: { id: event.id }, data: { paymentId: payment.id, error: message.slice(0, 500) } });
    // 500 => the provider retries later; reprocessing is safe (idempotent).
    return { status: 500, body: { error: "processing failed" } };
  }
}

export async function listWebhookEvents(f: { provider?: string; onlyErrors?: boolean; page: number; pageSize: number }) {
  const where: Prisma.PaymentEventWhereInput = {
    ...(f.provider ? { provider: f.provider } : {}),
    ...(f.onlyErrors ? { OR: [{ error: { not: null } }, { processedAt: null }] } : {}),
  };
  const [total, items] = await Promise.all([
    db().paymentEvent.count({ where }),
    db().paymentEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      select: {
        id: true,
        provider: true,
        eventId: true,
        eventType: true,
        signatureValid: true,
        processedAt: true,
        error: true,
        createdAt: true,
        payment: { select: { orderId: true, order: { select: { number: true } } } },
      },
    }),
  ]);
  return { total, page: f.page, pageSize: f.pageSize, items };
}
