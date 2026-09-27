-- Product logo mirrored as a Telegram custom emoji (shown as the icon of the product button in the bot).
ALTER TABLE "products" ADD COLUMN "logo_emoji_id" TEXT;
ALTER TABLE "products" ADD COLUMN "logo_emoji_file_id" TEXT;
ALTER TABLE "products" ADD COLUMN "logo_emoji_version" TEXT;
