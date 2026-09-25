import { adminRoute } from "@/server/common/http";
import { Errors } from "@/server/common/errors";
import { fetchMessageImage } from "@/server/support/support.service";

export const dynamic = "force-dynamic";

/** Screenshot sent by the customer, proxied from Telegram (admins only; the bot token stays on the server). */
export const GET = adminRoute("VIEWER", async ({ params }) => {
  const img = await fetchMessageImage(params.messageId!);
  if (!img) throw Errors.notFound("Image");
  return new Response(img.body, {
    headers: { "content-type": img.contentType, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" },
  });
});
