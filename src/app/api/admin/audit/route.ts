import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/common/db";
import { adminRoute, json, paginationSchema, parseQuery } from "@/server/common/http";

export const dynamic = "force-dynamic";

const schema = paginationSchema.extend({
  action: z.string().max(60).optional(),
  adminId: z.string().max(40).optional(),
  resourceType: z.string().max(40).optional(),
  resourceId: z.string().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const GET = adminRoute("VIEWER", async ({ req }) => {
  const f = parseQuery(req, schema);
  const where: Prisma.AuditLogWhereInput = {
    ...(f.action ? { action: { startsWith: f.action } } : {}),
    ...(f.adminId ? { adminId: f.adminId } : {}),
    ...(f.resourceType ? { resourceType: f.resourceType } : {}),
    ...(f.resourceId ? { resourceId: f.resourceId } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
  };
  const [total, items] = await Promise.all([
    db().auditLog.count({ where }),
    db().auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: { admin: { select: { email: true, name: true } } },
    }),
  ]);
  return json({ total, page: f.page, pageSize: f.pageSize, items });
});
