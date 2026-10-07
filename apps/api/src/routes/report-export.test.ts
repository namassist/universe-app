/**
 * The report workbook is the site's template, rebuilt: a sheet printed and
 * filed beside last month's has to look like last month's.
 */

import { describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";

import { reportWorkbook } from "./report-export";

async function read(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.worksheets[0]!;
}

describe("reportWorkbook", () => {
  test("title, date, shift and department above the table, as the template", async () => {
    const ws = await read(
      await reportWorkbook({
        kind: "final-validation",
        date: "2026-09-11",
        shift: "day",
        department: "Mining Operation",
        rows: [],
      })
    );
    expect(ws.getCell("A1").value).toBe("FINAL VALIDATION REPORT");
    /* NO + nine columns: the title spans A..J. */
    expect(ws.getCell("A1").isMerged).toBe(true);
    expect(ws.getCell("J1").master.address).toBe("A1");
    expect(ws.getCell("B3").value).toBe("Date");
    expect(ws.getCell("C3").value).toEqual(new Date("2026-09-11T00:00:00Z"));
    expect(ws.getCell("C3").numFmt).toBe("d mmmm yyyy");
    expect(ws.getCell("B4").value).toBe("Shift");
    expect(ws.getCell("C4").value).toBe("Siang");
    expect(ws.getCell("B5").value).toBe("Department");
    expect(ws.getCell("C5").value).toBe("Mining Operation");
  });

  test("no department filter reads Semua", async () => {
    const ws = await read(
      await reportWorkbook({
        kind: "operator-no-finger",
        date: "2026-09-11",
        shift: "night",
        department: null,
        rows: [],
      })
    );
    expect(ws.getCell("C4").value).toBe("Malam");
    expect(ws.getCell("C5").value).toBe("Semua");
  });

  test("the header row is row 6, NO first, in the template's words and colour", async () => {
    const ws = await read(
      await reportWorkbook({
        kind: "operator-no-ftw",
        date: "2026-09-11",
        shift: "day",
        department: null,
        rows: [],
      })
    );
    expect(ws.getRow(6).values).toEqual([
      undefined,
      "NO",
      "NIK",
      "NAMA",
      "ROSTER",
      "POSISI",
      "DEPARTMENT",
      "STATUS SAVERA",
    ]);
    const head = ws.getCell("B6");
    expect(head.font.bold).toBe(true);
    expect(head.font.color?.argb).toBe("FFFFFFFF");
    expect(head.fill).toMatchObject({ fgColor: { argb: "FF4E73DF" } });
  });

  test("rows start at 7, numbered, with the NIK kept as text", async () => {
    const ws = await read(
      await reportWorkbook({
        kind: "operator-no-equipment",
        date: "2026-09-11",
        shift: "day",
        department: null,
        rows: [
          {
            nik: "050721065",
            name: "Ali Usman",
            position: "Excavator 80-150T Operator",
            department: "Mining Operation",
            simperMatrix: "EXC 1200; PC 200",
          },
          { nik: "50822370", name: "Imam Supriadi" },
        ],
      })
    );
    expect(ws.getRow(7).values).toEqual([
      undefined,
      1,
      "050721065",
      "Ali Usman",
      "Excavator 80-150T Operator",
      "Mining Operation",
      "EXC 1200; PC 200",
    ]);
    expect(ws.getCell("B7").numFmt).toBe("@");
    /* A column the row has nothing for is an empty cell, not "undefined". */
    expect(ws.getCell("F8").value).toBe("");
    expect(ws.getCell("A8").value).toBe(2);
    expect(ws.getCell("A8").border.left?.style).toBe("thin");
  });

  test("the table's header stays in view while scrolling", async () => {
    const ws = await read(
      await reportWorkbook({
        kind: "equipment-no-operator",
        date: "2026-09-11",
        shift: "day",
        department: null,
        rows: [],
      })
    );
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 6 });
  });
  test("text that would start a formula is written as text", async () => {
    /* savera's free text reaches STATUS SAVERA; a sheet is filed and reopened
       in clients that are less careful than exceljs about a leading "=". */
    const ws = await read(
      await reportWorkbook({
        kind: "operator-no-ftw",
        date: "2026-09-11",
        shift: "day",
        department: null,
        rows: [
          {
            nik: "501",
            name: "@SUM(A1)",
            saveraStatus: '=HYPERLINK("http://x","y")',
            position: "+62 Operator",
            department: "-Mining",
          },
        ],
      })
    );
    expect(ws.getCell("C7").value).toBe("'@SUM(A1)");
    expect(ws.getCell("G7").value).toBe('\'=HYPERLINK("http://x","y")');
    expect(ws.getCell("E7").value).toBe("'+62 Operator");
    expect(ws.getCell("F7").value).toBe("'-Mining");
    /* Nothing else is touched. */
    expect(ws.getCell("B7").value).toBe("501");
  });
});
