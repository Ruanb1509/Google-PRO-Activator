import { z } from "zod";
import { Errors } from "@/server/common/errors";

/** Image uploaded from the dashboard (decoded from base64) to be sent in the bot. */
export interface UploadedImage {
  data: Buffer;
  contentType: "image/jpeg" | "image/png" | "image/webp";
}

export const MAX_UPLOAD_IMAGE_BYTES = 3 * 1024 * 1024;
/** Telegram's photo caption cap. */
export const CAPTION_LIMIT = 1024;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
// JPEG FFD8FF, PNG 89504E47, WebP "RIFF....WEBP"
const MAGIC: Record<UploadedImage["contentType"], (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 4).toString("hex") === "89504e47",
  "image/webp": (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
};

export const imageUploadSchema = z.object({
  contentType: z.enum(IMAGE_TYPES),
  base64: z.string().min(1).max(Math.ceil(MAX_UPLOAD_IMAGE_BYTES / 3) * 4 + 4),
});

/** Decodes and checks the upload (size and file signature, not just the declared type). */
export function decodeImageUpload(upload: z.infer<typeof imageUploadSchema>): UploadedImage {
  const data = Buffer.from(upload.base64, "base64");
  if (!data.length || data.length > MAX_UPLOAD_IMAGE_BYTES || !MAGIC[upload.contentType](data)) throw Errors.badRequest("Imagem inválida ou maior que 3 MB");
  return { data, contentType: upload.contentType };
}
