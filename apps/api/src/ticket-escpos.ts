/**
 * The ticket itself: the lines a person reads, and the bytes a printer takes.
 *
 * The layout is ShiftCorner's, on purpose. Operators have been reading that
 * slip for years — the same fields in the same order, so nobody has to learn a
 * new piece of paper on the morning we switch. What changed is where the
 * middle four lines come from: ShiftCorner reads a table another system fills,
 * and we read the allocation we just made.
 *
 * Split in two so the bytes are never the only way to see it. `ticketLines`
 * is what a dry run prints to a screen and what the tests read; `renderTicket`
 * wraps those same lines in ESC/POS. A printer is not needed to review a
 * ticket, and until one is on the development network it is not available
 * either.
 */

export type TicketFields = {
  nik: string;
  name: string;
  position: string;
  department: string;
  /** Null when they hold no unit — the four lines still print, as "-". */
  seat: {
    unit: string;
    bus: string | null;
    fleet: string | null;
    area: string | null;
  } | null;
  /** The booth's paired printer, named on the slip as ShiftCorner names it. */
  printerName: string;
  /** `"YYYY-MM-DD HH:MM:SS"` — the first tap of the shift. */
  at: string;
};

const WIDTH = 32;
const RULE = "-".repeat(WIDTH);

/** `"NIK            : 5062..."` — the column ShiftCorner has always used. */
const field = (label: string, value: string) => `${label.padEnd(15)}: ${value}`;

/** Empty reads as "-", never as a blank the eye slides over. */
const orDash = (value: string | null | undefined) =>
  value && value.trim() ? value.trim() : "-";

/**
 * The ticket as text, in print order.
 *
 * Centred lines are marked rather than padded: the printer centres them, and
 * padding here would centre them twice on a 58 mm roll.
 */
export function ticketLines(fields: TicketFields): {
  centred: string[];
  body: string[];
  footer: string[];
} {
  return {
    centred: ["PT UNGGUL DINAMIKA UTAMA", "SITE PROJECT INDEXIM"],
    body: [
      field("NIK", fields.nik),
      field("NAMA", orDash(fields.name)),
      field("JABATAN", orDash(fields.position)),
      field("DEPARTEMEN", orDash(fields.department)),
      field("UNIT", orDash(fields.seat?.unit)),
      field("NO BUS", orDash(fields.seat?.bus)),
      field("FLEET", orDash(fields.seat?.fleet)),
      field("AREA", orDash(fields.seat?.area)),
      field("NAMA PRINTER", orDash(fields.printerName)),
      field("JAM ABSEN", fields.at),
      field("STATUS", "IN"),
    ],
    footer: [
      "Terima kasih sudah disiplin absensi",
      "Utamakan keselamatan kerja",
      "Ingat keluarga menunggu di rumah",
    ],
  };
}

/** A dry run's output: the whole slip as one block of text. */
export function ticketPreview(fields: TicketFields): string {
  const { centred, body, footer } = ticketLines(fields);
  return [
    ...centred,
    RULE,
    "BUKTI ABSEN MASUK",
    RULE,
    ...body,
    RULE,
    ...footer,
    RULE,
  ].join("\n");
}

/* The commands this module sends, and no others. Nothing here configures the
   printer beyond one slip: no drawer pulse, no stored logo, no settings. */
const INIT = Buffer.from([0x1b, 0x40]);
const CODEPAGE = Buffer.from([0x1b, 0x74, 0x02]);
const ALIGN_CENTRE = Buffer.from([0x1b, 0x61, 0x01]);
const ALIGN_LEFT = Buffer.from([0x1b, 0x61, 0x00]);
const BOLD_ON = Buffer.from([0x1b, 0x45, 0x01]);
const BOLD_OFF = Buffer.from([0x1b, 0x45, 0x00]);
const SIZE_NORMAL = Buffer.from([0x1d, 0x21, 0x00]);
const SIZE_DOUBLE = Buffer.from([0x1d, 0x21, 0x11]);
const FEED = Buffer.from([0x1b, 0x64, 0x06]);
/** Partial cut: the slip tears off, the roll stays threaded. */
const CUT = Buffer.from([0x1d, 0x56, 0x42, 0x00]);

/**
 * `latin1`, matching the `cp850` the reference implementation selects.
 *
 * The two agree across the printable ASCII these slips are made of; a name
 * carrying anything else would land as a different glyph rather than as a
 * failed print, which is the right way for this to be wrong.
 */
const text = (line: string) => Buffer.from(`${line}\r\n`, "latin1");

export function renderTicket(fields: TicketFields): Buffer {
  const { centred, body, footer } = ticketLines(fields);
  return Buffer.concat([
    INIT,
    CODEPAGE,
    ALIGN_CENTRE,
    BOLD_ON,
    SIZE_DOUBLE,
    text(centred[0]!),
    SIZE_NORMAL,
    text(centred[1]!),
    BOLD_OFF,
    text(RULE),
    BOLD_ON,
    text("BUKTI ABSEN MASUK"),
    BOLD_OFF,
    text(RULE),
    ALIGN_LEFT,
    ...body.map(text),
    text(RULE),
    ALIGN_CENTRE,
    BOLD_ON,
    text(footer[0]!),
    BOLD_OFF,
    ...footer.slice(1).map(text),
    text(RULE),
    Buffer.from("\r\n", "latin1"),
    FEED,
    CUT,
  ]);
}
