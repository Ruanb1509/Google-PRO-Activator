import type { Prisma } from "@/generated/prisma/client";
import type { ActorType } from "@/generated/prisma/enums";
import { db, type Tx } from "@/server/common/db";

export async function orderEvent(
  args: { orderId: string; type: string; message?: string; actorType: ActorType; adminId?: string | null; details?: Prisma.InputJsonValue },
  tx?: Tx,
): Promise<void> {
  await (tx ?? db()).orderEvent.create({
    data: {
      orderId: args.orderId,
      type: args.type,
      message: args.message,
      actorType: args.actorType,
      adminId: args.adminId ?? null,
      details: args.details,
    },
  });
}
