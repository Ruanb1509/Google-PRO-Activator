import { z } from "zod";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { Errors } from "@/server/common/errors";
import { getTicket, MAX_MESSAGE_LENGTH, MAX_REPLY_IMAGE_BYTES, replyToTicket, type ReplyImage } from "@/server/support/support.service";

export const dynamic = "force-dynamic";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
// JPEG FFD8FF, PNG 89504E47, WebP "RIFF....WEBP"
const MAGIC: Record<ReplyImage["contentType"], (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 4).toString("hex") === "89504e47",
  "image/webp": (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
};

/** Reply to the customer (text and/or one image); the message is delivered in the bot. */
export const POST = adminRoute("STAFF", async ({ req, params, admin, ip }) => {
  const body = await parseBody(
    req,
    z.object({
      text: z.string().trim().max(MAX_MESSAGE_LENGTH).default(""),
      image: z.object({ contentType: z.enum(IMAGE_TYPES), base64: z.string().min(1).max(Math.ceil(MAX_REPLY_IMAGE_BYTES / 3) * 4 + 4) }).optional(),
    }),
  );
  let image: ReplyImage | undefined;
  if (body.image) {
    const data = Buffer.from(body.image.base64, "base64");
    if (!data.length || data.length > MAX_REPLY_IMAGE_BYTES || !MAGIC[body.image.contentType](data)) throw Errors.badRequest("Imagem inválida ou maior que 3 MB");
    image = { data, contentType: body.image.contentType };
  }
  if (!body.text && !image) throw Errors.badRequest("Escreva uma mensagem ou anexe uma imagem");
  const delivery = await replyToTicket(params.id!, admin.id, body.text, ip, image);
  return json({ delivery, ticket: await getTicket(params.id!) });
});
