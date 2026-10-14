import { InlineKeyboard } from "grammy";
import type { Locale } from "@/generated/prisma/enums";
import { itemLabel, t } from "@/i18n";

/** Orders with at least this many units also get the items as a downloadable file. */
export const FILE_EXPORT_MIN_QTY = 5;

export type ExportFormat = "txt" | "csv";

const csvCell = (v: string) => `"${v.replaceAll('"', '""')}"`;

/**
 * The delivered items as a file: TXT with one item per line (a blank line between items when they
 * span several lines), or CSV with number, type and value. CSV starts with a BOM so Excel reads UTF-8.
 */
export function deliveryFile(values: string[], format: ExportFormat, orderNumber: number, locale: Locale): { filename: string; content: Buffer } {
  const filename = `${locale === "pt_BR" ? "pedido" : "order"}-${orderNumber}.${format}`;
  if (format === "txt") {
    const sep = values.some((v) => v.includes("\n")) ? "\n\n" : "\n";
    return { filename, content: Buffer.from(values.join(sep) + "\n", "utf8") };
  }
  const header = locale === "pt_BR" ? ["n", "tipo", "valor"] : ["n", "type", "value"];
  const rows = values.map((v, i) => [String(i + 1), itemLabel(v, locale), v].map(csvCell).join(","));
  return { filename, content: Buffer.from("﻿" + [header.join(","), ...rows].join("\r\n") + "\r\n", "utf8") };
}

/** "Download TXT / CSV" buttons for an order's items. */
export function downloadKeyboard(orderId: string, locale: Locale): InlineKeyboard {
  return new InlineKeyboard().text(t(locale, "download_txt"), `dl:${orderId}:txt`).text(t(locale, "download_csv"), `dl:${orderId}:csv`);
}
