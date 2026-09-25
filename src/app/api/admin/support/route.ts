import { z } from "zod";
import { adminRoute, json, paginationSchema, parseQuery } from "@/server/common/http";
import { listTickets } from "@/server/support/support.service";

export const dynamic = "force-dynamic";

const schema = paginationSchema.extend({
  status: z.enum(["OPEN", "ANSWERED", "CLOSED"]).optional(),
  type: z.enum(["PRE_SALE", "POST_SALE"]).optional(),
  q: z.string().max(100).optional(),
});

export const GET = adminRoute("VIEWER", async ({ req }) => json(await listTickets(parseQuery(req, schema))));
