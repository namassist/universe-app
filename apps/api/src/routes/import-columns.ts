/**
 * The two header failures every spreadsheet import can hit, worded once.
 *
 * There are eleven imports in the product now — nine catalogues, the unit
 * registry, and accounts — each with its own column set, and an operator who
 * reaches for the wrong file gets one of these two messages. Naming only what
 * was wrong ("Kolom tidak dikenal: nik, email, role") tells them something is
 * off without telling them what would be right, which leaves the next guess as
 * much of a guess as the first. So both messages carry the columns this
 * particular import accepts.
 *
 * Shared rather than repeated because the wording drifting apart between
 * imports is exactly the confusion these are meant to remove.
 */

import type ExcelJS from "exceljs";

export type ParseFailure = { code: string; message: string };

/** Generous for hundreds of rows, small enough that a hostile file fails fast. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/**
 * A cell as the operator meant it: formulas by their result, rich text
 * flattened, everything else stringified and trimmed.
 */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string")
      return value.text.trim();
    if ("result" in value) return String(value.result ?? "").trim();
    if ("richText" in value)
      return value.richText
        .map((r) => r.text)
        .join("")
        .trim();
    return "";
  }
  return String(value).trim();
}

const accepted = (columns: readonly string[]) =>
  `Kolom yang diterima: ${columns.join(", ")}`;

/**
 * Unknown columns are refused rather than ignored: a mistyped header quietly
 * dropped means a column the operator believes they imported and did not.
 */
export function unknownColumnsFailure(
  unknown: string[],
  columns: readonly string[]
): ParseFailure {
  return {
    code: "unknown_columns",
    message: `Kolom tidak dikenal: ${unknown.join(", ")}. ${accepted(columns)}`,
  };
}

export function missingColumnsFailure(
  missing: string[],
  columns: readonly string[]
): ParseFailure {
  return {
    code: "missing_columns",
    message: `Kolom wajib hilang: ${missing.join(", ")}. ${accepted(columns)}`,
  };
}
