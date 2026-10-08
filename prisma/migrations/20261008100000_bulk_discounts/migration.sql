-- Quantity discounts per product: [{ "minQty": 5, "percentOff": 11 }, ...]
ALTER TABLE "products" ADD COLUMN "bulk_discounts" JSONB;
