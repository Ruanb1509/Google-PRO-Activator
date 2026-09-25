import { adminRoute, json } from "@/server/common/http";
import { getOrderDetail } from "@/server/orders/orders.service";

export const dynamic = "force-dynamic";

export const GET = adminRoute("VIEWER", async ({ params }) => json(await getOrderDetail(params.id!)));
