/** Domain error with a stable machine-readable code and an HTTP status. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  notFound: (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`, 404),
  unauthorized: (msg = "Authentication required") => new AppError("UNAUTHORIZED", msg, 401),
  forbidden: (msg = "Insufficient permissions") => new AppError("FORBIDDEN", msg, 403),
  validation: (details: unknown) => new AppError("VALIDATION_ERROR", "Invalid input", 422, details),
  conflict: (msg: string, code = "CONFLICT") => new AppError(code, msg, 409),
  rateLimited: () => new AppError("RATE_LIMITED", "Too many requests", 429),
  outOfStock: () => new AppError("OUT_OF_STOCK", "Product out of stock", 409),
  badRequest: (msg: string, code = "BAD_REQUEST") => new AppError(code, msg, 400),
};

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}
