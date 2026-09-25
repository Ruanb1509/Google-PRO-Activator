import { NextResponse, type NextRequest } from "next/server";

/**
 * UX-only guard: sends visitors without a session cookie to /login.
 * Real authorization is enforced by every /api/admin route.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.get("sid")?.value) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|login|health|ready|favicon.ico|robots.txt).*)"],
};
