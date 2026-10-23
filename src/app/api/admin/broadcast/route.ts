import { after } from "next/server";
import { z } from "zod";
import { adminRoute, json, parseBody } from "@/server/common/http";
import { decodeImageUpload, imageUploadSchema } from "@/server/common/image-upload";
import { logger } from "@/server/common/logger";
import { broadcastPreview, MAX_BROADCAST_LENGTH, startBroadcast } from "@/server/notifications/broadcast.service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** How many customers would get a general announcement (by language). */
export const GET = adminRoute("ADMIN", async () => json(await broadcastPreview()));

/** Sends the announcement to every customer (in the background; admins get a summary alert at the end). */
export const POST = adminRoute("ADMIN", async ({ req, admin, ip }) => {
  const body = await parseBody(
    req,
    z.object({
      textPt: z.string().trim().min(1).max(MAX_BROADCAST_LENGTH),
      textEn: z.string().trim().max(MAX_BROADCAST_LENGTH).optional(),
      image: imageUploadSchema.optional(),
    }),
  );
  const image = body.image ? decodeImageUpload(body.image) : undefined;
  const { recipients, run } = await startBroadcast({ textPt: body.textPt, textEn: body.textEn, image }, { adminId: admin.id, ip });
  after(() => run().catch((err) => logger.error("broadcast.failed", { err })));
  return json({ recipients });
});
