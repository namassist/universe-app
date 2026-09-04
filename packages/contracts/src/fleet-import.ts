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

export type FleetImportPreview = {
  /** Echoed so the commit can be checked against the file just validated. */
  fileName: string;
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  supportCount: number;
  breakdownCount: number;
  errorCount: number;
  rows: FleetImportPreviewRow[];
  support: FleetImportSupportRow[];
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
  released: number;
};

/* ------------------------------------------------- fleet allocation PLAN */

/** One pairing per row. */
export const PLAN_IMPORT_COLUMNS = ["unit", "nik"] as const;
export type PlanImportColumn = (typeof PLAN_IMPORT_COLUMNS)[number];

/**
 * One accepted row of the preview. A `moved` row names the unit the operator
 * leaves, so a re-uploaded plan shows every reassignment before it happens; an
 * `unchanged` row is a pairing the database already holds and the commit will
 * not touch.
 */
export type PlanImportPreviewRow = {
  /** 1-based spreadsheet row, as the operator sees it. */
  row: number;
  kind: "new" | "moved" | "unchanged";
  unit: string;
  nik: string;
  name: string;
  /** The unit a `moved` operator is released from; null otherwise. */
  fromUnit: string | null;
};

export type PlanImportPreview = {
  /** Echoed so the commit can be checked against the file just validated. */
  fileName: string;
  newCount: number;
  movedCount: number;
  unchangedCount: number;
  errorCount: number;
  rows: PlanImportPreviewRow[];
  errors: ImportErrorRow[];
};

export type PlanImportResult = {
  created: number;
  moved: number;
};
