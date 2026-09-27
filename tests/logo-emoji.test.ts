import { describe, expect, it } from "vitest";
import { renderProductLogo } from "@/server/products/product-logo";
import { logoVersion } from "@/server/products/product-emoji.service";

const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

async function pngSize(res: Response | null) {
  const bytes = Buffer.from(await res!.arrayBuffer());
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

describe("product logo emoji", () => {
  it("renders gallery and uploaded logos at the custom emoji size (100x100)", async () => {
    expect(await pngSize(renderProductLogo({ logoKey: "gemini", logoImage: null }, 100))).toEqual({ w: 100, h: 100 });
    expect(await pngSize(renderProductLogo({ logoKey: "chatgpt", logoImage: null }, 100))).toEqual({ w: 100, h: 100 });
    expect(await pngSize(renderProductLogo({ logoKey: null, logoImage: PNG_1x1 }, 100))).toEqual({ w: 100, h: 100 });
    expect(renderProductLogo({ logoKey: null, logoImage: null }, 100)).toBeNull();
  });

  it("versions the emoji by logo content only", () => {
    expect(logoVersion({ logoKey: "gemini", logoImage: null })).toBe("key:gemini");
    expect(logoVersion({ logoKey: null, logoImage: PNG_1x1 })).toMatch(/^img:[0-9a-f]{16}$/);
    expect(logoVersion({ logoKey: null, logoImage: null })).toBeNull();
  });
});
