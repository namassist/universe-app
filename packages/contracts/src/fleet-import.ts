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

/** One fleet per row, keyed by digger code. `bus` is the only optional one. */
export const FLEET_IMPORT_COLUMNS = ["digger", "area", "bus", "units"] as const;
export type FleetImportColumn = (typeof FLEET_IMPORT_COLUMNS)[number];

/** Which composition fields an update would overwrite. */
export const FLEET_IMPORT_FIELDS = ["area", "bus", "units"] as const;
export type FleetImportField = (typeof FLEET_IMPORT_FIELDS)[number];

export type FleetImportChange = {
  field: FleetImportField;
  from: string | null;
  to: string | null;
};

/**
 * One accepted row of the preview. `updated` rows carry the fields the commit
 * would change, so a composition edited by hand is never silently overwritten.
 */
export type FleetImportPreviewRow = {
  /** 1-based spreadsheet row, as the operator sees it. */
  row: number;
  kind: "new" | "updated";
  digger: string;
  area: string;
  bus: string | null;
  /** Member unit codes, in file order. */
  units: string[];
  /** Empty for `new` rows. */
  changes: FleetImportChange[];
};

export type FleetImportPreview = {
  /** Echoed so the commit can be checked against the file just validated. */
  fileName: string;
  newCount: number;
  updatedCount: number;
  errorCount: number;
  rows: FleetImportPreviewRow[];
  errors: ImportErrorRow[];
};

export type FleetImportResult = {
  created: number;
  updated: number;
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
