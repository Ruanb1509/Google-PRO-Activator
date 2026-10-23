import { z } from "zod";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { Errors } from "@/server/common/errors";
import { decodeImageUpload, imageUploadSchema } from "@/server/common/image-upload";
import { getTicket, MAX_MESSAGE_LENGTH, replyToTicket } from "@/server/support/support.service";

export const dynamic = "force-dynamic";

/** Reply to the customer (text and/or one image); the message is delivered in the bot. */
export const POST = adminRoute("STAFF", async ({ req, params, admin, ip }) => {
  const body = await parseBody(
    req,
    z.object({
      text: z.string().trim().max(MAX_MESSAGE_LENGTH).default(""),
      image: imageUploadSchema.optional(),
    }),
  );
  const image = body.image ? decodeImageUpload(body.image) : undefined;
  if (!body.text && !image) throw Errors.badRequest("Escreva uma mensagem ou anexe uma imagem");
  const delivery = await replyToTicket(params.id!, admin.id, body.text, ip, image);
  return json({ delivery, ticket: await getTicket(params.id!) });
});
