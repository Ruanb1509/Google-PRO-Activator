import { z } from "zod";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { getCustomer, setBlocked } from "@/server/users/users.service";

export const dynamic = "force-dynamic";

export const GET = adminRoute("VIEWER", async ({ params }) => {
  const { botState: _botState, ...customer } = await getCustomer(params.id!);
  return json(customer);
});

export const PATCH = adminRoute("STAFF", async ({ req, params, admin, ip }) => {
  const { isBlocked } = await parseBody(req, z.object({ isBlocked: z.boolean() }));
  await setBlocked(params.id!, isBlocked);
  await audit({ actorType: "ADMIN", adminId: admin.id, ip, action: AuditActions.CUSTOMER_UPDATED, resourceType: "user", resourceId: params.id, details: { isBlocked } });
  return json({ ok: true });
});
