import { z } from "zod";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { adjustBalance } from "@/server/wallet/deposit.service";

export const dynamic = "force-dynamic";

/** Manual credit (+) / debit (-) of store credit, in USD cents. */
export const POST = adminRoute("ADMIN", async ({ req, params, admin, ip }) => {
  const body = await parseBody(req, z.object({ amountCents: z.number().int().min(-10_000_000).max(10_000_000), note: z.string().trim().min(3).max(300) }));
  return json(await adjustBalance(params.id!, body.amountCents, body.note, admin.id, ip));
});
