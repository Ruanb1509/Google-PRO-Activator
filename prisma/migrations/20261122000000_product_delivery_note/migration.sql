-- Custom message the customer receives right after the delivery message (per product, per language).
ALTER TABLE "products" ADD COLUMN "delivery_note" TEXT;
ALTER TABLE "products" ADD COLUMN "delivery_note_en" TEXT;
