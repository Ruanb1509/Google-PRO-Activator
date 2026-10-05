-- Orders can buy several units at once: one order now holds `quantity` inventory items.
ALTER TABLE "orders" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "orders" ADD CONSTRAINT "orders_quantity_check" CHECK ("quantity" BETWEEN 1 AND 100);

DROP INDEX "inventory_items_order_id_key";
CREATE INDEX "inventory_items_order_id_idx" ON "inventory_items"("order_id");

-- Unpaid orders now release their reserved links after 10 minutes.
UPDATE "settings" SET "value" = jsonb_set("value"::jsonb, '{orderTtlMinutes}', '10'::jsonb)
WHERE "key" = 'store' AND ("value"::jsonb ? 'orderTtlMinutes');
