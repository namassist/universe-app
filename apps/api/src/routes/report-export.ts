/**
 * A report as the site's own template workbook.
 *
 * Rebuilt in code rather than filled into the files under
 * `docs/template_reports/` (owner, 2026-09-24): the templates carry a morning's
 * sample rows, and a runtime asset that must be emptied before it is used is
 * one whose leftovers eventually get printed. The layout is theirs, cell for
 * cell — title across row 1, Date and Shift in B3:C4, the table's header on
 * row 6 and its rows from 7 — because the sheet is printed and filed beside the
 * ones people made by hand, and it should read like them.
 *
 * One addition: Department on row 5, which the templates leave blank. A sheet
 * narrowed to one department that did not say so would read as the whole site.
 */

import ExcelJS from "exceljs";
import {
  REPORT_COLUMNS,
  REPORT_TITLES,
  SHIFT_KIND_LABELS,
  type ReportColumnKey,
  type ReportKind,
  type ReportRow,
  type ShiftKind,
} from "@universe/contracts";

const TITLE_ROW = 1;
const DATE_ROW = 3;
const SHIFT_ROW = 4;
const DEPARTMENT_ROW = 5;
const HEADER_ROW = 6;

const NO_WIDTH = 6;
const HEADER_FILL = "FF4E73DF";
const HEADER_TEXT = "FFFFFFFF";
const ALL_DEPARTMENTS = "Semua";

/** The templates' widths, by what the column holds. */
const WIDTHS: Record<ReportColumnKey, number> = {
  unit: 11,
  simperCode: 18,
  fleet: 11,
  bus: 13,
  location: 35,
  nik: 16,
  name: 25,
  roster: 8,
  position: 26,
  department: 19,
  simperMatrix: 80,
  saveraStatus: 26,
  jamIn: 12,
};

/** Columns read as a word or a code sit centred; prose sits left. */
const CENTRED: ReadonlySet<ReportColumnKey> = new Set([
  "unit",
  "fleet",
  "bus",
  "nik",
  "roster",
  "jamIn",
]);

const THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

/** What a spreadsheet client may read as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Text that cannot be taken for a formula (OWASP, CSV/formula injection).
 *
 * exceljs writes a string as a string, and Excel opens it as one — but the
 * sheet is filed and reopened in other clients, and a cell edited and saved
 * again is re-parsed. STATUS SAVERA carries savera's free text, which this
 * system does not control, so every cell is neutralised the same way rather
 * than trusting any column to stay tame.
 */
const asText = (value: string): string =>
  FORMULA_LEAD.test(value) ? `'${value}` : value;

export type ReportSheet = {
  kind: ReportKind;
  date: string;
  shift: ShiftKind;
  /** The department it was narrowed to, or null for the whole site. */
  department: string | null;
  rows: ReportRow[];
};

function writeHeading(ws: ExcelJS.Worksheet, sheet: ReportSheet, span: number) {
  ws.mergeCells(TITLE_ROW, 1, TITLE_ROW, span);
  const title = ws.getCell(TITLE_ROW, 1);
  title.value = REPORT_TITLES[sheet.kind];
  title.font = { bold: true, size: 18 };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(TITLE_ROW).height = 24;

  const labels: [number, string, ExcelJS.CellValue][] = [
    /* A real date, not text, so the sheet sorts and filters as one. Midnight
       UTC because exceljs writes a Date's UTC day. */
    [DATE_ROW, "Date", new Date(`${sheet.date}T00:00:00Z`)],
    [SHIFT_ROW, "Shift", SHIFT_KIND_LABELS[sheet.shift]],
    [DEPARTMENT_ROW, "Department", sheet.department ?? ALL_DEPARTMENTS],
  ];
  for (const [row, label, value] of labels) {
    const key = ws.getCell(row, 2);
    const cell = ws.getCell(row, 3);
    key.value = label;
    cell.value = value;
    key.font = cell.font = { bold: true };
    key.alignment = cell.alignment = { horizontal: "left", vertical: "middle" };
  }
  ws.getCell(DATE_ROW, 3).numFmt = "d mmmm yyyy";
}

function writeHeader(ws: ExcelJS.Worksheet, headers: string[]) {
  const row = ws.getRow(HEADER_ROW);
  row.values = ["NO", ...headers];
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = THIN;
  });
}

export async function reportWorkbook(sheet: ReportSheet): Promise<Buffer> {
  const columns = REPORT_COLUMNS[sheet.kind];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report", {
    views: [{ state: "frozen", ySplit: HEADER_ROW }],
  });
  ws.columns = [
    { width: NO_WIDTH },
    ...columns.map((c) => ({ width: WIDTHS[c.key] })),
  ];

  writeHeading(ws, sheet, columns.length + 1);
  writeHeader(
    ws,
    columns.map((c) => c.header)
  );

  sheet.rows.forEach((data, i) => {
    const row = ws.getRow(HEADER_ROW + 1 + i);
    row.values = [i + 1, ...columns.map((c) => asText(data[c.key] ?? ""))];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = col === 1 ? null : columns[col - 2]!.key;
      cell.border = THIN;
      cell.alignment = {
        horizontal: key === null || CENTRED.has(key) ? "center" : "left",
        vertical: "middle",
      };
      /* Text, so Excel keeps a NIK's leading zero — a sheet showing 50122197
         where the register says 050122197 is one somebody fails to look a
         person up with. */
      if (key === "nik") cell.numFmt = "@";
    });
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
