import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "@/server/common/logger";
import { ProviderError } from "@/server/payments/payment-provider";

function captureError(fn: () => void): Record<string, unknown> {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  fn();
  const line = spy.mock.calls[0]![0] as string;
  return JSON.parse(line);
}

describe("logger error serialization", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never logs request payloads of errors (e.g. the delivered item in a Telegram message)", () => {
    const err = Object.assign(new Error("Call to 'sendMessage' failed! (403: Forbidden: bot was blocked by the user)"), {
      method: "sendMessage",
      error_code: 403,
      description: "Forbidden: bot was blocked by the user",
      payload: { chat_id: 1, text: "Your item: https://secret.example/activate/ABC123" },
    });
    const entry = captureError(() => createLogger().error("delivery.failed", { err }));
    expect(JSON.stringify(entry)).not.toContain("ABC123");
    expect(entry.err).toMatchObject({ method: "sendMessage", error_code: 403 });
  });

  it("keeps only the rejection reason of provider responses", () => {
    const err = new ProviderError("mercadopago", "HTTP 401 on POST /v1/payments", 401, {
      message: "Unauthorized use of live credentials",
      error: "unauthorized",
      cause: [{ code: 7, description: "Unauthorized use of live credentials" }],
      payer: { email: "someone@example.com", identification: { number: "12345678900" } },
    });
    const entry = captureError(() => createLogger().error("order.create_payment_failed", { err }));
    const text = JSON.stringify(entry);
    expect(text).toContain("Unauthorized use of live credentials");
    expect(text).not.toContain("someone@example.com");
    expect(entry.err).toMatchObject({ httpStatus: 401, provider: "mercadopago", body: { error: "unauthorized", cause: [{ code: 7 }] } });
  });
});
