import { z } from "zod";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { getCustomer, setBlocked } from "@/server/users/users.service";
import { getOpenTicket } from "@/server/support/support.service";

export const dynamic = "force-dynamic";

export const GET = adminRoute("VIEWER", async ({ params }) => {
  const { botState: _botState, ...customer } = await getCustomer(params.id!);
  const ticket = await getOpenTicket(customer.id);
  return json({ ...customer, openTicket: ticket ? { id: ticket.id, number: ticket.number, status: ticket.status } : null });
});

export const PATCH = adminRoute("STAFF", async ({ req, params, admin, ip }) => {
  const { isBlocked } = await parseBody(req, z.object({ isBlocked: z.boolean() }));
  await setBlocked(params.id!, isBlocked);
  await audit({ actorType: "ADMIN", adminId: admin.id, ip, action: AuditActions.CUSTOMER_UPDATED, resourceType: "user", resourceId: params.id, details: { isBlocked } });
  return json({ ok: true });
});
