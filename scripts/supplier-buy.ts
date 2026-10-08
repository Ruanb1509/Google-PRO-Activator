/**
 * Buys units from the supplier (Partner API) into a product's own stock.
 *   npm run supplier:buy -- --product <productId> [--quantity 1] [--link <supplier slug>]
 * --link also links the product to that supplier item (used when its own stock runs out).
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { db } from "@/server/common/db";
import { purchaseToStock } from "@/server/supplier/supplier.service";

const { values } = parseArgs({
  options: { product: { type: "string" }, quantity: { type: "string", default: "1" }, link: { type: "string" } },
});

async function main() {
  if (!values.product) throw new Error("--product é obrigatório");
  if (values.link) await db().product.update({ where: { id: values.product }, data: { supplierSlug: values.link } });
  const result = await purchaseToStock(values.product, Number(values.quantity));
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
