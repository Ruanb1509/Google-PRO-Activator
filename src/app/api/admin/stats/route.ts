import { adminRoute, json } from "@/server/common/http";
import { dashboardStats } from "@/server/admin/stats.service";

export const dynamic = "force-dynamic";

export const GET = adminRoute("VIEWER", async () => json(await dashboardStats()));
