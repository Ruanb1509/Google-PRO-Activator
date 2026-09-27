import { ImageResponse } from "next/og";
import type { Product } from "@/generated/prisma/client";
import { aiLogoSvg, findAiLogo, logoForeground } from "@/lib/ai-logos";
import { parseLogoDataUrl } from "@/server/products/products.service";

/** Full size (bot photo / dashboard) and Telegram custom emoji size (must be exactly 100x100). */
export const LOGO_SIZES = [512, 100] as const;
export type LogoSize = (typeof LOGO_SIZES)[number];

/**
 * Renders the product logo as a raster image (Telegram does not accept SVG).
 * Gallery logos are rendered from their vector path; uploaded images are served as stored at full
 * size and resized for smaller ones. Returns null when the product has no (valid) logo.
 */
export function renderProductLogo(p: Pick<Product, "logoKey" | "logoImage">, size: LogoSize = 512): Response | null {
  if (p.logoImage) {
    const img = parseLogoDataUrl(p.logoImage);
    if (!img) return null;
    if (size === 512) return new Response(new Uint8Array(img.bytes), { headers: { "content-type": img.mime } });
    return new ImageResponse(
      // eslint-disable-next-line @next/next/no-img-element
      <img src={p.logoImage} width={size} height={size} alt="" style={{ objectFit: "contain" }} />,
      { width: size, height: size },
    );
  }

  const logo = findAiLogo(p.logoKey);
  if (!logo) return null;
  const element = logo.path ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`data:image/svg+xml;base64,${Buffer.from(aiLogoSvg(logo, size)).toString("base64")}`} width={size} height={size} alt={logo.label} />
  ) : (
    // Text badge: rendered as HTML so the bundled font is used.
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.22),
        background: logo.hex,
        color: logoForeground(logo.hex),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.29),
        fontWeight: 700,
      }}
    >
      {logo.text}
    </div>
  );
  return new ImageResponse(element, { width: size, height: size });
}
