import { z } from "zod";
import { adminRoute, json, paginationSchema, parseQuery } from "@/server/common/http";
import { listDeposits } from "@/server/wallet/deposit.service";

export const dynamic = "force-dynamic";

const schema = paginationSchema.extend({
  status: z.enum(["PENDING", "CONFIRMED", "EXPIRED", "REJECTED"]).optional(),
  userId: z.string().max(40).optional(),
});

export const GET = adminRoute("VIEWER", async ({ req }) => json(await listDeposits(parseQuery(req, schema))));
