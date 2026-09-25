import { describe, expect, it } from "vitest";
import { AI_LOGOS, aiLogoSvg, findAiLogo, logoForeground } from "@/lib/ai-logos";
import { parseLogoDataUrl, productInputSchema } from "@/server/products/products.service";

const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("product logos", () => {
  it("has unique keys and valid paths", () => {
    const keys = AI_LOGOS.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(findAiLogo("gemini")?.label).toBe("Gemini");
    expect(findAiLogo("chatgpt")?.path).toBeNull();
    for (const l of AI_LOGOS) expect(aiLogoSvg(l)).toMatch(/^<svg[\s\S]*<\/svg>$/);
  });

  it("picks a readable foreground color", () => {
    expect(logoForeground("#FFD21E")).toBe("#111111");
    expect(logoForeground("#8E75B2")).toBe("#FFFFFF");
  });

  it("accepts only real PNG/JPEG/WebP data URLs", () => {
    expect(parseLogoDataUrl(PNG_1x1)?.mime).toBe("image/png");
    const svg = `data:image/svg+xml;base64,${Buffer.from("<svg onload=alert(1)>").toString("base64")}`;
    expect(parseLogoDataUrl(svg)).toBeNull();
    // HTML disguised as PNG (wrong magic bytes)
    const fake = `data:image/png;base64,${Buffer.from("<html><script>alert(1)</script>").toString("base64")}`;
    expect(parseLogoDataUrl(fake)).toBeNull();
    expect(parseLogoDataUrl("https://example.com/logo.png")).toBeNull();
  });

  it("validates logo fields on products", () => {
    const base = { name: "Gemini Pro", priceBrlCents: 2000, priceUsdCents: 400 };
    expect(productInputSchema.safeParse({ ...base, logoKey: "gemini" }).success).toBe(true);
    expect(productInputSchema.safeParse({ ...base, logoKey: "unknown" }).success).toBe(false);
    expect(productInputSchema.safeParse({ ...base, logoImage: PNG_1x1 }).success).toBe(true);
    expect(productInputSchema.safeParse({ ...base, logoImage: "data:text/html;base64,PGgxPg==" }).success).toBe(false);
  });
});
