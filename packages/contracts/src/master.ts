/**
 * Vocabularies the master catalogues, the display content, and the allocation
 * schedule are built from.
 *
 * These live here rather than in the web app because three consumers have to
 * agree on them and none of the three may be the source: the Postgres enum is
 * generated from `TIMELINE_ACTIONS`, the API's TypeBox schemas validate against
 * the same lists, and the client renders their labels. A value added in one
 * place and missed in another is exactly the drift a shared contract exists to
 * prevent.
 */

/**
 * Employment status, and only employment (design D7).
 *
 * "Cuti" is deliberately not here, and never will be: leave is a fact about a
 * *date*, owned by the roster, and a column with no date cannot answer "on
 * leave until when". Keeping it here would leave two sources of truth for the
 * same question, one of which can never win.
 *
 * `standby` is on the payroll but not to be given a unit (owner, 2026-09-03) —
 * for a spell of light duty, a lapsed permit, an investigation. It is a third
 * *employment* state rather than a date, which is what keeps it on this list
 * and keeps leave off it.
 *
 * Only `aktif` reaches allocation. Every gate spells that out positively
 * (`status = 'aktif'`) rather than excluding `nonaktif`, so a status added
 * here is excluded from allocation by default — which is the safe direction
 * for this particular list to fail in.
 */
export const EMPLOYEE_STATUSES = ["aktif", "standby", "nonaktif"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export function isEmployeeStatus(value: string): value is EmployeeStatus {
  return (EMPLOYEE_STATUSES as readonly string[]).includes(value);
}

/**
 * MCU outcome and blood type (design D6).
 *
 * Enums rather than catalogues: neither is something an admin adds without a
 * deploy, and nothing points at either with a foreign key. That is the whole
 * line between a catalogue and an enum here.
 */
export const MCU_RESULTS = [
  "Fit",
  "Fit dengan catatan",
  "Unfit sementara",
] as const;
export type McuResult = (typeof MCU_RESULTS)[number];

export function isMcuResult(value: string): value is McuResult {
  return (MCU_RESULTS as readonly string[]).includes(value);
}

export const BLOOD_TYPES = ["A", "B", "AB", "O"] as const;
export type BloodType = (typeof BLOOD_TYPES)[number];

export function isBloodType(value: string): value is BloodType {
  return (BLOOD_TYPES as readonly string[]).includes(value);
}

/**
 * What a timeline stage *does* when its time arrives.
 *
 * `ftw-ingest` and `finger-ingest` pull the day's readiness data from the
 * external sources into the local snapshots; `roster-ingest` mirrors the
 * schedule itself from unggul_att, which owns it. `spare-validate` names work the
 * allocation engine will perform; until it exists it dispatches to a logged
 * no-op. The values are the contract — labels below are presentation and may
 * be reworded freely.
 *
 * `shift-start` fires nothing at all. It exists because the yard walls have to
 * know which shift they are showing, and that question was answered by
 * `ftw-ingest` for want of a stage that meant it — which tied the moment the
 * screens turn over to the moment the FTW pull begins, two decisions with no
 * reason to move together. Naming it separately lets a wall change over at
 * 16:00 while the pull stays where the upload deadline needs it.
 *
 * `finger-second` fires nothing either, yet. It is the muster's fourth gate on
 * the site's own flowchart — the tap a spare makes *after* the board exists,
 * to collect the unit it gave them — and it is on the timeline now so that the
 * schedule the application runs is the schedule the yard works to, and so that
 * the ticket printing that will fire from it has a time to fire at. Until then
 * it is a marker, and its being on the wall screen is most of its value.
 */
export const TIMELINE_ACTIONS = [
  "shift-start",
  "ftw-deadline",
  "ftw-ingest",
  "finger-in",
  "finger-ingest",
  "roster-ingest",
  "spare-validate",
  "finger-second",
  "bus-depart",
  "other",
] as const;
export type TimelineAction = (typeof TIMELINE_ACTIONS)[number];

/** Indonesian labels, keyed by the value dispatch actually matches on. */
export const TIMELINE_ACTION_LABELS: Record<TimelineAction, string> = {
  "shift-start": "Awal shift (pergantian layar)",
  "ftw-deadline": "Batas upload FTW",
  "ftw-ingest": "Ambil data FTW",
  "finger-in": "Batas finger in",
  "finger-ingest": "Ambil data finger",
  "roster-ingest": "Ambil roster unggul_att",
  "spare-validate": "Validasi spare ke unit",
  "finger-second": "Finger in kedua (ambil tiket unit)",
  "bus-depart": "Bus berangkat",
  other: "Lainnya",
};

export const timelineActionLabel = (value: TimelineAction): string =>
  TIMELINE_ACTION_LABELS[value] ?? value;

/** Type guard for an action arriving from the wire. */
export function isTimelineAction(value: string): value is TimelineAction {
  return (TIMELINE_ACTIONS as readonly string[]).includes(value);
}

/**
 * The ticker's colour vocabulary. Named rather than hex-valued on the wire so a
 * palette change is a token change here, not a rewrite of every stored row.
 */
export const RUNTEXT_COLORS = ["Cyan", "Oranye", "Putih", "Merah"] as const;
export type RunTextColor = (typeof RUNTEXT_COLORS)[number];

/** The one place a running-text colour name resolves to a value. */
export const COLOR_VAL: Record<RunTextColor, string> = {
  Cyan: "#00D4FF",
  Oranye: "#E99B2A",
  Putih: "#FFFFFF",
  Merah: "#FC3C3B",
};

/** Type guard for a colour arriving from the wire. */
export function isRunTextColor(value: string): value is RunTextColor {
  return (RUNTEXT_COLORS as readonly string[]).includes(value);
}
