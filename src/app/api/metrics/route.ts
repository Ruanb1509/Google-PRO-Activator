import { env } from "@/server/config/env";
import { safeEqual } from "@/server/common/crypto";
import { Errors } from "@/server/common/errors";
import { json, route } from "@/server/common/http";
import { operationalMetrics } from "@/server/admin/stats.service";

export const dynamic = "force-dynamic";

/** Basic metrics for monitoring. Requires `Authorization: Bearer <METRICS_TOKEN>`. */
export const GET = route(async ({ req }) => {
  const token = env().METRICS_TOKEN;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || !safeEqual(given, token)) throw Errors.unauthorized();
  return json(await operationalMetrics());
});
