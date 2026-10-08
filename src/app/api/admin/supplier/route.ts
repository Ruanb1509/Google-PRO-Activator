import { adminRoute, json } from "@/server/common/http";
import { supplierOverview } from "@/server/supplier/supplier-admin.service";

export const dynamic = "force-dynamic";

export const GET = adminRoute("VIEWER", async () => json(await supplierOverview()));
