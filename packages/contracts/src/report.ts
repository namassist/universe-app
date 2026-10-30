/**
 * The Report menu's vocabulary: which reports exist, what they are called, and
 * the columns each one prints.
 *
 * The columns live here rather than in either app because two things render
 * them — the table on screen and the workbook the API writes — and a report
 * whose export carries a column the screen does not (or the other way round)
 * is one somebody reconciles by hand. The headers are the site's own template
 * workbooks' (kept out of the repo; the latest sits locally at
 * `apps/web/docs/templates/`), word for word, English and Indonesian
 * mixed as they were: the sheets are printed and read against earlier ones.
 */

export const REPORT_KINDS = [
  "equipment-no-operator",
  "operator-no-equipment",
  "operator-no-ftw",
  "operator-no-finger",
  "final-validation",
  "induction-operators",
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

/** Type guard for a `:kind` path segment arriving from the wire. */
export function isReportKind(value: string): value is ReportKind {
  return (REPORT_KINDS as readonly string[]).includes(value);
}

/** The card's name — what somebody picks a report by. */
export const REPORT_LABELS: Record<ReportKind, string> = {
  "equipment-no-operator": "Equipment No Operator",
  "operator-no-equipment": "Operator No Equipment",
  "operator-no-ftw": "Operator No FTW",
  "operator-no-finger": "Operator No Finger",
  "final-validation": "Final Validation",
  "induction-operators": "Induction Operators",
};

/** The card's one-line answer to "what is this for". */
export const REPORT_DESCRIPTIONS: Record<ReportKind, string> = {
  "equipment-no-operator": "Unit di papan yang tidak mendapat operator",
  "operator-no-equipment":
    "Operator yang sudah finger dan FTW-nya oke, tetapi tidak mendapat unit",
  "operator-no-ftw":
    "Operator terjadwal yang sudah finger, tetapi FTW-nya tidak lolos atau belum upload",
  "operator-no-finger": "Operator terjadwal yang tidak tap atau terlambat tap",
  "final-validation": "Hasil akhir alokasi: setiap operator dan unitnya",
  "induction-operators":
    "Operator yang hari ini standby karena induksi, hari pertama kembali dari cuti",
};

/**
 * Whether a report reads the generated board. The others read readiness
 * alone — who tapped, who passed FTW — or the employee register, which stand
 * whether or not the board was built, so an ungenerated board is not a reason
 * to show them empty.
 */
export const REPORT_NEEDS_BOARD: Record<ReportKind, boolean> = {
  "equipment-no-operator": true,
  "operator-no-equipment": true,
  "operator-no-ftw": false,
  "operator-no-finger": false,
  "final-validation": true,
  "induction-operators": false,
};

/**
 * Whether a report is read for today, as a whole day, and nothing else: no
 * date to pick and no shift (owner, 2026-10-30).
 *
 * Induction Operators reads who is held on standby right now, as the employee
 * register says. Induction is the day an operator is back from leave,
 * whichever shift they were rostered to, and a hold is released the next day,
 * so no other day can be read from it honestly.
 */
export const REPORT_TODAY_ONLY: Record<ReportKind, boolean> = {
  "equipment-no-operator": false,
  "operator-no-equipment": false,
  "operator-no-ftw": false,
  "operator-no-finger": false,
  "final-validation": false,
  "induction-operators": true,
};

/** The sheet's title row, as the template spells it. */
export const REPORT_TITLES: Record<ReportKind, string> = {
  "equipment-no-operator": "EQUIPMENT NO OPERATOR REPORT",
  "operator-no-equipment": "OPERATOR NO EQUIPMENT REPORT",
  "operator-no-ftw": "OPERATOR NO FIT TO WORK REPORT",
  "operator-no-finger": "OPERATOR NO FINGER REPORT",
  "final-validation": "FINAL VALIDATION REPORT",
  "induction-operators": "OPERATOR INDUKSI",
};

/** Every cell a report row can carry. `NO` is the row's position, not a key. */
export type ReportColumnKey =
  | "unit"
  | "simperCode"
  | "fleet"
  | "bus"
  | "location"
  | "nik"
  | "name"
  | "roster"
  | "position"
  | "department"
  | "simperMatrix"
  | "saveraStatus"
  | "jamIn"
  | "sleepStatus"
  | "remarks";

export type ReportColumn = { key: ReportColumnKey; header: string };

/**
 * The columns each report prints, after `NO`, in the template's order.
 *
 * `NO` is left out because it is not data — it is where the row sits, and a
 * filtered or re-sorted list numbers from one again.
 */
export const REPORT_COLUMNS: Record<ReportKind, readonly ReportColumn[]> = {
  "equipment-no-operator": [
    { key: "unit", header: "UNIT" },
    { key: "simperCode", header: "CODE SIMPER" },
    { key: "fleet", header: "FLEET" },
    { key: "bus", header: "NO BUS" },
    { key: "location", header: "LOCATION" },
  ],
  "operator-no-equipment": [
    { key: "nik", header: "NIK" },
    { key: "name", header: "NAME" },
    { key: "position", header: "POSITION" },
    { key: "department", header: "DEPARTMENT" },
    { key: "simperMatrix", header: "MATRIX SIMPER" },
  ],
  "operator-no-ftw": [
    { key: "nik", header: "NIK" },
    { key: "name", header: "NAMA" },
    { key: "roster", header: "ROSTER" },
    { key: "position", header: "POSISI" },
    { key: "department", header: "DEPARTMENT" },
    { key: "saveraStatus", header: "STATUS SAVERA" },
  ],
  "operator-no-finger": [
    { key: "nik", header: "NIK" },
    { key: "name", header: "NAMA" },
    { key: "roster", header: "ROSTER" },
    { key: "position", header: "POSISI" },
    { key: "department", header: "DEPARTMENT" },
    { key: "jamIn", header: "JAM IN" },
  ],
  "final-validation": [
    { key: "nik", header: "NIK" },
    { key: "name", header: "NAME" },
    { key: "position", header: "POSITION" },
    { key: "department", header: "DEPARTMENT" },
    { key: "jamIn", header: "JAM FINGER IN" },
    { key: "unit", header: "UNIT" },
    { key: "fleet", header: "FLEET" },
    { key: "bus", header: "NO BUS" },
    { key: "location", header: "LOCATION" },
  ],
  /* KETERANGAN is blank on purpose: the template leaves it for a hand on
     the printed sheet. */
  "induction-operators": [
    { key: "nik", header: "NIK" },
    { key: "name", header: "NAMA LENGKAP" },
    { key: "position", header: "POSISI" },
    { key: "roster", header: "ROSTER" },
    { key: "department", header: "DEPARTMENT" },
    { key: "sleepStatus", header: "JAM TIDUR" },
    { key: "remarks", header: "KETERANGAN" },
  ],
};

/** One line of a report: text in every column it prints, blank for none. */
export type ReportRow = Partial<Record<ReportColumnKey, string>>;

/**
 * What the Final Validation and Operator No Equipment reports print in UNIT
 * for someone the board placed nowhere — the word their slip carries.
 */
export const SPARE_UNIT_LABEL = "SPARE";

/** STATUS SAVERA for a rostered operator savera holds no reading for. */
export const NO_FTW_READING_LABEL = "Belum FTW";

/** JAM IN for a rostered operator with no tap at all. */
export const NO_FINGER_LABEL = "No Finger";

/**
 * ROSTER on the Induction Operators sheet, whatever the roster says (owner,
 * 2026-10-30). The day is induction; the `D` or `N` behind it is the shift
 * they would have worked, and the template prints IN.
 */
export const INDUCTION_ROSTER_LABEL = "IN";
