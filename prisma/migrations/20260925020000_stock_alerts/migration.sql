-- "Notify me when back in stock" requests (opt-in per customer and product).
CREATE TABLE "stock_alerts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_alerts_user_id_product_id_key" ON "stock_alerts"("user_id", "product_id");
CREATE INDEX "stock_alerts_product_id_created_at_idx" ON "stock_alerts"("product_id", "created_at");

ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
