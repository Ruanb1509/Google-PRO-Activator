import { z } from "zod";
import { adminRoute, json, paginationSchema, parseQuery } from "@/server/common/http";
import { listWebhookEvents } from "@/server/webhooks/webhook.service";

export const dynamic = "force-dynamic";

const schema = paginationSchema.extend({
  provider: z.string().max(32).optional(),
  onlyErrors: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
});

export const GET = adminRoute("VIEWER", async ({ req }) => json(await listWebhookEvents(parseQuery(req, schema))));
