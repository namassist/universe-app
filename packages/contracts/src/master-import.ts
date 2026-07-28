/**
 * Spreadsheet import and export for the master catalogues and the unit
 * registry.
 *
 * Two steps, as the account import already established: upload and see what
 * would happen, then approve and have it happen. Nothing is written during the
 * first step, and the second re-parses the file rather than trusting the
 * preview a client hands back.
 *
 * What foreign keys change (design D10): a row naming a unit class that does
 * not exist cannot be written as it stands, because there is no id to point at.
 *
 * The unit import answers that by *offering* to create the class rather than by
 * refusing the row. Setting up a fleet from scratch otherwise means six master
 * imports before the first unit can land, and the six lists are already sitting
 * in the unit sheet. The safeguard against a catalogue quietly filling with
 * typos is not refusal but disclosure: every value that would be created is
 * listed by catalogue, counted by how many rows asked for it, and has to be
 * confirmed in a dialog before anything is written. A caller who lacks `manage`
 * on the catalogue in question gets the old refusal, because a unit import is
 * not a way around the master's own permissions.
 *
 * Catalogue imports have no references to resolve, so `warnings` and
 * `newMasters` are always empty for them.
 */

import type { MasterKind } from "./access";

/**
 * A row that cannot be imported.
 *
 * The member names are `nik` and `emp` because this is deliberately the same
 * shape the account and roster imports emit, and the web app renders all three
 * through one results table. For a catalogue, `nik` carries the offending
 * name or code and `emp` the descriptive column beside it.
 */
export type ImportErrorRow = {
  row: string;
  nik: string;
  emp: string;
  issue: string;
  badgeVariant: "danger" | "warning";
  badge: string;
};

/** What an update would overwrite, named field by field. */
export type MasterImportChange = {
  field: string;
  from: string | null;
  to: string | null;
};

export type MasterImportPreviewRow = {
  /** 1-based spreadsheet row, as the operator sees it. */
  row: number;
  /**
   * `unchanged` rows are listed alongside the rest and counted separately.
   *
   * They could be omitted — nothing will be written for them — but then a file
   * that parsed perfectly and matches the stored data in every field renders as
   * an empty table, which is indistinguishable from a file that was not read at
   * all. Showing them is how an operator confirms the upload landed.
   */
  kind: "new" | "updated" | "unchanged";
  /** The catalogue name or unit code the row is keyed on. */
  key: string;
  /** A second column worth showing beside the key — description, model, type. */
  label: string;
  /**
   * Every value this row carries, in column order, joined by " - ".
   *
   * The row as the operator typed it, so a preview can be checked against the
   * spreadsheet without opening it. Empty cells are dropped rather than left as
   * gaps, and the separator is spaced because values contain hyphens of their
   * own — `EX2600-7BH` is one model, not two columns.
   */
  data: string;
  /** Empty for `new` and `unchanged` rows. */
  changes: MasterImportChange[];
};

/**
 * A catalogue entry the unit import would create, because rows referenced it
 * and no record matched.
 *
 * `name` is the spelling as typed, since that is what becomes the record — and
 * where two rows differ only in case, the first spelling in the file wins.
 * `rows` is how many spreadsheet rows asked for it, which is the number that
 * separates "a typo in one row" from "a type this fleet actually uses".
 */
export type PendingMaster = {
  kind: MasterKind;
  name: string;
  rows: number;
  /**
   * An existing entry this one is suspiciously close to, if any.
   *
   * `excavtor` beside `EXCAVATOR` is a typo about to become a permanent
   * catalogue record, and the operator is the only one who can tell that from a
   * genuinely new name. Set, it is never a reason to refuse the row — `DT R10`
   * and `DT R12` differ by one character too — only a reason to say so loudly.
   */
  similarTo?: string;
};

export type MasterImportPreview = {
  /** Echoed so a commit can be checked against the file just validated. */
  fileName: string;
  newCount: number;
  updatedCount: number;
  /**
   * Rows that match an existing record in every field, counted apart from the
   * two that would be written. Re-importing an untouched export therefore reads
   * "0 new, 0 changed" rather than "everything changed", while still accounting
   * for every row in the file. These rows appear in `rows` with kind
   * `unchanged`.
   */
  unchangedCount: number;
  /** Blocking only. A file with any of these cannot be committed at all. */
  errorCount: number;
  rows: MasterImportPreviewRow[];
  errors: ImportErrorRow[];
  /**
   * Rows that will import, but only by adding something to a master first.
   *
   * The same shape as `errors` and rendered in the same table, distinguished by
   * `badgeVariant` — an operator scanning the bottom of the screen should see
   * one list of everything worth looking at, not two tables to reconcile.
   */
  warnings: ImportErrorRow[];
  /** What `warnings` amounts to once duplicates across rows are folded in. */
  newMasters: PendingMaster[];
};

export type MasterImportResult = {
  created: number;
  updated: number;
  /**
   * Catalogue records created to satisfy references (unit import only), so the
   * confirmation an operator gave can be checked against what actually landed.
   */
  mastersCreated: number;
};

/* ------------------------------------------------------------------ columns */

/**
 * The spreadsheet columns each target accepts.
 *
 * One list per target, used by *both* export and import, which is what makes an
 * exported file re-importable without restructuring — the round trip is a
 * property of there being one definition rather than two that agree today.
 */
export const MASTER_IMPORT_COLUMNS: Record<MasterKind, readonly string[]> = {
  "jenis-unit": ["nama", "aktif"],
  "model-unit": ["nama", "aktif"],
  "merk-unit": ["nama", "aktif"],
  mess: ["nama", "aktif"],
  "kelas-unit": ["nama", "deskripsi", "aktif"],
  simper: ["nama", "deskripsi", "aktif"],
  "kode-simper": ["nama", "deskripsi", "aktif"],
  departemen: ["nama", "deskripsi", "aktif"],
  "area-kerja": ["nama", "tipe", "aktif"],
  perusahaan: ["nama", "deskripsi", "aktif"],
  jabatan: ["nama", "deskripsi", "aktif"],
};

/**
 * The employee sheet's columns (design D11).
 *
 * `kode_simper` is one column holding a separated list rather than one column
 * per qualification code: a code added to the catalogue must not change the
 * width of every employee file already in circulation.
 */
export const EMPLOYEE_IMPORT_COLUMNS = [
  "nik",
  "nama",
  "perusahaan",
  "jabatan",
  "departemen",
  "tanggal_masuk",
  "status",
  "simper",
  "simper_no",
  "simper_exp",
  "kode_simper",
  "lisensi",
  "mcu",
  "mcu_exp",
  "golongan_darah",
  "riwayat_medis",
  "mess",
  "blok",
  "kamar",
  "telepon",
  "kontak_darurat",
] as const;
export type EmployeeImportColumn = (typeof EMPLOYEE_IMPORT_COLUMNS)[number];

/**
 * What separates the codes inside `kode_simper`.
 *
 * A semicolon rather than a comma: `,` is the decimal separator in an
 * Indonesian locale spreadsheet and the field separator of a CSV saved from
 * one, so a comma-separated cell is the one shape most likely to be split by
 * something other than this parser.
 */
export const SKILL_SEPARATOR = ";";

export const UNIT_IMPORT_COLUMNS = [
  "kode",
  "kelas",
  "jenis",
  "model",
  "merk",
  "kode_simper",
  "departemen",
  "serial",
  "engine_brand",
  "deskripsi",
  "ftw",
  "aktif",
] as const;
export type UnitImportColumn = (typeof UNIT_IMPORT_COLUMNS)[number];
