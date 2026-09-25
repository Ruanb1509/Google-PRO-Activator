import { ImageResponse } from "next/og";
import { db } from "@/server/common/db";
import { route } from "@/server/common/http";
import { aiLogoSvg, findAiLogo, logoForeground } from "@/lib/ai-logos";
import { parseLogoDataUrl } from "@/server/products/products.service";

export const dynamic = "force-dynamic";

const CACHE = "public, max-age=86400, s-maxage=31536000, immutable"; // URLs are versioned (?v=updatedAt)

/**
 * Public product logo as PNG/JPEG/WebP (Telegram only accepts raster photos, not SVG).
 * Gallery logos are rendered from their vector path; uploaded images are served as stored.
 */
export const GET = route(async ({ params }) => {
  const product = await db().product.findFirst({
    where: { id: params.id, deletedAt: null },
    select: { logoKey: true, logoImage: true },
  });
  if (!product) return new Response("Not found", { status: 404 });

  if (product.logoImage) {
    const img = parseLogoDataUrl(product.logoImage);
    if (!img) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(img.bytes), {
      headers: { "content-type": img.mime, "cache-control": CACHE, "x-content-type-options": "nosniff" },
    });
  }

  const logo = findAiLogo(product.logoKey);
  if (!logo) return new Response("Not found", { status: 404 });
  const element = logo.path ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`data:image/svg+xml;base64,${Buffer.from(aiLogoSvg(logo, 512)).toString("base64")}`} width={512} height={512} alt={logo.label} />
  ) : (
    // Text badge: rendered as HTML so the bundled font is used.
    <div
      style={{
        width: 512,
        height: 512,
        borderRadius: 112,
        background: logo.hex,
        color: logoForeground(logo.hex),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 150,
        fontWeight: 700,
      }}
    >
      {logo.text}
    </div>
  );
  const res = new ImageResponse(element, { width: 512, height: 512 });
  res.headers.set("cache-control", CACHE);
  return res;
});
