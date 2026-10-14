import { logger } from "@/server/common/logger";

const API = "https://economia.awesomeapi.com.br/json";
const TTL_MS = 10 * 60_000;

let latest: { at: number; rate: number } | null = null;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
  if (!res.ok) throw new Error(`awesomeapi ${res.status}`);
  return res.json();
}

function parseRate(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Current USD-BRL rate (bid), cached per instance. Null when the rate service is unreachable. */
export async function usdBrlRate(): Promise<number | null> {
  if (latest && Date.now() - latest.at < TTL_MS) return latest.rate;
  try {
    const data = (await getJson(`${API}/last/USD-BRL`)) as { USDBRL?: { bid?: string } };
    const rate = parseRate(data.USDBRL?.bid);
    if (rate) latest = { at: Date.now(), rate };
  } catch (err) {
    logger.warn("fx.rate_failed", { err });
  }
  return latest?.rate ?? null;
}

const ymd = (d: Date) => new Date(d.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll("-", "");

/** USD-BRL rate on the day of `date` (Brasília); weekends and holidays use the last quote before it. */
export async function usdBrlRateOn(date: Date): Promise<number | null> {
  const start = new Date(date.getTime() - 6 * 24 * 60 * 60 * 1000);
  try {
    // Most recent quote first.
    const data = await getJson(`${API}/daily/USD-BRL/10?start_date=${ymd(start)}&end_date=${ymd(date)}`);
    return Array.isArray(data) ? parseRate((data[0] as { bid?: string } | undefined)?.bid) : null;
  } catch (err) {
    logger.warn("fx.rate_failed", { err, date: date.toISOString() });
    return null;
  }
}

export const usdToBrlCents = (usdCents: number, rate: number) => Math.round(usdCents * rate);
