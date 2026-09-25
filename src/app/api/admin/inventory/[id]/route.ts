import { z } from "zod";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { getItem, setItemStatus } from "@/server/inventory/inventory.service";

export const dynamic = "force-dynamic";

export const GET = adminRoute("VIEWER", async ({ params }) => json(await getItem(params.id!)));

export const PATCH = adminRoute("STAFF", async ({ req, params, admin, ip }) => {
  const { status } = await parseBody(req, z.object({ status: z.enum(["AVAILABLE", "INVALID", "CANCELLED"]) }));
  await setItemStatus(params.id!, status, admin.id, ip);
  return json(await getItem(params.id!));
});
