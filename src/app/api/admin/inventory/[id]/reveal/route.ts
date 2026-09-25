import { adminRoute, json } from "@/server/common/http";
import { revealItem } from "@/server/inventory/inventory.service";

export const dynamic = "force-dynamic";

/** Shows the clear value of an item (ADMIN only, audited). */
export const POST = adminRoute("ADMIN", async ({ params, admin, ip }) => json({ value: await revealItem(params.id!, admin.id, ip) }));
