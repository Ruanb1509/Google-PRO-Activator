import { createHash } from "node:crypto";
import { GrammyError, InputFile } from "grammy";
import type { Product } from "@/generated/prisma/client";
import { env } from "@/server/config/env";
import { db } from "@/server/common/db";
import { logger } from "@/server/common/logger";
import { rateLimit } from "@/server/common/rate-limit";
import { telegramApi } from "@/server/notifications/telegram";
import { renderProductLogo } from "@/server/products/product-logo";

/**
 * Product logos mirrored as Telegram custom emoji, so the bot can show them as the icon on the left
 * of the product buttons (`icon_custom_emoji_id`). Buttons can't carry images; custom emoji can.
 *
 * The emoji live in a set created by the bot and owned by TELEGRAM_EMOJI_OWNER_ID. Telegram only
 * renders button icons when the bot owner has Telegram Premium (or the bot bought a Fragment username).
 */

type EmojiProduct = Pick<Product, "id" | "logoKey" | "logoImage" | "logoEmojiId" | "logoEmojiFileId" | "logoEmojiVersion" | "deletedAt">;

const EMOJI_FOR_SEARCH = ["🛒"];

export function emojiSetName(): string {
  return `logos_by_${env().TELEGRAM_BOT_USERNAME}`;
}

/** Identifies the logo content, so price/name edits don't regenerate the emoji. */
export function logoVersion(p: Pick<Product, "logoKey" | "logoImage">): string | null {
  if (p.logoImage) return `img:${createHash("sha256").update(p.logoImage).digest("hex").slice(0, 16)}`;
  if (p.logoKey) return `key:${p.logoKey}`;
  return null;
}

function needsSync(p: EmojiProduct): boolean {
  const wanted = p.deletedAt ? null : logoVersion(p);
  return wanted !== p.logoEmojiVersion || (wanted === null && p.logoEmojiFileId !== null);
}

async function stickerIds(): Promise<Set<string> | null> {
  try {
    const set = await telegramApi().getStickerSet(emojiSetName());
    return new Set(set.stickers.map((s) => s.file_unique_id));
  } catch (err) {
    if (err instanceof GrammyError && err.description.includes("STICKERSET_INVALID")) return null; // not created yet
    throw err;
  }
}

async function uploadEmoji(ownerId: number, p: EmojiProduct): Promise<{ emojiId: string; fileId: string } | null> {
  const png = renderProductLogo(p, 100);
  if (!png) return null;
  const sticker = {
    sticker: new InputFile(new Uint8Array(await png.arrayBuffer()), "logo.png"),
    format: "static" as const,
    emoji_list: EMOJI_FOR_SEARCH,
  };
  const api = telegramApi();
  const before = await stickerIds();
  if (before) await api.addStickerToSet(ownerId, emojiSetName(), sticker);
  else await api.createNewStickerSet(ownerId, emojiSetName(), `Logos @${env().TELEGRAM_BOT_USERNAME}`.slice(0, 64), [sticker], { sticker_type: "custom_emoji" });

  const set = await api.getStickerSet(emojiSetName());
  const added = set.stickers.find((s) => !before?.has(s.file_unique_id));
  if (!added?.custom_emoji_id) throw new Error("Uploaded emoji not found in the sticker set");
  return { emojiId: added.custom_emoji_id, fileId: added.file_id };
}

/** Creates/replaces/removes the emoji of one product so it matches its current logo. */
async function syncOne(ownerId: number, p: EmojiProduct): Promise<void> {
  const version = p.deletedAt ? null : logoVersion(p);
  const uploaded = version ? await uploadEmoji(ownerId, p) : null;
  await db().product.update({
    where: { id: p.id },
    data: { logoEmojiId: uploaded?.emojiId ?? null, logoEmojiFileId: uploaded?.fileId ?? null, logoEmojiVersion: uploaded ? version : null },
  });
  if (p.logoEmojiFileId) {
    // The old emoji is no longer referenced; free its slot (a set holds up to 200).
    await telegramApi().deleteStickerFromSet(p.logoEmojiFileId).catch((err) => logger.warn("product_emoji.delete_failed", { err, productId: p.id }));
  }
}

/**
 * Brings product emoji in line with their logos. Cheap when nothing changed (one query).
 * Serialized across instances: a new sticker is identified by diffing the set before/after upload.
 */
export async function syncProductEmojis(opts: { productId?: string; limit?: number } = {}): Promise<number> {
  const ownerId = env().TELEGRAM_EMOJI_OWNER_ID;
  if (!ownerId) return 0;
  const products = await db().product.findMany({
    where: opts.productId ? { id: opts.productId } : { OR: [{ deletedAt: null }, { logoEmojiFileId: { not: null } }] },
    select: { id: true, logoKey: true, logoImage: true, logoEmojiId: true, logoEmojiFileId: true, logoEmojiVersion: true, deletedAt: true },
  });
  const pending = products.filter(needsSync).slice(0, opts.limit ?? 10);
  if (!pending.length || !(await rateLimit("product_emoji:sync", 1, 60))) return 0;

  let synced = 0;
  for (const p of pending) {
    try {
      await syncOne(ownerId, p);
      synced++;
    } catch (err) {
      logger.warn("product_emoji.sync_failed", { err, productId: p.id });
    }
  }
  await db().rateLimit.delete({ where: { key: "product_emoji:sync" } }).catch(() => undefined); // release the lock
  return synced;
}
