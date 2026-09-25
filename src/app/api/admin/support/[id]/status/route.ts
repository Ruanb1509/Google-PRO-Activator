import { z } from "zod";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { getTicket, setTicketStatus } from "@/server/support/support.service";

export const dynamic = "force-dynamic";

/** Close or reopen a ticket. */
export const POST = adminRoute("STAFF", async ({ req, params, admin, ip }) => {
  const { status } = await parseBody(req, z.object({ status: z.enum(["OPEN", "CLOSED"]) }));
  await setTicketStatus(params.id!, status, admin.id, ip);
  return json({ ticket: await getTicket(params.id!) });
});
