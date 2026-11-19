/** Supplier-bought inventory is stored with batch_id = "supplier:<supplier order code>". */
export const SUPPLIER_BATCH_PREFIX = "supplier:";

/** The supplier order codes behind a set of inventory items (unique, in order). Manual uploads have none. */
export function supplierOrderCodes(items: { batchId: string | null }[]): string[] {
  const codes = items.map((i) => i.batchId).filter((b): b is string => !!b?.startsWith(SUPPLIER_BATCH_PREFIX)).map((b) => b.slice(SUPPLIER_BATCH_PREFIX.length));
  return [...new Set(codes)];
}
