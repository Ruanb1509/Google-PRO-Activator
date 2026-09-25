/** Minimal structured JSON logger (stdout is collected by Vercel / any log drain). */
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = (process.env.LOG_LEVEL as Level) || (process.env.NODE_ENV === "production" ? "info" : "debug");

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    // Keep extra fields such as ProviderError.httpStatus / body (the provider's reason for rejecting).
    const { name, message, stack, ...extra } = err as Error & Record<string, unknown>;
    return { ...extra, name, message, stack };
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
