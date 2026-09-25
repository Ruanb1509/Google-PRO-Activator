import { adminRoute, json } from "@/server/common/http";

export const dynamic = "force-dynamic";

export const GET = adminRoute("VIEWER", async ({ admin }) => {
  const { sessionId: _sessionId, ...rest } = admin;
  return json({ admin: rest });
});
