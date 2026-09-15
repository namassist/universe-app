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
  nik: "501241775",
  name: "Ruben Lottong",
  position: "Operator OHT",
  department: "MINING OPERATION",
  seat: {
    unit: "DT4027",
    bus: "RBU26",
    fleet: "EX4012",
    area: "PANEL EAST - UTARA BAWAH",
  },
  printerName: "MESIN 31 KM 31",
  at: "2026-09-15 17:12:04",
  role: "standing",
  ftw: "Dapat Bekerja",
  hazards: ["KASTURI BAWAH", "KASTURI ATAS"],
  safety: ["BAHAYA FATIGUE MENULAR", "SESUAI APLIKASI"],
};

describe("the slip a person reads", () => {
  /* The owner's format of 2026-09-15, line for line. */
  test("carries every field in the owner's order", () => {
    expect(ticketPreview(full)).toBe(
      [
        "PT UNGGUL DINAMIKA UTAMA",
        "SITE PROJECT INDEXIM",
        "--------------------------------",
        "NIK            : 501241775",
        "NAMA           : Ruben Lottong",
        "JABATAN        : Operator OHT",
        "DEPARTEMEN     : MINING OPERATION",
        "UNIT           : DT4027",
        "NO BUS         : RBU26",
        "FLEET          : EX4012",
        "AREA           : PANEL EAST - UTARA BAWAH",
        "NAMA PRINTER   : MESIN 31 KM 31",
        "JAM ABSEN      : 2026-09-15 17:12:04",
        "STATUS         : IN",
        "FTW            : Dapat Bekerja",
        "--------------------------------",
        "LOKASI BERBAHAYA",
        "KASTURI BAWAH, KASTURI ATAS",
        "--------------------------------",
        "BAHAYA FATIGUE MENULAR",
        "SESUAI APLIKASI",
        "--------------------------------",
      ].join("\n")
    );
  });

  /* Taken off the paper by the owner; the slip still stores the kind for the
     Tiket menu's filter. */
  test("prints no title, no operator kind and no thank-you lines", () => {
    const text = ticketPreview({ ...full, role: "spare" });
    expect(text).not.toContain("BUKTI ABSEN MASUK");
    expect(text).not.toContain("JENIS OPERATOR");
    expect(text).not.toContain("SPARE");
    expect(text).not.toContain("PESAN SAFETY");
    expect(text).not.toContain("Terima kasih");
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
    expect(lines).toContain("JAM ABSEN      : 2026-09-15 17:12:04");
  });

  /* The owner's scenarios of 2026-09-15: an operator without a unit reads
     SPARE whatever the reason, and his FTW line says which. */
  test("an operator without a unit reads SPARE, the other three dashes", () => {
    const lines = ticketPreview({
      ...full,
      seat: null,
      withoutUnit: "spare",
    }).split("\n");
    expect(lines).toContain("UNIT           : SPARE");
    expect(lines).toContain("NO BUS         : -");
    expect(lines).toContain("FLEET          : -");
    expect(lines).toContain("AREA           : -");
  });

  /* A standby employee, a mechanic who tapped, a slip stored before. */
  test("anybody the board never considers keeps the dash", () => {
    const lines = ticketPreview({ ...full, seat: null }).split("\n");
    expect(lines).toContain("UNIT           : -");
  });

  test("a seat always wins over SPARE", () => {
    const lines = ticketPreview({ ...full, withoutUnit: "spare" }).split("\n");
    expect(lines).toContain("UNIT           : DT4027");
  });

  test("a unit with no bus or area shows dashes for those alone", () => {
    const lines = ticketPreview({
      ...full,
      seat: { unit: "DT4027", bus: null, fleet: null, area: null },
    }).split("\n");
    expect(lines).toContain("UNIT           : DT4027");
    expect(lines).toContain("NO BUS         : -");
  });
});

describe("fit to work, on the slip", () => {
  test("sits in the field column, right under STATUS", () => {
    const lines = ticketPreview(full).split("\n");
    const status = lines.indexOf("STATUS         : IN");
    expect(lines[status + 1]).toBe("FTW            : Dapat Bekerja");
  });

  /* The column costs the longest categories a second line. Broken at a word
     and hung under the value, never cut mid word by the printer. */
  test("a long category wraps under its value, inside the roll", () => {
    const cases: Record<string, string[]> = {
      "Istirahat Minimal 1 Jam": [
        "FTW            : Istirahat",
        "                 Minimal 1 Jam",
      ],
      "Tidak Boleh Bekerja": [
        "FTW            : Tidak Boleh",
        "                 Bekerja",
      ],
    };
    for (const [category, expected] of Object.entries(cases)) {
      const lines = ticketPreview({ ...full, ftw: category }).split("\n");
      const at = lines.findIndex((l) => l.startsWith("FTW "));
      expect(lines.slice(at, at + 2)).toEqual(expected);
      for (const line of expected) expect(line.length).toBeLessThanOrEqual(32);
    }
  });

  test("nothing uploaded says so rather than leaving a blank", () => {
    const lines = ticketPreview({ ...full, ftw: null }).split("\n");
    expect(lines).toContain("FTW            : Belum Upload");
  });

  /* Two lines beginning with STATUS would be read as one thing said twice. */
  test("does not collide with the tap's own status line", () => {
    const lines = ticketPreview(full).split("\n");
    expect(lines.filter((l) => l.startsWith("STATUS"))).toEqual([
      "STATUS         : IN",
    ]);
  });
});

describe("the hazards and the safety messages", () => {
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
    const start = lines.indexOf("LOKASI BERBAHAYA");
    expect(start).toBeGreaterThan(-1);
    const listed = lines.slice(
      start + 1,
      lines.indexOf(lines[start - 1]!, start)
    );
    expect(listed.join(" ")).toContain("PIT TEMPUDO, KASTURI ATAS");
    expect(listed.join(" ")).toContain("FRONT B2");
    for (const line of listed) expect(line.length).toBeLessThanOrEqual(32);
  });

  /* Each is an instruction; joined they would read as one long order. */
  test("each safety message wraps on its own, with no bullet", () => {
    const lines = ticketPreview({
      ...full,
      safety: [
        "Patuhi batas kecepatan 40 km/jam di jalan hauling.",
        "Lapor P5M di front masing-masing.",
      ],
    }).split("\n");
    expect(lines.slice(-5)).toEqual([
      "Patuhi batas kecepatan 40 km/jam",
      "di jalan hauling.",
      "Lapor P5M di front",
      "masing-masing.",
      "--------------------------------",
    ]);
  });

  /* A heading or a rule with nothing under it reads as a lost line. */
  test("a section with nothing set leaves no trace", () => {
    const lines = ticketPreview({ ...full, hazards: [], safety: [] }).split(
      "\n"
    );
    expect(lines).not.toContain("LOKASI BERBAHAYA");
    expect(lines.slice(-2)).toEqual([
      "FTW            : Dapat Bekerja",
      "--------------------------------",
    ]);
  });
});

describe("the bytes a printer takes", () => {
  const BOLD_ON = "\x1b\x45\x01";
  const BOLD_OFF = "\x1b\x45\x00";
  const CENTRE = "\x1b\x61\x01";

  test("opens with a reset and ends with a cut", () => {
    const bytes = renderTicket(full);
    expect([...bytes.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...bytes.subarray(-4)]).toEqual([0x1d, 0x56, 0x42, 0x00]);
  });

  test("selects the codepage before any text", () => {
    const bytes = renderTicket(full);
    expect([...bytes.subarray(2, 5)]).toEqual([0x1b, 0x74, 0x02]);
  });

  /* Bold: it is the line that decides whether he works today. */
  test("prints the fit-to-work line in bold", () => {
    expect(renderTicket(full).toString("latin1")).toContain(
      `${BOLD_ON}FTW            : Dapat Bekerja\r\n${BOLD_OFF}`
    );
  });

  test("centres the safety messages", () => {
    expect(renderTicket(full).toString("latin1")).toContain(
      `${CENTRE}BAHAYA FATIGUE MENULAR\r\nSESUAI APLIKASI\r\n`
    );
  });

  test("ends every line the way a printer expects", () => {
    expect(renderTicket(full).toString("latin1")).toContain(
      "STATUS         : IN\r\n"
    );
  });
});

/* The spare pool's ride (owner, 2026-09-15): a slip reading UNIT SPARE names
   the spare buses and where they wait; FLEET stays a dash. */
describe("the spare bus on a SPARE slip", () => {
  const spareRide = { buses: ["RBU26", "RBU27"], area: "PARKIRAN KASTURI" };

  test("NO BUS names both buses, AREA the place, FLEET a dash", () => {
    const lines = ticketPreview({
      ...full,
      seat: null,
      withoutUnit: "spare",
      spareRide,
    }).split("\n");
    expect(lines).toContain("UNIT           : SPARE");
    expect(lines).toContain("NO BUS         : RBU26/RBU27");
    expect(lines).toContain("FLEET          : -");
    expect(lines).toContain("AREA           : PARKIRAN KASTURI");
  });

  test("a seat prints its own ride, not the spare bus", () => {
    const lines = ticketPreview({
      ...full,
      withoutUnit: "spare",
      spareRide,
    }).split("\n");
    expect(lines).toContain("NO BUS         : RBU26");
    expect(lines).toContain("AREA           : PANEL EAST - UTARA BAWAH");
  });

  test("somebody reading a dash rides nothing", () => {
    const lines = ticketPreview({ ...full, seat: null, spareRide }).split("\n");
    expect(lines).toContain("UNIT           : -");
    expect(lines).toContain("NO BUS         : -");
    expect(lines).toContain("AREA           : -");
  });
});
