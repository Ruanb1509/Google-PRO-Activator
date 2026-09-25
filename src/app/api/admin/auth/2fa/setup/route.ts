import { adminRoute, json } from "@/server/common/http";
import { setupTwoFactor } from "@/server/auth/admins.service";

export const dynamic = "force-dynamic";

export const POST = adminRoute("VIEWER", async ({ admin }) => json(await setupTwoFactor(admin.id)));
