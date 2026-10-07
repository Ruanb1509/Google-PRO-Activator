/** Pure parsing/validation of bulk inventory input (textarea paste, TXT or CSV upload). */

export const MAX_ITEM_LENGTH = 2048;
export const MAX_ITEMS_PER_BATCH = 5000;

export interface ParsedItems {
  valid: string[];
  invalid: { line: number; value: string; reason: string }[];
  /** Duplicates inside the submitted text itself. */
  duplicatesInInput: string[];
  /** Lines without a link skipped from a supplier export (header, product, price, order code...). */
  ignored: number;
}

// Control characters (except tab which is handled by CSV splitting) are never valid in a link/code.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/;

const URL_IN_LINE = /https?:\/\/[^\s"'<>]+/i;

/**
 * Supplier order exports list the links after an index ("1,https://...") below a block of order
 * details ("Product,...", "Price,...", "#,Content"). Only the links of such a text are kept.
 */
function isSupplierExport(lines: string[]): boolean {
  return lines.some((l) => {
    const m = URL_IN_LINE.exec(l);
    return m !== null && m.index > 0 && /^\s*"?\d+"?\s*[,;\t]/.test(l);
  });
}

function firstCsvColumn(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith('"')) {
    const end = trimmed.indexOf('"', 1);
    if (end > 0) return trimmed.slice(1, end);
  }
  // Only split on ; or , when the line is not a URL containing commas in its query string.
  if (/^https?:\/\//i.test(trimmed)) return trimmed.split(/[;\t]/)[0]!.trim();
  return trimmed.split(/[;,\t]/)[0]!.trim();
}

export function parseInventoryText(text: string, opts: { csv?: boolean } = {}): ParsedItems {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const seen = new Set<string>();
  const out: ParsedItems = { valid: [], invalid: [], duplicatesInInput: [], ignored: 0 };
  const supplierExport = isSupplierExport(lines);

  lines.forEach((raw, idx) => {
    let value: string;
    if (supplierExport) {
      if (!raw.trim()) return;
      const url = URL_IN_LINE.exec(raw);
      if (!url) {
        out.ignored++;
        return;
      }
      value = url[0].replace(/[,;]+$/, "");
    } else {
      value = opts.csv ? firstCsvColumn(raw) : raw.trim();
    }
    if (!value) return; // blank lines are ignored
    if (opts.csv && idx === 0 && /^(value|code|link|codigo|código|item)s?$/i.test(value)) return; // header
    if (value.length > MAX_ITEM_LENGTH) {
      out.invalid.push({ line: idx + 1, value: maskValue(value), reason: "too_long" });
      return;
    }
    if (CONTROL.test(value)) {
      out.invalid.push({ line: idx + 1, value: maskValue(value), reason: "control_characters" });
      return;
    }
    if (seen.has(value)) {
      out.duplicatesInInput.push(value);
      return;
    }
    seen.add(value);
    out.valid.push(value);
  });
  return out;
}

/** Masks a value for listings: keeps a short prefix/suffix only. */
/**
 * Preview shown in listings (no audit): reveals at most 25% of the secret part and never more than 4
 * characters, so a preview can never be used or brute-forced. For links only the host is kept.
 */
export function maskValue(value: string): string {
  let prefix = "";
  let secret = value;
  const url = /^(https?:\/\/[^/?#\s]+)(.*)$/i.exec(value);
  if (url && url[2]!.length > 0) {
    prefix = url[1]!;
    secret = url[2]!;
  }
  const visible = Math.min(4, Math.floor(secret.length * 0.25));
  return `${prefix}••••${visible > 0 ? secret.slice(-visible) : ""}`;
}
