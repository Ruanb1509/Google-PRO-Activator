import { describe, expect, it } from "vitest";
import { DEFAULT_SERVICE_EMOJI, serviceEmoji } from "@/lib/service-emoji";

describe("serviceEmoji", () => {
  it("guesses the service from the product name", () => {
    expect(serviceEmoji("Google Gemini PRO")).toBe("✨");
    expect(serviceEmoji("CapCut Pro 30 dias")).toBe("🎬");
    expect(serviceEmoji("YouTube Premium 3 meses (link)")).toBe("▶️");
    expect(serviceEmoji("Crunchyroll Mega Fan 12 meses")).toBe("🍥");
    expect(serviceEmoji("SuperGrok 9–10 dias")).toBe("⚡");
    expect(serviceEmoji("ChatGPT Plus 1 mês")).toBe("🤖");
  });

  it("falls back to a neutral bullet", () => {
    expect(serviceEmoji("Produto qualquer")).toBe(DEFAULT_SERVICE_EMOJI);
  });
});
