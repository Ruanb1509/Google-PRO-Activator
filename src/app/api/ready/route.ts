import { db } from "@/server/common/db";
import { env } from "@/server/config/env";
import { json } from "@/server/common/http";
import { logger } from "@/server/common/logger";

export const dynamic = "force-dynamic";

/** Readiness: configuration is valid and the database answers. */
export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};
  try {
    env();
    checks.config = "ok";
  } catch (err) {
    logger.error("ready.config_invalid", { err });
    checks.config = "fail";
  }
  try {
    await db().$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch (err) {
    logger.error("ready.db_failed", { err });
    checks.database = "fail";
  }
  const ok = Object.values(checks).every((v) => v === "ok");
  return json({ status: ok ? "ready" : "not_ready", checks }, { status: ok ? 200 : 503 });
}
