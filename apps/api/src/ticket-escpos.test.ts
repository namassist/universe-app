/**
 * The slip, read as text and as bytes.
 *
 * The text form is checked line by line because that is what a person holds;
 * the bytes are checked at the edges, where a missing init or cut means a
 * printer that prints the next ticket in the last one's font, or a roll nobody
 * can tear.
 *
 * Needs nothing:
 *   bun --env-file=.env test src/ticket-escpos.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
  renderTicket,
  ticketPreview,
  type TicketFields,
} from "./ticket-escpos";

const full: TicketFields = {
  nik: "506264337",
  name: "CHAIRUL ANAAM MAULIDIN",
  position: "OPERATOR",
  department: "PRODUCTION",
  seat: { unit: "DT-118", bus: "BUS 07", fleet: "EX-204", area: "PIT 3" },
  printerName: "MESIN 31 KM 31",
  at: "2026-09-14 05:02:41",
};

describe("the slip a person reads", () => {
  test("carries every field, in ShiftCorner's order", () => {
    expect(ticketPreview(full)).toBe(
      [
        "PT UNGGUL DINAMIKA UTAMA",
        "SITE PROJECT INDEXIM",
        "--------------------------------",
        "BUKTI ABSEN MASUK",
        "--------------------------------",
        "NIK            : 506264337",
        "NAMA           : CHAIRUL ANAAM MAULIDIN",
        "JABATAN        : OPERATOR",
        "DEPARTEMEN     : PRODUCTION",
        "UNIT           : DT-118",
        "NO BUS         : BUS 07",
        "FLEET          : EX-204",
        "AREA           : PIT 3",
        "NAMA PRINTER   : MESIN 31 KM 31",
        "JAM ABSEN      : 2026-09-14 05:02:41",
        "STATUS         : IN",
        "--------------------------------",
        "Terima kasih sudah disiplin absensi",
        "Utamakan keselamatan kerja",
        "Ingat keluarga menunggu di rumah",
        "--------------------------------",
      ].join("\n")
    );
  });

  /*
   * The attendance-only slip: same shape, four dashes where the allocation
   * would be. A shorter ticket would read as a printer that ran out of paper.
   */
  test("without a seat, the four lines still print as dashes", () => {
    const lines = ticketPreview({ ...full, seat: null }).split("\n");
    expect(lines).toContain("UNIT           : -");
    expect(lines).toContain("NO BUS         : -");
    expect(lines).toContain("FLEET          : -");
    expect(lines).toContain("AREA           : -");
    // Still proof of attendance, with the arrival on it.
    expect(lines).toContain("JAM ABSEN      : 2026-09-14 05:02:41");
    expect(lines).toContain("BUKTI ABSEN MASUK");
  });

  test("a unit with no bus or area shows dashes for those alone", () => {
    const lines = ticketPreview({
      ...full,
      seat: { unit: "DT-118", bus: null, fleet: null, area: null },
    }).split("\n");
    expect(lines).toContain("UNIT           : DT-118");
    expect(lines).toContain("NO BUS         : -");
  });
});

describe("the bytes a printer takes", () => {
  test("opens with a reset and ends with a cut", () => {
    const bytes = renderTicket(full);
    expect([...bytes.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...bytes.subarray(-4)]).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });

  test("selects the codepage before any text", () => {
    const bytes = renderTicket(full);
    expect([...bytes.subarray(2, 5)]).toEqual([0x1b, 0x74, 0x02]);
  });

  /* Every line the reader sees survives the encoding. */
  test("carries the fields as printable text", () => {
    const printed = renderTicket(full).toString("latin1");
    expect(printed).toContain("NIK            : 506264337");
    expect(printed).toContain("UNIT           : DT-118");
    expect(printed).toContain("BUKTI ABSEN MASUK");
  });

  test("ends every line the way a printer expects", () => {
    expect(renderTicket(full).toString("latin1")).toContain(
      "STATUS         : IN\r\n"
    );
  });
});
