import { z } from "zod";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { updateAdmin } from "@/server/auth/admins.service";

export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(["ADMIN", "STAFF", "VIEWER"]).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(12).max(200).optional(),
});

export const PATCH = adminRoute("ADMIN", async ({ req, params, admin, ip }) => {
  const body = await parseBody(req, schema);
  return json(await updateAdmin(params.id!, body, { adminId: admin.id, ip }));
});
