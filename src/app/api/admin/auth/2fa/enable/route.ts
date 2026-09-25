import { z } from "zod";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { enableTwoFactor } from "@/server/auth/admins.service";

export const dynamic = "force-dynamic";

export const POST = adminRoute("VIEWER", async ({ req, admin, ip }) => {
  const { code } = await parseBody(req, z.object({ code: z.string().regex(/^\d{6}$/) }));
  await enableTwoFactor(admin.id, code, ip);
  return json({ ok: true });
});
