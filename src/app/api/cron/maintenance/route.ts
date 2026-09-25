import { env } from "@/server/config/env";
import { safeEqual } from "@/server/common/crypto";
import { Errors } from "@/server/common/errors";
import { json, route } from "@/server/common/http";
import { runMaintenance } from "@/server/admin/maintenance.service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Called by Vercel Cron with `Authorization: Bearer <CRON_SECRET>`. */
export const GET = route(async ({ req }) => {
  const given = req.headers.get("authorization") ?? "";
  if (!safeEqual(given, `Bearer ${env().CRON_SECRET}`)) throw Errors.unauthorized();
  return json(await runMaintenance());
});
