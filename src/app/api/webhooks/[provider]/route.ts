import { after } from "next/server";
import { json, route } from "@/server/common/http";
import { processWebhook } from "@/server/webhooks/webhook.service";
import { maybeRunMaintenance } from "@/server/admin/maintenance.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Payment provider webhooks: /api/webhooks/mercadopago, /api/webhooks/stripe, /api/webhooks/mock */
export const POST = route(async ({ req, params, ip }) => {
  const provider = (params.provider ?? "").toLowerCase();
  const res = await processWebhook(provider, req, ip);
  after(() => maybeRunMaintenance());
  return json(res.body, { status: res.status });
});
