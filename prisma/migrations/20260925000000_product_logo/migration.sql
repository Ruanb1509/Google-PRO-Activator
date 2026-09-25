-- Product logos: a key from the built-in AI logo gallery or an uploaded image (data URL).
ALTER TABLE "products" ADD COLUMN "logo_key" TEXT;
ALTER TABLE "products" ADD COLUMN "logo_image" TEXT;
ALTER TABLE "products" ADD CONSTRAINT "products_logo_image_size" CHECK ("logo_image" IS NULL OR length("logo_image") <= 400000);
