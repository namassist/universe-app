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
  /**
   * How this person came to the muster: holding a unit in the plan, or not.
   *
   * Printed even for a spare who is given a unit at the second finger. The
   * line says how he arrived; the UNIT line says where he ended up, and the
   * two together are what a supervisor needs to read off one slip.
   */
  role: "standing" | "spare";
  /**
   * Fit to work, as savera judged it — null when nothing was uploaded.
   *
   * The verdict alone. The slip carried the hours slept for a day and the
   * owner took them off again: what an operator and his supervisor act on is
   * the category, and a number beside it invites arguing with the rule at the
   * booth rather than reading what it decided.
   */
  ftw: string | null;
  /** Bare place names for this shift, already capped. */
  hazards: string[];
  /** The safety lines for this shift, already capped. */
  safety: string[];
};

const WIDTH = 32;
const RULE = "-".repeat(WIDTH);

/**
 * Break a sentence at the roll's width rather than letting the printer do it.
 *
 * A thermal printer wraps by cutting at the 33rd character, which lands mid
 * word — fine for a name, wrong for a safety instruction somebody is meant to
 * act on. `indent` hangs the continuation under the text of a bullet instead
 * of under its dash.
 */
function wrapAt(sentence: string, indent = ""): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of sentence.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > WIDTH && line) {
      out.push(line);
      line = indent + word;
    } else line = candidate;
  }
  if (line) out.push(line);
  return out;
}

/** TETAP or SPARE, in the words operators use over the radio. */
const ROLE_WORD: Record<TicketFields["role"], string> = {
  standing: "TETAP",
  spare: "SPARE",
};

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
  /**
   * One line, and the only shape that is one.
   *
   * The slip's own `LABEL : value` column leaves fifteen characters and the
   * longest category runs to twenty-three, so the aligned form breaks mid word
   * on every operator told to rest an hour — forty columns against a roll that
   * holds thirty-two. A short label outside the column fits all five: "FTW:
   * Istirahat Minimal 1 Jam" is twenty-eight. Losing the alignment is what
   * buys the single line.
   */
  ftw: string;
  /** Named sections, each already wrapped. Empty when nothing is set. */
  notices: { heading: string; lines: string[] }[];
  footer: string[];
} {
  return {
    centred: ["PT UNGGUL DINAMIKA UTAMA", "SITE PROJECT INDEXIM"],
    body: [
      field("NIK", fields.nik),
      field("NAMA", orDash(fields.name)),
      field("JABATAN", orDash(fields.position)),
      field("DEPARTEMEN", orDash(fields.department)),
      /* Above UNIT on purpose: somebody reading a dash there finds the reason
         for it on the line before. */
      field("JENIS OPERATOR", ROLE_WORD[fields.role]),
      field("UNIT", orDash(fields.seat?.unit)),
      field("NO BUS", orDash(fields.seat?.bus)),
      field("FLEET", orDash(fields.seat?.fleet)),
      field("AREA", orDash(fields.seat?.area)),
      field("NAMA PRINTER", orDash(fields.printerName)),
      field("JAM ABSEN", fields.at),
      field("STATUS", "IN"),
    ],
    ftw: `FTW: ${fields.ftw ?? "Belum mengisi FTW"}`,
    notices: [
      ...(fields.hazards.length
        ? [
            {
              heading: "LOKASI BERBAHAYA",
              /* Joined, not listed: they are place names without detail, and a
                 dash in front of each would cost a line apiece. */
              lines: wrapAt(fields.hazards.join(", ")),
            },
          ]
        : []),
      ...(fields.safety.length
        ? [
            {
              heading: "PESAN SAFETY",
              /* Listed, not joined: each is an instruction, and running them
                 together would make one sentence out of three orders. */
              lines: fields.safety.flatMap((line) => wrapAt(`- ${line}`, "  ")),
            },
          ]
        : []),
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
  const { centred, body, ftw, notices, footer } = ticketLines(fields);
  return [
    ...centred,
    RULE,
    "BUKTI ABSEN MASUK",
    RULE,
    ...body,
    RULE,
    ftw,
    ...notices.flatMap((section) => [RULE, section.heading, ...section.lines]),
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
  const { centred, body, ftw, notices, footer } = ticketLines(fields);
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
    /* Bold: it is the line that decides whether he works today. */
    BOLD_ON,
    text(ftw),
    BOLD_OFF,
    ...notices.flatMap((section) => [
      text(RULE),
      BOLD_ON,
      text(section.heading),
      BOLD_OFF,
      ...section.lines.map(text),
    ]),
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
