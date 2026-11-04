import { z } from "zod";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { Errors } from "@/server/common/errors";
import { decodeImageUpload, imageUploadSchema } from "@/server/common/image-upload";
import { MAX_MESSAGE_LENGTH, sendCustomerNotice, startConversation } from "@/server/support/support.service";

export const dynamic = "force-dynamic";

/**
 * Admin writes to a customer first: `chat` starts (or continues) a support ticket the customer can answer,
 * `notice` is a one-off message in the bot.
 */
export const POST = adminRoute("STAFF", async ({ req, params, admin, ip }) => {
  const body = await parseBody(
    req,
    z.object({
      mode: z.enum(["chat", "notice"]),
      text: z.string().trim().max(MAX_MESSAGE_LENGTH).default(""),
      image: imageUploadSchema.optional(),
    }),
  );
  const image = body.image ? decodeImageUpload(body.image) : undefined;
  if (!body.text && !image) throw Errors.badRequest("Escreva uma mensagem ou anexe uma imagem");
  if (body.mode === "notice") {
    await sendCustomerNotice(params.id!, admin.id, body.text, ip, image);
    return json({ ok: true });
  }
  return json(await startConversation(params.id!, admin.id, body.text, ip, image));
});
