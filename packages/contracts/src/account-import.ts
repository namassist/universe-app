/**
 * Bulk account provisioning by spreadsheet.
 *
 * Parsing and validation are server-side; these are the shapes the preview and
 * commit exchange with the browser. There is deliberately no password column —
 * a spreadsheet carrying credentials circulates by email and chat, so the
 * initial password comes from configuration instead.
 */

/** The template's columns, in order. `email` is the only optional one. */
export const ACCOUNT_IMPORT_COLUMNS = ["nik", "nama", "email", "role"] as const;
export type AccountImportColumn = (typeof ACCOUNT_IMPORT_COLUMNS)[number];

/** Which account fields an update would overwrite. */
export const ACCOUNT_IMPORT_FIELDS = ["nama", "email", "role"] as const;
export type AccountImportField = (typeof ACCOUNT_IMPORT_FIELDS)[number];

export type AccountImportChange = {
  field: AccountImportField;
  from: string | null;
  to: string | null;
};

/**
 * One accepted row of the preview. `updated` rows carry the fields the commit
 * would change, so a role edited by hand is never silently overwritten.
 */
export type AccountImportPreviewRow = {
  /** 1-based spreadsheet row, as the operator sees it. */
  row: number;
  kind: "new" | "updated";
  nik: string;
  nama: string;
  email: string | null;
  role: string;
  /** Empty for `new` rows. */
  changes: AccountImportChange[];
};

/**
 * A rejected row. Mirrors the roster upload's `UpError` so the results table
 * looks and behaves identically.
 */
export type AccountImportError = {
  row: string;
  nik: string;
  emp: string;
  issue: string;
  badgeVariant: "danger" | "warning";
  badge: string;
};

export type AccountImportPreview = {
  /** Echoed so the commit can be checked against the file just validated. */
  fileName: string;
  newCount: number;
  updatedCount: number;
  errorCount: number;
  rows: AccountImportPreviewRow[];
  errors: AccountImportError[];
};

export type AccountImportResult = {
  created: number;
  updated: number;
};
