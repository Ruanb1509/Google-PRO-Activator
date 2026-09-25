/**
 * Creates (or resets) an administrator.
 *   npm run admin:create -- --email you@example.com --name "Seu Nome" --role ADMIN [--password "..."]
 * Without --password a strong random password is generated and printed once.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { db } from "@/server/common/db";
import { createAdmin } from "@/server/auth/admins.service";
import { hashPassword, validatePasswordStrength } from "@/server/auth/password";
import { revokeAllSessions } from "@/server/auth/session.service";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string", default: "Administrador" },
    role: { type: "string", default: "ADMIN" },
    password: { type: "string" },
    reset: { type: "boolean", default: false },
  },
});

async function main() {
  if (!values.email) throw new Error("--email é obrigatório");
  const role = values.role as "ADMIN" | "STAFF" | "VIEWER";
  if (!["ADMIN", "STAFF", "VIEWER"].includes(role)) throw new Error("--role deve ser ADMIN, STAFF ou VIEWER");
  const generated = !values.password;
  const password = values.password ?? `${randomBytes(12).toString("base64url")}Aa1`;

  const existing = await db().admin.findUnique({ where: { email: values.email.toLowerCase() } });
  if (existing) {
    if (!values.reset) throw new Error("Administrador já existe. Use --reset para redefinir a senha.");
    const weak = validatePasswordStrength(password);
    if (weak) throw new Error(weak);
    await db().admin.update({ where: { id: existing.id }, data: { passwordHash: await hashPassword(password), isActive: true, failedLogins: 0, lockedUntil: null } });
    await revokeAllSessions(existing.id);
    console.log(`Senha redefinida para ${existing.email}`);
  } else {
    const admin = await createAdmin({ email: values.email, name: values.name!, password, role });
    console.log(`Administrador criado: ${admin.email} (${admin.role})`);
  }
  if (generated) console.log(`Senha gerada (guarde agora, não será exibida novamente): ${password}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db().$disconnect());
