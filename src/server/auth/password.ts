import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

// scrypt is memory-hard and built into Node (no native addon to break on serverless builds).
const PARAMS = { N: 2 ** 15, r: 8, p: 1, keyLen: 64 };

function scrypt(password: string, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Format: scrypt$N$r$p$salt$hash (base64url) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keyLen } = PARAMS;
  const hash = await scrypt(password, salt, keyLen, { N, r, p, maxmem: 256 * N * r });
  return ["scrypt", N, r, p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  if (expected.length < 16) return false;
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  const actual = await scrypt(password, Buffer.from(salt, "base64url"), expected.length, { N, r: R, p: P, maxmem: 256 * N * R });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Dummy hash used to keep login timing similar when the account does not exist. */
export const DUMMY_HASH = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 12) return "A senha deve ter pelo menos 12 caracteres";
  if (password.length > 200) return "Senha muito longa";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return "A senha deve conter letras maiúsculas, minúsculas e números";
  }
  return null;
}
