import { db } from "@/server/common/db";
import { route } from "@/server/common/http";
import { LOGO_SIZES, renderProductLogo, type LogoSize } from "@/server/products/product-logo";

export const dynamic = "force-dynamic";

const CACHE = "public, max-age=86400, s-maxage=31536000, immutable"; // URLs are versioned (?v=updatedAt)

/** Public product logo as PNG/JPEG/WebP (Telegram only accepts raster photos, not SVG). `?size=100` = emoji size. */
export const GET = route(async ({ req, params }) => {
  const product = await db().product.findFirst({
    where: { id: params.id, deletedAt: null },
    select: { logoKey: true, logoImage: true },
  });
  if (!product) return new Response("Not found", { status: 404 });

  const requested = Number(new URL(req.url).searchParams.get("size") ?? 512);
  const size: LogoSize = LOGO_SIZES.includes(requested as LogoSize) ? (requested as LogoSize) : 512;
  const res = renderProductLogo(product, size);
  if (!res) return new Response("Not found", { status: 404 });
  res.headers.set("cache-control", CACHE);
  res.headers.set("x-content-type-options", "nosniff");
  return res;
});
