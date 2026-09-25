/** Minimal structured JSON logger (stdout is collected by Vercel / any log drain). */
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = (process.env.LOG_LEVEL as Level) || (process.env.NODE_ENV === "production" ? "info" : "debug");

/**
 * Only allowlisted error fields are logged: errors may carry request payloads (e.g. GrammyError.payload
 * holds the sent message text, which can contain a delivered item) or full provider responses (PII).
 */
const SAFE_ERROR_FIELDS = ["code", "provider", "httpStatus", "method", "error_code", "description"] as const;

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v.slice(0, 300) : undefined;
}

/** Keeps only the rejection reason of a provider response (Mercado Pago: message/cause; Stripe: error.type/code/message). */
function summarizeProviderBody(body: unknown): unknown {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  const nested = b.error && typeof b.error === "object" ? (b.error as Record<string, unknown>) : null;
  const cause = Array.isArray(b.cause) ? b.cause.slice(0, 5).map((c) => ({ code: (c as Record<string, unknown>)?.code, description: str((c as Record<string, unknown>)?.description) })) : undefined;
  return {
    message: str(nested?.message) ?? str(b.message),
    error: str(nested?.type) ?? str(b.error),
    code: str(nested?.code) ?? str(b.code) ?? (typeof b.code === "number" ? b.code : undefined),
    declineCode: str(nested?.decline_code),
    cause,
  };
}

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    const e = err as Error & Record<string, unknown>;
    const out: Record<string, unknown> = { name: e.name, message: e.message, stack: e.stack };
    for (const k of SAFE_ERROR_FIELDS) if (e[k] !== undefined && typeof e[k] !== "object") out[k] = e[k];
    if (e.body !== undefined) out.body = summarizeProviderBody(e.body);
    return out;
  }
  return err;
}

function write(level: Level, bindings: Record<string, unknown>, msg: string, data?: Record<string, unknown>) {
  if (order[level] < order[minLevel]) return;
  const entry: Record<string, unknown> = { level, time: new Date().toISOString(), msg, ...bindings, ...data };
  if (entry.err) entry.err = serializeError(entry.err);
  const line = JSON.stringify(entry, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(bindings: Record<string, unknown> = {}): Logger {
  return {
    debug: (m, d) => write("debug", bindings, m, d),
    info: (m, d) => write("info", bindings, m, d),
    warn: (m, d) => write("warn", bindings, m, d),
    error: (m, d) => write("error", bindings, m, d),
    child: (b) => createLogger({ ...bindings, ...b }),
  };
}

export const logger = createLogger({ service: "store" });
