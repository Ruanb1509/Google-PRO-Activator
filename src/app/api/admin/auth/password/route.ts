import { z } from "zod";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { changeOwnPassword } from "@/server/auth/admins.service";

export const dynamic = "force-dynamic";

const schema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(12).max(200) });

export const POST = adminRoute("VIEWER", async ({ req, admin, ip }) => {
  const body = await parseBody(req, schema);
  await changeOwnPassword(admin.id, admin.sessionId, body.currentPassword, body.newPassword, ip);
  return json({ ok: true });
});
