import { db } from "@/server/common/db";
import { Errors } from "@/server/common/errors";

/**
 * Fixed-window rate limiter stored in Postgres (atomic upsert). Works across serverless instances
 * without Redis. Returns true when the call is allowed.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const rows = await db().$queryRaw<{ count: number }[]>`
    INSERT INTO rate_limits (key, count, window_start)
    VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) THEN now() ELSE rate_limits.window_start END
    RETURNING count`;
  return (rows[0]?.count ?? 0) <= limit;
}

export async function enforceRateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  if (!(await rateLimit(key, limit, windowSeconds))) throw Errors.rateLimited();
}

export async function cleanupRateLimits(): Promise<number> {
  return db().$executeRaw`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`;
}
