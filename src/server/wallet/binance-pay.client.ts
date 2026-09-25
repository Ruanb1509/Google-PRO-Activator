import { env } from "@/server/config/env";
import { hmacSha256Hex } from "@/server/common/crypto";

/**
 * Read-only client for the store owner's own Binance account.
 * Endpoint: GET /sapi/v1/pay/transactions ("Get Pay Trade History", USER_DATA, HMAC SHA256 signed).
 * Create the API key with ONLY the "Enable Reading" permission.
 */

export interface BinancePayTransaction {
  orderType: string;
  transactionId: string;
  orderId?: string;
  transactionTime: number;
  amount: string;
  currency: string;
  walletType?: number;
  fundsDetail?: { currency: string; amount: string }[];
  payerInfo?: { name?: string; type?: string; binanceId?: number | string; accountId?: number | string };
  receiverInfo?: { name?: string; type?: string; binanceId?: number | string; accountId?: number | string };
  note?: string;
}

interface PayHistoryResponse {
  code: string;
  message: string;
  data?: BinancePayTransaction[];
  success?: boolean;
}

export class BinanceApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "BinanceApiError";
  }
}

export function binanceConfigured(): boolean {
  const e = env();
  return Boolean(e.BINANCE_API_KEY && e.BINANCE_API_SECRET && e.BINANCE_PAY_ID);
}

export function signQuery(query: string, secret: string): string {
  return hmacSha256Hex(secret, query);
}

async function fetchPayHistory(startTime: number, endTime: number): Promise<BinancePayTransaction[]> {
  const e = env();
  if (!e.BINANCE_API_KEY || !e.BINANCE_API_SECRET) throw new BinanceApiError("Binance API not configured");
  const params = new URLSearchParams({
    startTime: String(startTime),
    endTime: String(endTime),
    limit: "100",
    recvWindow: "10000",
    timestamp: String(Date.now()),
  });
  const query = params.toString();
  const url = `${e.BINANCE_API_BASE_URL}/sapi/v1/pay/transactions?${query}&signature=${signQuery(query, e.BINANCE_API_SECRET)}`;
  const res = await fetch(url, { headers: { "X-MBX-APIKEY": e.BINANCE_API_KEY }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as PayHistoryResponse;
  if (!res.ok || (body.code && body.code !== "000000")) {
    throw new BinanceApiError(`Binance Pay history error: HTTP ${res.status} ${body.code ?? ""} ${body.message ?? ""}`.trim(), res.status);
  }
  return body.data ?? [];
}

/**
 * Looks for a transaction by id within a time window. Pages backwards (the API returns up to 100
 * records per call) by moving `endTime` before the oldest record of the previous page.
 */
export async function findPayTransaction(txId: string, window: { startTime: number; endTime: number }, maxPages = 10): Promise<BinancePayTransaction | null> {
  let endTime = window.endTime;
  for (let page = 0; page < maxPages && endTime > window.startTime; page++) {
    const items = await fetchPayHistory(window.startTime, endTime);
    const hit = items.find((t) => t.transactionId === txId || (t.orderId && String(t.orderId) === txId));
    if (hit) return hit;
    if (items.length < 100) return null;
    endTime = Math.min(...items.map((t) => t.transactionTime)) - 1;
  }
  return null;
}

/** Decimal string -> integer cents without floating point errors ("10.03000000" -> 1003). Truncates below cents. */
export function decimalToCents(value: string): number | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0").slice(0, 2));
  return m[1] === "-" ? -cents : cents;
}
