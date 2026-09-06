/**
 * A roster month as a spreadsheet.
 *
 * All that is left of the roster importer, which was deleted when unggul_att
 * became the source of truth for the schedule (2026-09-06). Reading a month
 * out is still worth having — the sheet is printed, circulated and signed —
 * and nothing about that depended on being able to read one back in.
 *
 * Generated from the stored days rather than from a file, because there is no
 * file: even under the importer, `IMPORT_DIR` kept an upload for half an hour
 * and no longer, and an approved revision had already moved the document on
 * from whatever was uploaded.
 */

import ExcelJS from "exceljs";
import type { RosterCode } from "@universe/contracts";

import { dayHeader, monthDays } from "./roster-month";

const HEADER_ROW = 1;

/** One line of a roster sheet: the person, then their month if it has one. */
export type RosterSheetPerson = {
  nik: string;
  name: string;
  department: string;
  position: string;
  /** One entry per day of the month, aligned to `monthDays()`. */
  codes?: (RosterCode | null)[];
};

/**
 * The department's roster sheet.
 *
 * The shape is the planner's own workbook rather than a minimal one: the sheet
 * is printed, circulated and signed, and one that drops the columns a
 * supervisor uses to find their people is one they will keep maintaining
 * separately.
 *
 * The NIK is written as text rather than a number on purpose: Excel drops a
 * leading zero from anything it reads as numeric, and a sheet that shows
 * 50122197 where the register says 050122197 is a sheet somebody will use to
 * look a person up and fail to find them.
 */
export async function rosterWorkbook(
  monthFirstDay: string,
  people: RosterSheetPerson[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("roster");
  const days = monthDays(monthFirstDay);
  ws.columns = [
    { header: "NO", key: "no", width: 5 },
    { header: "NIK", key: "nik", width: 15 },
    { header: "NAMA", key: "nama", width: 30 },
    { header: "DEPARTEMEN", key: "departemen", width: 40 },
    { header: "POSISI", key: "posisi", width: 60 },
    ...days.map((date) => ({ header: dayHeader(date), key: date, width: 12 })),
  ];
  ws.getRow(HEADER_ROW).font = { bold: true };

  people.forEach((person, i) => {
    const row = ws.addRow({
      no: i + 1,
      nik: person.nik,
      nama: person.name,
      departemen: person.department,
      posisi: person.position,
      ...Object.fromEntries(
        days.map((date, d) => [date, person.codes?.[d] ?? ""])
      ),
    });
    row.getCell("nik").numFmt = "@";
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
