import { describe, expect, it } from "vitest";
import { decrypt, encrypt, keyedHash } from "@/server/common/crypto";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/server/auth/password";
import { base32Decode, base32Encode, totpCode, verifyTotp } from "@/server/auth/totp";
import { hasRole } from "@/server/auth/roles";

describe("AES-256-GCM encryption", () => {
  it("round-trips and uses a random IV", () => {
    const a = encrypt("LINK-001");
    const b = encrypt("LINK-001");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("LINK-001");
  });

  it("rejects tampered ciphertext", () => {
    const parts = encrypt("secret").split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });

  it("keyed hash is deterministic (duplicate detection)", () => {
    expect(keyedHash("X")).toBe(keyedHash("X"));
    expect(keyedHash("X")).not.toBe(keyedHash("Y"));
  });
});

describe("password hashing (scrypt)", () => {
  it("verifies the right password only", async () => {
    const hash = await hashPassword("Correct-Horse-9-Battery");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Correct-Horse-9-Battery", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("enforces a minimum strength", () => {
    expect(validatePasswordStrength("short")).not.toBeNull();
    expect(validatePasswordStrength("alllowercase123")).not.toBeNull();
    expect(validatePasswordStrength("Str0ngEnoughPass")).toBeNull();
  });
});

describe("TOTP (RFC 6238)", () => {
  // RFC 6238 test secret "12345678901234567890" (SHA-1)
  const secret = base32Encode(Buffer.from("12345678901234567890"));

  it("base32 round-trip", () => {
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
  });

  it("matches the RFC test vectors (last 6 digits)", () => {
    expect(totpCode(secret, 59_000)).toBe("287082");
    expect(totpCode(secret, 1_111_111_109_000)).toBe("081804");
    expect(totpCode(secret, 1_234_567_890_000)).toBe("005924");
  });

  it("accepts +/- 1 step and rejects others", () => {
    const now = 1_234_567_890_000;
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), 1, now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 90_000), 1, now)).toBe(false);
    expect(verifyTotp(secret, "abc", 1, now)).toBe(false);
  });
});

describe("roles", () => {
  it("ADMIN > STAFF > VIEWER", () => {
    expect(hasRole("ADMIN", "STAFF")).toBe(true);
    expect(hasRole("STAFF", "STAFF")).toBe(true);
    expect(hasRole("VIEWER", "STAFF")).toBe(false);
    expect(hasRole("STAFF", "ADMIN")).toBe(false);
  });
});
