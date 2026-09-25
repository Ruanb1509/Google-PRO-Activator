import { z } from "zod";
import { json, parseBody, route } from "@/server/common/http";
import { enforceRateLimit } from "@/server/common/rate-limit";
import { randomToken } from "@/server/common/crypto";
import { isProduction } from "@/server/config/env";
import { CSRF_COOKIE, login, SESSION_COOKIE } from "@/server/auth/session.service";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.email().max(200),
  password: z.string().min(1).max(200),
  totp: z.string().regex(/^\d{6}$/).optional(),
});

export const POST = route(async ({ req, ip }) => {
  const body = await parseBody(req, schema);
  await enforceRateLimit(`login:ip:${ip ?? "unknown"}`, 20, 15 * 60);
  await enforceRateLimit(`login:email:${body.email.toLowerCase()}`, 8, 15 * 60);

  const result = await login({ ...body, ip, userAgent: req.headers.get("user-agent") });
  if (!result.ok) return json({ requires2fa: true }, { status: 401 });

  const res = json({ admin: result.admin });
  const secure = isProduction() || req.nextUrl.protocol === "https:";
  res.cookies.set(SESSION_COOKIE, result.token, { httpOnly: true, secure, sameSite: "strict", path: "/", expires: result.expiresAt });
  // Double-submit CSRF token: readable by the dashboard JS, echoed in the X-CSRF-Token header.
  res.cookies.set(CSRF_COOKIE, randomToken(24), { httpOnly: false, secure, sameSite: "strict", path: "/", expires: result.expiresAt });
  return res;
});
