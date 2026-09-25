import { z } from "zod";
import { adminRoute, json, paginationSchema, parseQuery } from "@/server/common/http";
import { listCustomers } from "@/server/users/users.service";

export const dynamic = "force-dynamic";

const schema = paginationSchema.extend({ q: z.string().max(100).optional() });

export const GET = adminRoute("VIEWER", async ({ req }) => json(await listCustomers(parseQuery(req, schema))));
