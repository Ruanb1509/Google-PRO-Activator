import QRCode from "qrcode";
import type { AdminRole } from "@/generated/prisma/enums";
import { db } from "@/server/common/db";
import { decrypt, encrypt } from "@/server/common/crypto";
import { AppError, Errors, isUniqueViolation } from "@/server/common/errors";
import { audit, AuditActions } from "@/server/audit/audit.service";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/server/auth/password";
import { generateTotpSecret, otpauthUrl, verifyTotp } from "@/server/auth/totp";
import { revokeAllSessions } from "@/server/auth/session.service";

const publicSelect = { id: true, email: true, name: true, role: true, isActive: true, totpEnabled: true, lastLoginAt: true, createdAt: true } as const;

export async function listAdmins() {
  return db().admin.findMany({ select: publicSelect, orderBy: { createdAt: "asc" } });
}

export async function createAdmin(input: { email: string; name: string; password: string; role: AdminRole }, actor?: { adminId: string; ip: string | null }) {
  const weak = validatePasswordStrength(input.password);
  if (weak) throw Errors.badRequest(weak, "WEAK_PASSWORD");
  try {
    const admin = await db().admin.create({
      data: { email: input.email.trim().toLowerCase(), name: input.name.trim(), role: input.role, passwordHash: await hashPassword(input.password) },
      select: publicSelect,
    });
    await audit({ actorType: actor ? "ADMIN" : "SYSTEM", adminId: actor?.adminId, ip: actor?.ip, action: AuditActions.ADMIN_CREATED, resourceType: "admin", resourceId: admin.id, details: { email: admin.email, role: admin.role } });
    return admin;
  } catch (err) {
    if (isUniqueViolation(err)) throw Errors.conflict("E-mail já cadastrado");
    throw err;
  }
}

export async function updateAdmin(id: string, input: { name?: string; role?: AdminRole; isActive?: boolean; password?: string }, actor: { adminId: string; ip: string | null }) {
  if (id === actor.adminId && (input.role || input.isActive === false)) throw Errors.badRequest("Você não pode alterar seu próprio papel ou se desativar");
  if (input.password) {
    const weak = validatePasswordStrength(input.password);
    if (weak) throw Errors.badRequest(weak, "WEAK_PASSWORD");
  }
  const admin = await db().admin.update({
    where: { id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.role ? { role: input.role } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.password ? { passwordHash: await hashPassword(input.password), failedLogins: 0, lockedUntil: null } : {}),
    },
    select: publicSelect,
  });
  if (input.password || input.isActive === false || input.role) await revokeAllSessions(id);
  await audit({ actorType: "ADMIN", adminId: actor.adminId, ip: actor.ip, action: AuditActions.ADMIN_UPDATED, resourceType: "admin", resourceId: id, details: { ...input, password: input.password ? "[changed]" : undefined } });
  return admin;
}

export async function changeOwnPassword(adminId: string, sessionId: string, current: string, next: string, ip: string | null) {
  const admin = await db().admin.findUniqueOrThrow({ where: { id: adminId } });
  if (!(await verifyPassword(current, admin.passwordHash))) throw Errors.badRequest("Senha atual incorreta", "BAD_PASSWORD");
  const weak = validatePasswordStrength(next);
  if (weak) throw Errors.badRequest(weak, "WEAK_PASSWORD");
  await db().admin.update({ where: { id: adminId }, data: { passwordHash: await hashPassword(next) } });
  await revokeAllSessions(adminId, sessionId);
  await audit({ actorType: "ADMIN", adminId, ip, action: AuditActions.PASSWORD_CHANGED, resourceType: "admin", resourceId: adminId });
}

/** Step 1: generate a secret (stored encrypted, not yet enabled) and return the QR code. */
export async function setupTwoFactor(adminId: string) {
  const admin = await db().admin.findUniqueOrThrow({ where: { id: adminId } });
  if (admin.totpEnabled) throw Errors.conflict("2FA já está ativo");
  const secret = generateTotpSecret();
  await db().admin.update({ where: { id: adminId }, data: { totpSecretEnc: encrypt(secret) } });
  const url = otpauthUrl(secret, admin.email, "Telegram Store");
  return { secret, otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 220 }) };
}

/** Step 2: confirm with a valid code. */
export async function enableTwoFactor(adminId: string, code: string, ip: string | null) {
  const admin = await db().admin.findUniqueOrThrow({ where: { id: adminId } });
  if (!admin.totpSecretEnc) throw Errors.badRequest("Gere o QR code primeiro");
  if (!verifyTotp(decrypt(admin.totpSecretEnc), code)) throw new AppError("INVALID_CODE", "Código inválido", 400);
  await db().admin.update({ where: { id: adminId }, data: { totpEnabled: true } });
  await audit({ actorType: "ADMIN", adminId, ip, action: AuditActions.TWO_FACTOR_ENABLED, resourceType: "admin", resourceId: adminId });
}

export async function disableTwoFactor(adminId: string, code: string, ip: string | null) {
  const admin = await db().admin.findUniqueOrThrow({ where: { id: adminId } });
  if (!admin.totpEnabled || !admin.totpSecretEnc) throw Errors.badRequest("2FA não está ativo");
  if (!verifyTotp(decrypt(admin.totpSecretEnc), code)) throw new AppError("INVALID_CODE", "Código inválido", 400);
  await db().admin.update({ where: { id: adminId }, data: { totpEnabled: false, totpSecretEnc: null } });
  await audit({ actorType: "ADMIN", adminId, ip, action: AuditActions.TWO_FACTOR_DISABLED, resourceType: "admin", resourceId: adminId });
}
