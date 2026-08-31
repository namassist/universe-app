/**
 * The roster vocabulary: what a day can say about a person.
 *
 * Written here rather than as a master catalogue (design D1) because every code
 * carries a `kind` the allocation engine reads, and a `kind` an operator can
 * fill in through a form is a `kind` that can be filled in wrong. The symptom
 * of a wrong one is not an error — it is an operator who is never picked, or a
 * unit that sits idle at 05:30. Adding a code is therefore a code change plus a
 * migration, which is what it should be.
 *
 * Three consumers read this list and none of them may be the source: the
 * Postgres enum `roster_code` is generated from it, the API's TypeBox schemas
 * validate against it, and the client renders the legend from it.
 */

/**
 * The twenty-nine codes of the roster legend, in legend order.
 *
 * `R` and `STB` are here because they can appear in a real file and a parser
 * must not refuse a legitimate row (D3) — not because allocation reads them.
 *
 * `SICK` sits beside `S` rather than replacing it: both mean illness, and both
 * are `absent`, but `S` is the day someone calls in and `SICK` is the long
 * absence that is already known about. Allocation cannot tell them apart — to
 * it they are equally unavailable — while Attendance can, which is the whole
 * reason the two are separate cells in a roster file.
 */
export const ROSTER_CODES = [
  "D",
  "N",
  "R",
  "STB",
  "OFF",
  "CR",
  "AL",
  "LWP",
  "LWOP",
  "PH",
  "PHD",
  "S",
  "SICK",
  "A",
  "MCU",
  "MCR",
  "MCUF",
  "ISM",
  "OBC",
  "KRT",
  "TGS",
  "DNS",
  "TRV",
  "TR",
  "TRS",
  "IN",
  "TERM",
  "EOC",
  "RSG",
] as const;
export type RosterCode = (typeof ROSTER_CODES)[number];

/** Type guard for a code arriving from the wire or a spreadsheet cell. */
export function isRosterCode(value: string): value is RosterCode {
  return (ROSTER_CODES as readonly string[]).includes(value);
}

/**
 * What a code *means* operationally (design D2) — deliberately not the same
 * axis as the legend grouping below, which is presentation.
 *
 * Nine kinds is finer than allocation needs: to it, everything except `day` and
 * `night` collapses into "not available". But Attendance and Fit To Work read
 * the same axis asking a different question — *why* is this person not here —
 * and collapsing it now means splitting it again later out of a column already
 * written.
 */
export const ROSTER_CODE_KINDS = [
  /** Scheduled, day shift. */
  "day",
  /** Scheduled, night shift. */
  "night",
  /** Working, but not in a shift slot. */
  "working",
  /** Planned time off. */
  "off",
  /** Not present, unplanned. */
  "absent",
  /** Unavailable, scheduled medical. */
  "medical",
  /** Unavailable, unplanned isolation. */
  "isolated",
  /** Unavailable, elsewhere on company business. */
  "assignment",
  /** No longer an employee. */
  "ended",
] as const;
export type RosterCodeKind = (typeof ROSTER_CODE_KINDS)[number];

/**
 * The only definition of a code's kind.
 *
 * `Record<RosterCode, …>` rather than a partial map on purpose: adding a code
 * to `ROSTER_CODES` without classifying it is a type error here, which is the
 * one place the omission is cheap to find.
 *
 * The kind is never stored beside a roster day — it is resolved from the code
 * on read, so a stored row cannot disagree with the classification.
 */
export const ROSTER_CODE_KIND: Record<RosterCode, RosterCodeKind> = {
  D: "day",
  N: "night",
  R: "working",
  STB: "working",
  OFF: "off",
  CR: "off",
  AL: "off",
  LWP: "off",
  LWOP: "off",
  PH: "off",
  PHD: "off",
  S: "absent",
  SICK: "absent",
  A: "absent",
  MCU: "medical",
  MCR: "medical",
  MCUF: "medical",
  ISM: "isolated",
  OBC: "isolated",
  KRT: "isolated",
  TGS: "assignment",
  DNS: "assignment",
  TRV: "assignment",
  TR: "assignment",
  TRS: "assignment",
  IN: "assignment",
  TERM: "ended",
  EOC: "ended",
  RSG: "ended",
};

export const rosterCodeKind = (code: RosterCode): RosterCodeKind =>
  ROSTER_CODE_KIND[code];

/* ------------------------------------------------------------ derived shape */

/**
 * The two codes that mean "scheduled for a shift", derived rather than written
 * twice, so no caller has to spell `code === "D"` for itself (D2, D3).
 */
export const DAY_SHIFT_CODE: RosterCode = "D";
export const NIGHT_SHIFT_CODE: RosterCode = "N";

/**
 * The two shifts a day is divided into, as their own vocabulary.
 *
 * They were already here twice over — as the first two `ROSTER_CODE_KINDS` and
 * as a `"day" | "night"` literal repeated at every call site. A shift is now a
 * thing the timeline carries too, so it gets a name rather than a fourth copy.
 */
export const SHIFT_KINDS = ["day", "night"] as const;
export type ShiftKind = (typeof SHIFT_KINDS)[number];

/** Indonesian labels — presentation, unlike the values above. */
export const SHIFT_KIND_LABELS: Record<ShiftKind, string> = {
  day: "Siang",
  night: "Malam",
};

/** The shift a code schedules, or `null` if it schedules none. */
export function rosterShift(code: RosterCode): ShiftKind | null {
  const kind = ROSTER_CODE_KIND[code];
  return kind === "day" || kind === "night" ? kind : null;
}

/** Whether the code means the employee is scheduled for a shift at all. */
export function isScheduledCode(code: RosterCode): boolean {
  return rosterShift(code) !== null;
}

/** The code that schedules a given shift — the inverse of `rosterShift`. */
export function shiftCode(shift: ShiftKind): RosterCode {
  return shift === "day" ? DAY_SHIFT_CODE : NIGHT_SHIFT_CODE;
}

/** Codes meaning employment has ended — reported by the import, never applied. */
export const ENDED_CODES = ROSTER_CODES.filter(
  (code) => ROSTER_CODE_KIND[code] === "ended"
);

/* -------------------------------------------------------------- legend groups */

/**
 * How the legend is *shown* (design D2) — presentation only, never the axis
 * allocation reads.
 *
 * It differs from `kind` on purpose: "Medis & karantina" is one group here and
 * two kinds (`medical`, `isolated`) above, because scheduled and sudden
 * unavailability are the same thing to a reader of the legend and different
 * things to whoever fills a shift.
 *
 * Carries codes and order only. The label of a group and the gloss of a code
 * are translated text, and translated text stays in the web app's i18n.
 */
export const ROSTER_LEGEND_GROUPS = [
  { id: "shift", codes: ["D", "N", "R", "STB", "OFF"] },
  { id: "leave", codes: ["CR", "AL", "LWP", "LWOP", "PH", "PHD"] },
  { id: "absence", codes: ["S", "SICK", "A"] },
  { id: "medical", codes: ["MCU", "MCR", "MCUF", "ISM", "OBC", "KRT"] },
  { id: "assignment", codes: ["TGS", "DNS", "TRV", "TR", "TRS", "IN"] },
  { id: "employment", codes: ["TERM", "EOC", "RSG"] },
] as const satisfies readonly { id: string; codes: readonly RosterCode[] }[];

export type RosterLegendGroupId = (typeof ROSTER_LEGEND_GROUPS)[number]["id"];

/* ------------------------------------------------------------ document status */

/**
 * A roster document is either the one in force or history (design D5).
 *
 * Re-uploading a month archives the previous document rather than overwriting
 * it, so `arsip` is a document that still holds every row it held that day —
 * readable, never decidable, never read by allocation.
 */
export const ROSTER_DOCUMENT_STATUSES = ["aktif", "arsip"] as const;
export type RosterDocumentStatus = (typeof ROSTER_DOCUMENT_STATUSES)[number];

export function isRosterDocumentStatus(
  value: string
): value is RosterDocumentStatus {
  return (ROSTER_DOCUMENT_STATUSES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------ revision status */

/**
 * The status of one revision entry (design D10).
 *
 * On the entry, not on the submission: one submission of three entries can end
 * two approved and one rejected, and forcing a single verdict would make an
 * approver refuse the whole thing over one wrong row.
 */
export const ROSTER_REVISION_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const;
export type RosterRevisionStatus = (typeof ROSTER_REVISION_STATUSES)[number];

export function isRosterRevisionStatus(
  value: string
): value is RosterRevisionStatus {
  return (ROSTER_REVISION_STATUSES as readonly string[]).includes(value);
}
