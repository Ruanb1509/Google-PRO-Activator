-- Products can be bought from the Partner API supplier when the local stock runs out.
ALTER TABLE "products" ADD COLUMN "supplier_slug" TEXT;
ALTER TABLE "products" ADD COLUMN "supplier_max_cost_cents" INTEGER;
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_max_cost_check" CHECK ("supplier_max_cost_cents" IS NULL OR "supplier_max_cost_cents" > 0);
