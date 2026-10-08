import { env } from "@/server/config/env";

/**
 * Minimal client of the supplier's Partner API v1 (REST/JSON, USD, Bearer `sk_live_...` key).
 * Purchases are charged from the supplier bot wallet. Responses may carry delivered items
 * (links, codes, account credentials): never log them.
 */

const TIMEOUT_MS = 20_000;

export type PartnerDeliveryType = "LINK" | "COUPON" | "READY_ACCOUNT";

/** `customTelegramId` is a Telegram custom emoji (the service logo in the supplier's bot). */
export interface PartnerEmoji {
  normal: string | null;
  customTelegramId: string | null;
}

export interface PartnerProduct {
  id: number;
  slug: string;
  productCode?: string | null;
  name: string;
  provider: { key: string; name: string; emoji?: PartnerEmoji | null };
  emoji?: PartnerEmoji | null;
  deliveryType: PartnerDeliveryType;
  yourPrice: string;
  currency: string;
  durationDays?: number | null;
  warranty?: { enabled: boolean; days: number | null } | null;
  stock: { inStock: boolean; count: number; maxQuantity: number };
}

export interface PartnerProductDetail extends PartnerProduct {
  description?: string | null;
  descriptionFormat?: string | null;
  instructions?: string | null;
}

export interface PartnerDelivery {
  link?: string;
  code?: string;
  content?: string;
  instructions?: string;
}

export interface PartnerOrder {
  ok: true;
  orderCode: string;
  externalOrderId: string;
  status: string;
  deliveryType: PartnerDeliveryType;
  quantity: number;
  unitPrice: string;
  totalCharged: string;
  currency: string;
  balanceAfter?: string;
  delivery?: PartnerDelivery;
  lines?: (PartnerDelivery & { orderCode: string })[];
}

/** Error answered by the Partner API (`code` is its machine-readable error code) or a transport failure. */
export class PartnerApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number | null,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "PartnerApiError";
  }

  /** Errors after which the supplier certainly did not charge nor deliver (safe to give up or retry later). */
  get isRefusal(): boolean {
    return this.httpStatus !== null && this.httpStatus < 500 && this.code !== "RATE_LIMIT_EXCEEDED";
  }
}

export function partnerConfigured(): boolean {
  return Boolean(env().PARTNER_API_KEY);
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const { PARTNER_API_KEY, PARTNER_API_BASE_URL } = env();
  if (!PARTNER_API_KEY) throw new PartnerApiError("NOT_CONFIGURED", "PARTNER_API_KEY is not set", null);
  let res: Response;
  try {
    res = await fetch(`${PARTNER_API_BASE_URL.replace(/\/+$/, "")}${path}`, {
      method,
      headers: { authorization: `Bearer ${PARTNER_API_KEY}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new PartnerApiError(timeout ? "TIMEOUT" : "NETWORK_ERROR", err instanceof Error ? err.message : String(err), null);
  }
  const data = (await res.json().catch(() => null)) as (Record<string, unknown> & { error?: { code?: string; message?: string; requestId?: string } }) | null;
  if (!res.ok || data?.ok === false) {
    const e = data?.error;
    throw new PartnerApiError(e?.code ?? `HTTP_${res.status}`, (e?.message ?? res.statusText ?? "Partner API error").slice(0, 300), res.status, e?.requestId);
  }
  if (!data) throw new PartnerApiError("INVALID_RESPONSE", "Partner API returned a non-JSON response", res.status);
  return data as T;
}

export const partnerApi = {
  balance: () => request<{ balance: string; currency: string }>("GET", "/balance"),
  products: () => request<{ data: PartnerProduct[] }>("GET", "/catalog/products").then((r) => r.data),
  product: (ref: string) => request<PartnerProductDetail>("GET", `/catalog/products/${encodeURIComponent(ref)}`),
  /** Idempotent: the same `externalOrderId` + body returns the original order without charging again. */
  createOrder: (input: { productSlug: string; quantity: number; externalOrderId: string }) => request<PartnerOrder>("POST", "/orders", input),
};

/** "12.50" -> 1250 (USD cents). */
export function usdToCents(value: string | number): number {
  return Math.round(Number(value) * 100);
}

/** The delivered items of an order, one value per unit (bulk orders return them in `lines`). */
export function deliveredValues(order: Pick<PartnerOrder, "delivery" | "lines">): string[] {
  const items = order.lines?.length ? order.lines : order.delivery ? [order.delivery] : [];
  return items.map((d) => (d.link ?? d.code ?? d.content ?? "").trim()).filter(Boolean);
}
