import { adminRoute, json } from "@/server/common/http";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { CSRF_COOKIE, logout, SESSION_COOKIE } from "@/server/auth/session.service";

export const dynamic = "force-dynamic";

export const POST = adminRoute("VIEWER", async ({ admin, ip }) => {
  await logout(admin.sessionId);
  await audit({ actorType: "ADMIN", adminId: admin.id, ip, action: AuditActions.LOGOUT, resourceType: "admin", resourceId: admin.id });
  const res = json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(CSRF_COOKIE);
  return res;
});
