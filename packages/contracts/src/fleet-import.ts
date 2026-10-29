/**
 * Bulk fleet composition and PLAN pairing by spreadsheet.
 *
 * Parsing and validation are server-side; these are the shapes the preview and
 * commit exchange with the browser. Both imports enforce exactly the rules
 * their single-row routes enforce — an import that validated less would be the
 * path operators route around the form through.
 */

import type { ImportErrorRow } from "./master-import";

/* ------------------------------------------------------- fleet settings */

/**
 * **One unit per row** (owner, 2026-09-04), which is how the yard keeps the
 * list: 318 machines, each with where it works today and what brings its crew.
 *
 * The previous shape was one fleet per row with its members in a comma list,
 * and it could not say the two things this one says — that a location and a
 * ride belong to a *unit*, and that a unit can work without a formation.
 *
 * How a row's role is read, entirely from `fleet`:
 *
 * - filled            → this unit hauls for the formation named there
 * - blank, referenced → this unit **leads** the formation named after it
 * - blank, unreferenced → a **support unit**: crewed, but in no formation
 *
 * `area` doubles as the breakdown marker: a unit whose area reads BREAKDOWN is
 * recorded as broken down rather than parked somewhere called that.
 *
 * An **empty** area says something different again, and only on a row that
 * names a formation: the digger it hauls for is down, so this truck has
 * nowhere to work today and stands by. The file must prove it — the named
 * leader's own row has to read BREAKDOWN — because "area left blank" is also
 * what a half-filled file looks like, and the two must not be confused.
 *
 * A formation whose digger is down does not survive the day: its trucks leave
 * it, the digger becomes a broken machine in no formation, and the formation
 * is disbanded. Keeping it would mean a formation with no location and a
 * leader marked broken, and both of those contradict rules this import
 * already enforces.
 */
export const FLEET_IMPORT_COLUMNS = ["unit", "area", "fleet", "bus"] as const;
export type FleetImportColumn = (typeof FLEET_IMPORT_COLUMNS)[number];

/**
 * What the `area` cell says when it is reporting a status instead of a place.
 *
 * Matched with spaces removed and case folded, because the file carries both
 * "BREAKDOWN" and "BREAK DOWN" and a unit missed over a space would be
 * allocated a crew it does not have.
 */
export const BREAKDOWN_AREA = "BREAKDOWN";
export const isBreakdownArea = (area: string) =>
  area.replace(/\s+/g, "").toUpperCase() === BREAKDOWN_AREA;

/**
 * The other status the `area` cell can carry (owner, 2026-09-15).
 *
 * Unlike BREAKDOWN, a standby unit is still allocated and keeps its formation
 * and ride — the word marks it, it does not take it out of the day. Any other
 * text in the cell is a work area, including the yard's older "STBY TUNGGU
 * INFO", which the owner did not name as a status.
 */
export const STANDBY_AREA = "STANDBY";
export const isStandbyArea = (area: string) =>
  area.replace(/\s+/g, "").toUpperCase() === STANDBY_AREA;

/**
 * The row that names the spare pool's ride rather than a unit (owner,
 * 2026-09-15).
 *
 * `SPARE | PARKIRAN KASTURI | SPARE | RBU26`: the unit and fleet cells both
 * read SPARE, the area is where the spare bus waits, and the bus is the ride
 * every slip reading UNIT SPARE prints. At most two, one area between them —
 * the yard runs two buses for its spares, from one place.
 */
export const SPARE_UNIT = "SPARE";
export const isSpareUnit = (value: string) =>
  value.replace(/\s+/g, "").toUpperCase() === SPARE_UNIT;
export const MAX_SPARE_TRANSPORTS = 2;

/** Which composition fields an update would overwrite. */
export const FLEET_IMPORT_FIELDS = ["area", "units", "transport"] as const;
export type FleetImportField = (typeof FLEET_IMPORT_FIELDS)[number];

export type FleetImportChange = {
  field: FleetImportField;
  from: string | null;
  to: string | null;
};

/**
 * One formation in the preview, gathered from all the rows that named it.
 *
 * `updated` rows carry the fields the commit would change, so a composition
 * edited by hand is never silently overwritten; `unchanged` rows are listed so
 * a reader can see the file was read in full rather than partly ignored.
 */
export type FleetImportPreviewRow = {
  /** 1-based spreadsheet row of the leader, as the operator sees it. */
  row: number;
  kind: "new" | "updated" | "unchanged";
  leader: string;
  area: string;
  /** Member unit codes, in file order. */
  units: string[];
  /** The distinct vehicles this formation's units ride, for the summary. */
  transports: string[];
  /** Empty unless `updated`. */
  changes: FleetImportChange[];
};

/** One crewed unit that belongs to no formation. */
export type FleetImportSupportRow = {
  row: number;
  unit: string;
  /** Null when the row reported a breakdown instead of a place. */
  area: string | null;
  transport: string | null;
  breakdown: boolean;
};

/**
 * One unit standing by because the digger it hauls for is broken down.
 *
 * Separate from the support list rather than folded into it: a support unit is
 * *crewed* somewhere, and these are not crewed at all. Filing them together
 * would put a truck nobody is driving into the count of machines that are
 * working.
 */
export type FleetImportStandbyRow = {
  row: number;
  unit: string;
  /** The formation it hauls for; empty for a leader or a support unit. */
  fleet: string;
};

/** One bus the spare pool rides, from a SPARE row. */
export type FleetImportSpareRow = {
  row: number;
  transport: string;
  area: string;
};

export type FleetImportPreview = {
  /** Echoed so the commit can be checked against the file just validated. */
  fileName: string;
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  supportCount: number;
  breakdownCount: number;
  standbyCount: number;
  errorCount: number;
  rows: FleetImportPreviewRow[];
  support: FleetImportSupportRow[];
  /** Units the commit would set standby, and the broken digger behind each. */
  standby: FleetImportStandbyRow[];
  /** The spare pool's buses and where they wait; replaces the last file's. */
  spare: FleetImportSpareRow[];
  /**
   * Formations the database holds and this file never names — the commit would
   * disband them.
   *
   * Listed rather than acted on silently (owner, 2026-09-04): the file is the
   * whole site for one day, so "absent" does mean "gone", but a wrong file
   * would otherwise wipe the setting with nothing shown first.
   */
  disband: string[];
  /** Units in today's operation the file no longer names — they drop out. */
  released: string[];
  errors: ImportErrorRow[];
};

export type FleetImportResult = {
  created: number;
  updated: number;
  disbanded: number;
  support: number;
  standby: number;
  spare: number;
  released: number;
};

/* ------------------------------------------------- fleet allocation PLAN */

/** One pairing per row. */
export const PLAN_IMPORT_COLUMNS = ["unit", "nik"] as const;
export type PlanImportColumn = (typeof PLAN_IMPORT_COLUMNS)[number];

/**
 * One accepted row of the preview, judged against the saved default plan. A
 * `moved` row names the unit the default had the operator on; an `unchanged`
 * row is a pairing the default already holds.
 */
export type PlanImportPreviewRow = {
  /** 1-based spreadsheet row, as the operator sees it. */
  row: number;
  kind: "new" | "moved" | "unchanged";
  unit: string;
  nik: string;
  name: string;
  /** The unit the default has a `moved` operator on; null otherwise. */
  fromUnit: string | null;
};

/** A pairing the saved default holds and the file does not name. */
export type PlanImportRemovedRow = {
  unit: string;
  nik: string;
  name: string;
};

export type PlanImportPreview = {
  /** Echoed so the commit can be checked against the file just validated. */
  fileName: string;
  newCount: number;
  movedCount: number;
  unchangedCount: number;
  /** Default pairings the file does not name; listed before the commit. */
  removedCount: number;
  errorCount: number;
  rows: PlanImportPreviewRow[];
  removed: PlanImportRemovedRow[];
  errors: ImportErrorRow[];
};

/** What the saved default became, relative to the one it replaced. */
export type PlanImportResult = {
  /** Pairings in the new default. */
  pairs: number;
  created: number;
  moved: number;
  removed: number;
};

/** The saved default plan, as the PLAN toolbar describes it. */
export type PlanDefaultInfo = {
  fileName: string;
  actorName: string | null;
  createdAt: string;
  pairs: number;
};

/** One pairing named in a reset diff. */
export type PlanResetEntry = { unit: string; nik: string; name: string };

/** A default pairing a reset cannot make now, and why. */
export type PlanResetSkipped = PlanResetEntry & { reason: string };

/** Live plan versus the saved default: what a reset would do. */
export type PlanResetPreview = {
  release: PlanResetEntry[];
  assign: PlanResetEntry[];
  skipped: PlanResetSkipped[];
  unchanged: number;
  defaultInfo: PlanDefaultInfo;
};

export type PlanResetResult = {
  released: number;
  assigned: number;
  skipped: PlanResetSkipped[];
};
