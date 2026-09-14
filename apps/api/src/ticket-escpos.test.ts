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
  role: "standing",
  ftw: "Dapat Bekerja",
  hazards: ["PIT TEMPUDO", "KASTURI ATAS"],
  safety: ["Wajib P2H sebelum mengoperasikan unit."],
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
        "JENIS OPERATOR : TETAP",
        "UNIT           : DT-118",
        "NO BUS         : BUS 07",
        "FLEET          : EX-204",
        "AREA           : PIT 3",
        "NAMA PRINTER   : MESIN 31 KM 31",
        "JAM ABSEN      : 2026-09-14 05:02:41",
        "STATUS         : IN",
        "--------------------------------",
        "STATUS FTW",
        "Dapat Bekerja",
        "--------------------------------",
        "LOKASI BERBAHAYA",
        "PIT TEMPUDO, KASTURI ATAS",
        "--------------------------------",
        "PESAN SAFETY",
        "- Wajib P2H sebelum",
        "  mengoperasikan unit.",
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

describe("fit to work, on the slip", () => {
  /* The hours slept were on it for a day and the owner took them off: what
     gets acted on is the category, and a number beside it invites arguing
     with the rule at the booth. */
  test("carries the category and no reading behind it", () => {
    const lines = ticketPreview(full).split("\n");
    expect(lines).toContain("STATUS FTW");
    expect(lines).toContain("Dapat Bekerja");
    for (const line of lines) expect(line).not.toMatch(/\d+j \d+m/);
  });

  /* Twenty-three characters against a field column that leaves fifteen: as a
     `LABEL : value` line this would break mid word every time. */
  test("the longest category fits the roll whole", () => {
    const lines = ticketPreview({
      ...full,
      ftw: "Istirahat Minimal 1 Jam",
    }).split("\n");
    expect(lines).toContain("Istirahat Minimal 1 Jam");
    expect(lines[lines.indexOf("STATUS FTW") + 1]).toBe(
      "Istirahat Minimal 1 Jam"
    );
  });

  test("nothing uploaded says so rather than leaving a blank", () => {
    const lines = ticketPreview({ ...full, ftw: null }).split("\n");
    expect(lines).toContain("STATUS FTW");
    expect(lines).toContain("Belum mengisi FTW");
  });
});

describe("how a person came to the muster", () => {
  test("a spare prints SPARE even holding a unit", () => {
    /* The allocation at the second finger gives him a unit; it does not turn
       him into somebody who was on the plan. */
    const lines = ticketPreview({ ...full, role: "spare" }).split("\n");
    expect(lines).toContain("JENIS OPERATOR : SPARE");
    expect(lines).toContain("UNIT           : DT-118");
  });

  /* Two `LABEL : value` lines beginning with STATUS would be read as one
     thing said twice; the fit-to-work one is a section heading instead. */
  test("does not collide with the tap's own status line", () => {
    const lines = ticketPreview(full).split("\n");
    expect(lines.filter((l) => l.startsWith("STATUS"))).toEqual([
      "STATUS         : IN",
      "STATUS FTW",
    ]);
  });
});

describe("the hazards and the safety message", () => {
  test("locations are joined, wrapped at the roll's width", () => {
    const lines = ticketPreview({
      ...full,
      hazards: [
        "PIT TEMPUDO",
        "KASTURI ATAS",
        "RAMP 3",
        "SIMPANG 4 KM 12",
        "DISPOSAL UTARA",
        "JEMBATAN KM 9",
        "WASHING PAD",
        "FRONT B2",
      ],
    }).split("\n");
    expect(lines).toContain("LOKASI BERBAHAYA");
    const start = lines.indexOf("LOKASI BERBAHAYA");
    const listed = lines.slice(start + 1, lines.indexOf("PESAN SAFETY") - 1);
    expect(listed.join(" ")).toContain("PIT TEMPUDO, KASTURI ATAS");
    expect(listed.join(" ")).toContain("FRONT B2");
    for (const line of listed) expect(line.length).toBeLessThanOrEqual(32);
  });

  /* Each is an instruction; joined they would read as one long order. */
  test("safety lines stay separate, with the continuation hanging", () => {
    const lines = ticketPreview({
      ...full,
      safety: [
        "Patuhi batas kecepatan 40 km/jam di jalan hauling.",
        "Lapor P5M di front masing-masing.",
      ],
    }).split("\n");
    expect(lines).toContain("- Patuhi batas kecepatan 40");
    expect(lines).toContain("  km/jam di jalan hauling.");
    expect(lines).toContain("- Lapor P5M di front");
    expect(lines).toContain("  masing-masing.");
  });

  /* A heading with nothing under it reads as a printer that lost a line. */
  test("a section with nothing set does not print its heading", () => {
    const lines = ticketPreview({ ...full, hazards: [], safety: [] }).split(
      "\n"
    );
    expect(lines).not.toContain("LOKASI BERBAHAYA");
    expect(lines).not.toContain("PESAN SAFETY");
    expect(lines).toContain("BUKTI ABSEN MASUK");
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
