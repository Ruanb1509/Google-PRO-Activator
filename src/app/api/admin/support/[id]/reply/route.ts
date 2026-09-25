import { z } from "zod";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { getTicket, MAX_MESSAGE_LENGTH, replyToTicket } from "@/server/support/support.service";

export const dynamic = "force-dynamic";

/** Reply to the customer; the message is delivered in the bot. */
export const POST = adminRoute("STAFF", async ({ req, params, admin, ip }) => {
  const { text } = await parseBody(req, z.object({ text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) }));
  const delivery = await replyToTicket(params.id!, admin.id, text, ip);
  return json({ delivery, ticket: await getTicket(params.id!) });
});
