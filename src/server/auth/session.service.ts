import { db } from "@/server/common/db";
import { decrypt, keyedHash, randomToken } from "@/server/common/crypto";
import { Errors } from "@/server/common/errors";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { DUMMY_HASH, verifyPassword } from "@/server/auth/password";
import { verifyTotp } from "@/server/auth/totp";
import type { AdminRole } from "@/generated/prisma/enums";

export const SESSION_COOKIE = "sid";
export const CSRF_COOKIE = "csrf";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const LOCK_MS = 15 * 60 * 1000;

export interface AdminPrincipal {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  totpEnabled: boolean;
  sessionId: string;
}

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; admin: Omit<AdminPrincipal, "sessionId"> }
  | { ok: false; requires2fa: true };

export async function login(input: {
  email: string;
  password: string;
  totp?: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const admin = await db().admin.findUnique({ where: { email } });
  const fail = async (reason: string) => {
    await audit({
      actorType: "ADMIN",
      adminId: admin?.id,
      action: AuditActions.LOGIN_FAILED,
      resourceType: "admin",
      resourceId: admin?.id,
      ip: input.ip,
      details: { email, reason },
    });
    return Errors.unauthorized("E-mail ou senha inválidos");
  };

  if (!admin || !admin.isActive) {
    await verifyPassword(input.password, DUMMY_HASH); // keep timing similar
    throw await fail("unknown_or_inactive");
  }
  if (admin.lockedUntil && admin.lockedUntil > new Date()) throw await fail("locked");

  if (!(await verifyPassword(input.password, admin.passwordHash))) {
    const failed = admin.failedLogins + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await db().admin.update({
      where: { id: admin.id },
      data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : null },
    });
    throw await fail("bad_password");
  }

  if (admin.totpEnabled && admin.totpSecretEnc) {
    if (!input.totp) return { ok: false, requires2fa: true };
    if (!verifyTotp(decrypt(admin.totpSecretEnc), input.totp)) throw await fail("bad_totp");
  }

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db().$transaction([
    db().adminSession.create({
      data: { adminId: admin.id, tokenHash: keyedHash(token), ip: input.ip, userAgent: input.userAgent?.slice(0, 300), expiresAt },
    }),
    db().admin.update({ where: { id: admin.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } }),
  ]);
  await audit({ actorType: "ADMIN", adminId: admin.id, action: AuditActions.LOGIN, resourceType: "admin", resourceId: admin.id, ip: input.ip });
  return {
    ok: true,
    token,
    expiresAt,
    admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role, totpEnabled: admin.totpEnabled },
  };
}

export async function resolveSession(token: string | undefined): Promise<AdminPrincipal | null> {
  if (!token || token.length > 200) return null;
  const session = await db().adminSession.findUnique({ where: { tokenHash: keyedHash(token) }, include: { admin: true } });
  if (!session || session.expiresAt < new Date() || !session.admin.isActive) return null;
  const { admin } = session;
  return { id: admin.id, email: admin.email, name: admin.name, role: admin.role, totpEnabled: admin.totpEnabled, sessionId: session.id };
}

export async function logout(sessionId: string): Promise<void> {
  await db().adminSession.deleteMany({ where: { id: sessionId } });
}

export async function revokeAllSessions(adminId: string, exceptSessionId?: string): Promise<void> {
  await db().adminSession.deleteMany({ where: { adminId, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) } });
}

export async function cleanupSessions(): Promise<number> {
  const r = await db().adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return r.count;
}
