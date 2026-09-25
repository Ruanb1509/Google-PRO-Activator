import type { AdminRole } from "@/generated/prisma/enums";

const rank: Record<AdminRole, number> = { VIEWER: 1, STAFF: 2, ADMIN: 3 };

/** ADMIN > STAFF > VIEWER */
export function hasRole(actual: AdminRole, required: AdminRole): boolean {
  return rank[actual] >= rank[required];
}
