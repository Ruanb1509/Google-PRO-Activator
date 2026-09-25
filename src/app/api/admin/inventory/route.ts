import { z } from "zod";
import { adminRoute, json, paginationSchema, parseBody, parseQuery } from "@/server/common/http";
import { addItems, listItems, removeItems } from "@/server/inventory/inventory.service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const listSchema = paginationSchema.extend({
  productId: z.string().max(40).optional(),
  status: z.enum(["AVAILABLE", "RESERVED", "SOLD", "INVALID", "CANCELLED"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().max(2048).optional(),
});

export const GET = adminRoute("VIEWER", async ({ req }) => json(await listItems(parseQuery(req, listSchema))));

const addSchema = z.object({
  productId: z.string().min(1).max(40),
  text: z.string().min(1).max(3_000_000),
  csv: z.boolean().optional(),
});

/** Bulk add: textarea (one per line) or the content of a TXT/CSV file read by the dashboard. */
export const POST = adminRoute("STAFF", async ({ req, admin, ip }) => {
  const body = await parseBody(req, addSchema);
  return json(await addItems(body, admin.id, ip), { status: 201 });
});

export const DELETE = adminRoute("STAFF", async ({ req, admin, ip }) => {
  const { ids } = await parseBody(req, z.object({ ids: z.array(z.string().max(40)).min(1).max(1000) }));
  return json({ removed: await removeItems(ids, admin.id, ip) });
});
