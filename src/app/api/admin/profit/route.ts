import { adminRoute, json } from "@/server/common/http";
import { profitReport } from "@/server/admin/profit.service";

export const dynamic = "force-dynamic";

export const GET = adminRoute("VIEWER", async () => json(await profitReport()));
