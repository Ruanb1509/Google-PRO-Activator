import { z } from "zod";
import { adminRoute, json, paginationSchema, parseQuery } from "@/server/common/http";
import { listOrders } from "@/server/orders/orders.service";

export const dynamic = "force-dynamic";

const schema = paginationSchema.extend({
  status: z.enum(["PENDING", "PAID", "DELIVERED", "FAILED", "EXPIRED", "REFUNDED", "CANCELLED"]).optional(),
  delivered: z.enum(["yes", "no"]).optional(),
  productId: z.string().max(40).optional(),
  userId: z.string().max(40).optional(),
  q: z.string().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const GET = adminRoute("VIEWER", async ({ req }) => json(await listOrders(parseQuery(req, schema))));
