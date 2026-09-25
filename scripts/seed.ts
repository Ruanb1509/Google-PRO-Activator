/**
 * Optional demo data: 3 products with sample stock. Never run against production data you care about.
 *   npm run seed
 */
import "dotenv/config";
import { db } from "@/server/common/db";
import { encrypt, keyedHash } from "@/server/common/crypto";
import { maskValue } from "@/server/inventory/inventory.parser";

const products = [
  { name: "Produto A", nameEn: "Product A", priceBrlCents: 2000, priceUsdCents: 400, category: "Digital" },
  { name: "Produto B", nameEn: "Product B", priceBrlCents: 3000, priceUsdCents: 600, category: "Digital" },
  { name: "Produto C", nameEn: "Product C", priceBrlCents: 5000, priceUsdCents: 1000, category: "Digital" },
];

async function main() {
  for (const [i, p] of products.entries()) {
    const existing = await db().product.findFirst({ where: { name: p.name, deletedAt: null } });
    const product = existing ?? (await db().product.create({ data: { ...p, description: `Descrição do ${p.name}`, descriptionEn: `${p.nameEn} description`, sortOrder: i } }));
    const values = Array.from({ length: 15 }, (_, n) => `DEMO-${String.fromCharCode(65 + i)}-${String(n + 1).padStart(3, "0")}`);
    const res = await db().inventoryItem.createMany({
      data: values.map((v) => ({ productId: product.id, valueEncrypted: encrypt(v), valueHash: keyedHash(v), valuePreview: maskValue(v) })),
      skipDuplicates: true,
    });
    console.log(`${product.name}: +${res.count} itens`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db().$disconnect());
