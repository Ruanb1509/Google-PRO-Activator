-- What each Partner API purchase cost, so the dashboard can compute profit per sale.
CREATE TABLE "supplier_purchases" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "supplier_order_code" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "order_id" TEXT,
    "units" INTEGER NOT NULL,
    "total_cost_usd_cents" INTEGER NOT NULL,
    "usd_brl_rate" DOUBLE PRECISION,
    "total_cost_brl_cents" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_purchases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_purchases_batch_id_key" ON "supplier_purchases"("batch_id");
CREATE INDEX "supplier_purchases_created_at_idx" ON "supplier_purchases"("created_at");
ALTER TABLE "supplier_purchases" ADD CONSTRAINT "supplier_purchases_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill from the purchases already made: orders filled by the supplier...
INSERT INTO "supplier_purchases" ("id", "batch_id", "supplier_order_code", "product_id", "order_id", "units", "total_cost_usd_cents", "created_at")
SELECT gen_random_uuid()::text, 'supplier:' || (e.details->>'supplierOrderCode'), e.details->>'supplierOrderCode', o.product_id, o.id,
       COALESCE((e.details->>'delivered')::int, (e.details->>'quantity')::int, 1), (e.details->>'totalCostCents')::int, e.created_at
FROM "order_events" e JOIN "orders" o ON o.id = e.order_id
WHERE e.type = 'SUPPLIER_PURCHASED' AND e.details ? 'supplierOrderCode' AND e.details ? 'totalCostCents'
ON CONFLICT ("batch_id") DO NOTHING;

-- ...and stock bought from the supplier in the dashboard.
INSERT INTO "supplier_purchases" ("id", "batch_id", "supplier_order_code", "product_id", "units", "total_cost_usd_cents", "created_at")
SELECT gen_random_uuid()::text, a.details->>'batchId', a.details->>'supplierOrderCode', p.id,
       COALESCE((a.details->>'delivered')::int, 1), (a.details->>'totalCostCents')::int, a.created_at
FROM "audit_logs" a JOIN "products" p ON p.id = a.resource_id
WHERE a.action = 'inventory.added' AND a.details ? 'supplierOrderCode' AND a.details ? 'totalCostCents' AND a.details ? 'batchId'
ON CONFLICT ("batch_id") DO NOTHING;
