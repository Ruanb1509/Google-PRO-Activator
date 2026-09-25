import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError, type ZodType } from "zod";
import { AppError, Errors } from "@/server/common/errors";
import { logger } from "@/server/common/logger";
import { safeEqual } from "@/server/common/crypto";
import { enforceRateLimit } from "@/server/common/rate-limit";
import { CSRF_COOKIE, resolveSession, SESSION_COOKIE, type AdminPrincipal } from "@/server/auth/session.service";
import { hasRole } from "@/server/auth/roles";
import type { AdminRole } from "@/generated/prisma/enums";

export interface RequestContext {
  req: NextRequest;
  params: Record<string, string>;
  ip: string | null;
  requestId: string;
}

export interface AdminContext extends RequestContext {
  admin: AdminPrincipal;
}

type RouteCtx = { params: Promise<Record<string, string | string[]>> };

export function clientIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim().slice(0, 64);
  return req.headers.get("x-real-ip");
}

/** JSON serializer that handles BigInt (Telegram ids) and Dates. */
export function json(data: unknown, init?: ResponseInit): NextResponse {
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, { ...init, headers: { "content-type": "application/json; charset=utf-8", ...init?.headers } });
}

export function errorResponse(err: unknown, requestId: string): NextResponse {
  if (err instanceof AppError) {
    return json({ error: { code: err.code, message: err.message, details: err.details }, requestId }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return json({ error: { code: "VALIDATION_ERROR", message: "Invalid input", details: z.flattenError(err) }, requestId }, { status: 422 });
  }
  logger.error("http.unhandled_error", { err, requestId });
  return json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" }, requestId }, { status: 500 });
}

async function flattenParams(ctx: RouteCtx | undefined): Promise<Record<string, string>> {
  const raw = ctx ? await ctx.params : {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) out[k] = Array.isArray(v) ? v.join("/") : v;
  return out;
}

/** Public route wrapper with global error handling. */
export function route(handler: (ctx: RequestContext) => Promise<Response>) {
  return async (req: NextRequest, ctx?: RouteCtx): Promise<Response> => {
    const requestId = req.headers.get("x-vercel-id") ?? crypto.randomUUID();
    try {
      return await handler({ req, params: await flattenParams(ctx), ip: clientIp(req), requestId });
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Admin route wrapper: session cookie auth, role check, CSRF (double-submit cookie) on mutations,
 * per-admin rate limiting and global error handling.
 */
export function adminRoute(role: AdminRole, handler: (ctx: AdminContext) => Promise<Response>) {
  return route(async (ctx) => {
    const admin = await resolveSession(ctx.req.cookies.get(SESSION_COOKIE)?.value);
    if (!admin) throw Errors.unauthorized();
    if (MUTATING.has(ctx.req.method)) {
      const cookie = ctx.req.cookies.get(CSRF_COOKIE)?.value ?? "";
      const header = ctx.req.headers.get("x-csrf-token") ?? "";
      if (!cookie || !header || !safeEqual(cookie, header)) throw Errors.forbidden("Invalid CSRF token");
      await enforceRateLimit(`admin:${admin.id}:mut`, 120, 60);
    }
    if (!hasRole(admin.role, role)) throw Errors.forbidden();
    return handler({ ...ctx, admin });
  });
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw Errors.badRequest("Invalid JSON body");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw Errors.validation(z.flattenError(parsed.error));
  return parsed.data;
}

export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  const obj = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = schema.safeParse(obj);
  if (!parsed.success) throw Errors.validation(z.flattenError(parsed.error));
  return parsed.data;
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
