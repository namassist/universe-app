/**
 * Vocabularies the master catalogues, the display content, and the allocation
 * schedule are built from.
 *
 * These live here rather than in the web app because three consumers have to
 * agree on them and none of the three may be the source: the Postgres enums are
 * generated from `AREA_TYPES` and `TIMELINE_ACTIONS`, the API's TypeBox schemas
 * validate against the same lists, and the client renders their labels. A value
 * added in one place and missed in another is exactly the drift a shared
 * contract exists to prevent.
 */

/** A work area is mining ground or it is not; nothing else distinguishes one. */
export const AREA_TYPES = ["Mining", "Non Mining"] as const;
export type AreaType = (typeof AREA_TYPES)[number];

/**
 * Employment status, and only employment (design D7).
 *
 * Two values, not three. "Cuti" was the third in the static port, and it is
 * gone: leave is a fact about a *date*, owned by the roster, and a column with
 * no date cannot answer "on leave until when". Keeping it here would leave two
 * sources of truth for the same question, one of which can never win.
 */
export const EMPLOYEE_STATUSES = ["aktif", "nonaktif"] as const;
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
 * `finger-ingest` and `spare-validate` name work the allocation engine will
 * perform; until it exists they dispatch to logged no-ops. The values are the
 * contract — labels below are presentation and may be reworded freely.
 */
export const TIMELINE_ACTIONS = [
  "ftw-deadline",
  "finger-in",
  "finger-ingest",
  "spare-validate",
  "bus-depart",
  "other",
] as const;
export type TimelineAction = (typeof TIMELINE_ACTIONS)[number];

/** Indonesian labels, keyed by the value dispatch actually matches on. */
export const TIMELINE_ACTION_LABELS: Record<TimelineAction, string> = {
  "ftw-deadline": "Batas upload FTW",
  "finger-in": "Batas finger in",
  "finger-ingest": "Ambil data finger",
  "spare-validate": "Validasi spare ke unit",
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
