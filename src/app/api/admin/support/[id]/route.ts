import { adminRoute, json } from "@/server/common/http";
import { getTicket } from "@/server/support/support.service";

export const dynamic = "force-dynamic";

export const GET = adminRoute("VIEWER", async ({ params }) => json(await getTicket(params.id!)));
