"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiOptions {
  method?: Method;
  body?: unknown;
  /** Do not redirect to /login on 401 (used by the login page). */
  noRedirect?: boolean;
}

/** Fetch wrapper for `/api/admin/...` (cookies + CSRF double-submit header). */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET") headers["x-csrf-token"] = readCookie("csrf");

  const res = await fetch(path.startsWith("/") ? path : `/api/admin/${path}`, {
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store",
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    if (res.status === 401 && !opts.noRedirect && typeof window !== "undefined") {
      window.location.href = "/login";
    }
    const err = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(err?.message ?? `Erro ${res.status}`, res.status, err?.code, err?.details, data);
  }
  return data as T;
}

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// ───────────── formatting ─────────────

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });

export function money(cents: number | null | undefined, currency: string): string {
  const v = (cents ?? 0) / 100;
  if (currency === "BRL") return brl.format(v);
  if (currency === "USD") return usd.format(v);
  return `${v.toFixed(2)} ${currency}`;
}

export const fmtBRL = (c: number | null | undefined) => money(c, "BRL");
export const fmtUSD = (c: number | null | undefined) => money(c, "USD");

/** "20", "20,5", "20.50" -> 2050. Returns null when invalid. */
export function toCents(input: string): number | null {
  const s = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

const dtf = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const df = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short" });

export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(d.getTime()) ? "—" : dtf.format(d);
}

export function fmtDay(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value.length === 10 ? `${value}T12:00:00Z` : value) : value;
  return Number.isNaN(d.getTime()) ? "—" : df.format(d);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface Paged<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}
