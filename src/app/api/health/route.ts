import { json } from "@/server/common/http";

export const dynamic = "force-dynamic";

/** Liveness: the process is up (no dependencies checked). */
export function GET() {
  return json({ status: "ok", time: new Date().toISOString() });
}
