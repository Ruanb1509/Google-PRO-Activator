import { z } from "zod";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { createAdmin, listAdmins } from "@/server/auth/admins.service";

export const dynamic = "force-dynamic";

export const GET = adminRoute("ADMIN", async () => json({ items: await listAdmins() }));

const schema = z.object({
  email: z.email().max(200),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(12).max(200),
  role: z.enum(["ADMIN", "STAFF", "VIEWER"]),
});

export const POST = adminRoute("ADMIN", async ({ req, admin, ip }) => {
  const body = await parseBody(req, schema);
  return json(await createAdmin(body, { adminId: admin.id, ip }), { status: 201 });
});
