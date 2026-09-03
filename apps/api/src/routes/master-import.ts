/**
 * Spreadsheet export and preview-then-commit import for the master catalogues,
 * the unit registry (design D10), and the employee register (employee D11).
 *
 * The parsing lives here rather than in the route file for the same reason
 * `users-import.ts` does: it is pure, it is the part worth reading, and it
 * touches no database. The routes hand it the current rows and get back a
 * preview.
 *
 * What is different from the account import is what an unknown value *means*.
 * With foreign keys in place a row naming `BIGDIGER` cannot be written as it
 * stands, and the choice is between creating that class and refusing the row.
 *
 * It offers to create it, and reports the offer. The danger a plain refusal
 * guarded against is real — a catalogue that fills itself from misspellings is
 * the failure D2 exists to prevent, and the symptom is an idle machine rather
 * than an error — but refusal paid for it by making an empty database
 * unfillable without six imports in the right order. So the value still never
 * appears silently: it is collected into `newMasters`, counted by how many rows
 * wanted it, surfaced as a warning row, and written only after the operator
 * confirms. A caller without `manage` on that catalogue gets the old refusal;
 * the offer is a convenience, not a way around the master's permissions.
 *
 * The employee import follows that rule for five of its six references and
 * breaks it for one. `kode-simper` is never created from an employee sheet, at
 * any grant level, because the two mistakes are not comparable: a misspelled
 * company is a label somebody can tidy later, while a misspelled qualification
 * code is a claim of competence that matches no unit, produces no error, and
 * shows up as a machine standing idle at the start of a shift.
 */

import ExcelJS from "exceljs";
import {
  BLOOD_TYPES,
  EMPLOYEE_IMPORT_COLUMNS,
  EMPLOYEE_STATUSES,
  MASTER_IMPORT_COLUMNS,
  MASTER_IMPORT_PARENT_COLUMNS,
  MCU_RESULTS,
  SKILL_SEPARATOR,
  UNIT_IMPORT_COLUMNS,
  type BloodType,
  type EmployeeStatus,
  type ImportErrorRow,
  type MasterImportChange,
  type MasterImportPreview,
  type MasterImportPreviewRow,
  type MasterKind,
  type McuResult,
  type PendingMaster,
} from "@universe/contracts";

import {
  missingColumnsFailure,
  unknownColumnsFailure,
  type ParseFailure,
} from "./import-columns";

/** Generous for hundreds of rows, small enough that a hostile file fails fast. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const HEADER_ROW = 1;

function danger(
  row: number,
  key: string,
  label: string,
  issue: string
): ImportErrorRow {
  return {
    row: String(row),
    nik: key || "—",
    emp: label || "—",
    issue,
    badgeVariant: "danger",
    badge: "Error",
  };
}

/**
 * The same row shape at a lower severity: the file still imports, but only
 * because something will be added to a master to make it possible.
 */
function warn(
  row: number,
  key: string,
  label: string,
  issue: string
): ImportErrorRow {
  return {
    row: String(row),
    nik: key || "—",
    emp: label || "—",
    issue,
    badgeVariant: "warning",
    badge: "Master baru",
  };
}

/* ------------------------------------------------------- near-match detection

   The catalogue's own defence against the thing auto-creation makes possible.
   Offering to create `excavtor` next to an existing `EXCAVATOR` is how a
   catalogue fills with near-duplicates, and the operator is the only one who
   can tell a typo from a name that is genuinely new.

   It only ever annotates. `DT R10` and `DT R12` differ by one character and are
   both real, so any threshold tight enough to catch `excavtor` also flags real
   pairs — which is fine for a warning and would be unusable as a refusal. */

/** Levenshtein distance, the two-row variant: O(a·b) time, O(b) space. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, substitution);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/**
 * How alike two names are, 0 to 1, relative to the longer one.
 *
 * Relative rather than absolute, because one wrong character means something
 * different at four letters than at forty: `EXC`/`EXO` is a third of the name.
 */
export function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (!longest) return 1;
  return 1 - editDistance(a, b) / longest;
}

/** Anything this alike is worth pointing at. Tuned so `excavtor`/`EXCAVATOR` (0.89) lands. */
const NEAR_MATCH = 0.8;

/**
 * The closest existing name to `candidate`, or null if nothing is close.
 *
 * Compared lowercased, since a difference of case alone is not a near match —
 * it is an exact one, and would have resolved long before reaching here.
 */
export function nearestName(
  candidate: string,
  existing: Iterable<string>
): string | null {
  const needle = candidate.toLowerCase();
  let best: string | null = null;
  let bestScore = NEAR_MATCH;
  for (const name of existing) {
    const score = similarity(needle, name.toLowerCase());
    if (score >= 1) return null;
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  return best;
}

/**
 * A date cell as `YYYY-MM-DD`.
 *
 * Read from UTC parts, which is how ExcelJS parses a date cell. A local-time
 * read shifts the day by one either side of midnight for anyone east or west of
 * UTC, and a join date silently off by a day is the kind of error nobody
 * notices until it matters.
 */
function isoDate(value: Date): string {
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${value.getUTCFullYear()}-${month}-${day}`;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  // Before the generic object branch: a real date cell is an object with none
  // of the members checked below, so it would otherwise read as empty — and a
  // blank date column silently wipes a date rather than failing loudly.
  if (value instanceof Date) return isoDate(value);
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string")
      return value.text.trim();
    if ("result" in value) return String(value.result ?? "").trim();
    if ("richText" in value)
      return value.richText
        .map((r) => r.text)
        .join("")
        .trim();
    return "";
  }
  return String(value).trim();
}

/**
 * How a boolean column reads.
 *
 * Spreadsheets are not typed: the same column comes back as a real boolean from
 * one editor, "TRUE" from another, and "Ya" from an operator filling it in by
 * hand. Anything unrecognised falls back to the row's current value rather than
 * to `false`, so a blank cell never silently deactivates a record.
 */
function boolCell(raw: string, fallback: boolean): boolean {
  const value = raw.toLowerCase();
  if (["true", "ya", "y", "1", "aktif", "yes"].includes(value)) return true;
  if (["false", "tidak", "n", "0", "nonaktif", "no"].includes(value))
    return false;
  return fallback;
}

const boolText = (value: boolean) => (value ? "TRUE" : "FALSE");

/* -------------------------------------------------------------- the target */

/**
 * What a spreadsheet is being read into.
 *
 * Both catalogues and units go through one parser, differing only in their
 * columns, how a row is keyed, and how a row's fields are read — so those three
 * are the parameters and the two-pass structure below is written once.
 */
export type ImportTarget<TRow, TParsed> = {
  columns: readonly string[];
  /** Columns that must be present; others may be omitted from the file. */
  required: readonly string[];
  /** Existing rows, keyed lowercase — the same comparison the index uses. */
  existing: Map<string, TRow>;
  /** Read one spreadsheet row, or say why it cannot be read. */
  parse: (
    read: (column: string) => string,
    current: TRow | undefined
  ) => TParsed | { issue: string; key: string; label: string };
  keyOf: (parsed: TParsed) => string;
  /**
   * How a row finds the record it would update, when that is more than the
   * required column.
   *
   * A department is identified by `company|name` and a position by
   * `company|department|name`, so matching on the name alone would pair a row
   * with a same-named record under a different owner and report a move as an
   * edit. Absent everywhere else, where the name *is* the identity.
   */
  existingKeyOf?: (read: (column: string) => string) => string;
  labelOf: (parsed: TParsed) => string;
  /** What a commit would change about an existing row. */
  diff: (current: TRow, parsed: TParsed) => MasterImportChange[];
  /**
   * Catalogue values this row referenced that do not exist yet.
   *
   * Absent for catalogue targets, which reference nothing. Reported per row so
   * an operator can see *where* the new value came from, and folded into
   * `newMasters` so the confirmation names each addition once rather than once
   * per row that mentions it.
   */
  pendingOf?: (parsed: TParsed) => PendingRef[];
  /**
   * An existing entry a *new* row's key looks like a misspelling of.
   *
   * Set for catalogues, where the key is the master entry itself and a near
   * duplicate is exactly the mistake worth catching. Left off for units, whose
   * keys are fleet numbers: `DT-101` beside `DT-102` is normal, and flagging
   * every consecutive code would drown the real warnings. A unit file's typos
   * are caught where they matter, on its references, through `pendingOf`.
   */
  nearMatch?: (key: string) => string | null;
};

/** One unresolved reference: which catalogue, what it was called, in whose column. */
export type PendingRef = {
  kind: MasterKind;
  name: string;
  /** The human column name — "Jenis", "Kode SIMPER" — for the warning text. */
  label: string;
  /** An existing entry in that catalogue this looks like a misspelling of. */
  similarTo?: string;
};

/** An accepted row, with the values a commit would write. */
export type Accepted<TRow, TParsed> = {
  row: number;
  key: string;
  parsed: TParsed;
  /** The row this one would update, or `undefined` if it is new. */
  current: TRow | undefined;
  changed: boolean;
};

/**
 * Validate a workbook and describe what a commit would do. Touches no database.
 *
 * Returns the preview *and* the parsed values, so a commit re-runs this and
 * writes from `accepted` rather than reconstructing values out of the preview's
 * change list — which would only ever describe rows that already exist.
 *
 * Rows come back in file order with their original row numbers attached: an
 * operator fixing a 900-row spreadsheet works by row number, and a result they
 * have to map back themselves is not much better than none.
 */
export function validateWorkbook<TRow, TParsed extends object>(
  fileName: string,
  target: ImportTarget<TRow, TParsed>,
  workbook: ExcelJS.Workbook
):
  | { preview: MasterImportPreview; accepted: Accepted<TRow, TParsed>[] }
  | ParseFailure {
  const ws = workbook.worksheets[0];
  if (!ws)
    return { code: "empty_file", message: "File tidak berisi sheet apa pun" };

  const headers = (ws.getRow(HEADER_ROW).values as ExcelJS.CellValue[])
    .slice(1)
    .map((v) => cellText(v).toLowerCase())
    .filter((h) => h.length > 0);

  const unknown = headers.filter((h) => !target.columns.includes(h));
  if (unknown.length) return unknownColumnsFailure(unknown, target.columns);

  const missing = target.required.filter((c) => !headers.includes(c));
  if (missing.length)
    return missingColumnsFailure([...missing], target.columns);

  const columnIndex = new Map(headers.map((h, i) => [h, i + 1]));

  const rows: MasterImportPreviewRow[] = [];
  const accepted: Accepted<TRow, TParsed>[] = [];
  const errors: ImportErrorRow[] = [];
  const warnings: ImportErrorRow[] = [];
  const seen = new Map<string, number>();
  // Keyed by catalogue *and* lowercased name, because "DUMTRUCK" in the jenis
  // column and in the model column are two different additions, while
  // "DUMTRUCK" and "dumtruck" in the same column are one.
  const pending = new Map<string, PendingMaster>();
  let unchangedCount = 0;

  for (let n = HEADER_ROW + 1; n <= ws.rowCount; n++) {
    const excelRow = ws.getRow(n);
    const read = (column: string) => {
      const index = columnIndex.get(column);
      return index ? cellText(excelRow.getCell(index).value) : "";
    };

    // A wholly blank line is filler, not a row an operator meant to write.
    if (target.columns.every((c) => read(c) === "")) continue;

    const keyColumn = target.required[0]!;
    const rawKey = (
      target.existingKeyOf ? target.existingKeyOf(read) : read(keyColumn)
    ).toLowerCase();
    const current = target.existing.get(rawKey);

    const parsed = target.parse(read, current);
    if ("issue" in parsed) {
      errors.push(danger(n, parsed.key, parsed.label, parsed.issue));
      continue;
    }

    const key = target.keyOf(parsed);
    const label = target.labelOf(parsed);

    // A file naming the same record twice would have the second write silently
    // win, so it is refused with the row that already claimed it.
    const firstSeen = seen.get(key.toLowerCase());
    if (firstSeen !== undefined) {
      errors.push(
        danger(
          n,
          key,
          label,
          `Ganda dalam file ini — sudah ada di baris ${firstSeen}`
        )
      );
      continue;
    }
    seen.set(key.toLowerCase(), n);

    const existing = target.existing.get(key.toLowerCase());
    const changes = existing ? target.diff(existing, parsed) : [];
    const changed = !existing || changes.length > 0;

    // A row matching an existing record in every field is a no-op: it is listed
    // like any other but counted apart from the two that would be written, so
    // re-importing an untouched export reads "0 new, 0 changed, 0 errors"
    // without the file appearing to have gone unread.
    rows.push({
      row: n,
      kind: !existing ? "new" : changed ? "updated" : "unchanged",
      key,
      label,
      // Read back off the sheet rather than rebuilt from the parsed values, so
      // this shows what the operator typed and not what it was understood as.
      data: target.columns
        .map((c) => read(c))
        .filter((v) => v !== "")
        .join(" - "),
      changes,
    });
    if (!changed) unchangedCount++;

    // Only for a row that would create something. An update already names the
    // record it is updating, so "looks like X" is noise there.
    const near = existing ? null : target.nearMatch?.(key);
    if (near)
      warnings.push(
        warn(
          n,
          key,
          near,
          `"${key}" mirip dengan "${near}" yang sudah ada — pastikan ini memang entri baru, bukan salah ketik`
        )
      );

    // One warning per row per unresolved reference, and one `newMasters` entry
    // per distinct value however many rows named it.
    for (const ref of target.pendingOf?.(parsed) ?? []) {
      warnings.push(
        warn(
          n,
          key,
          ref.name,
          ref.similarTo
            ? `${ref.label} "${ref.name}" mirip dengan "${ref.similarTo}" yang sudah ada — kalau salah ketik perbaiki dulu, kalau memang beda akan ditambahkan sebagai entri baru`
            : `${ref.label} "${ref.name}" belum ada di master — akan ditambahkan saat import`
        )
      );
      const mapKey = `${ref.kind} ${ref.name.toLowerCase()}`;
      const already = pending.get(mapKey);
      if (already) already.rows++;
      else
        pending.set(mapKey, {
          kind: ref.kind,
          name: ref.name,
          rows: 1,
          ...(ref.similarTo ? { similarTo: ref.similarTo } : {}),
        });
    }

    accepted.push({ row: n, key, parsed, current: existing, changed });
  }

  return {
    preview: {
      fileName,
      newCount: rows.filter((r) => r.kind === "new").length,
      updatedCount: rows.filter((r) => r.kind === "updated").length,
      unchangedCount,
      errorCount: errors.length,
      rows,
      errors,
      warnings,
      newMasters: [...pending.values()],
    },
    accepted,
  };
}

export async function readWorkbook(
  bytes: ArrayBuffer
): Promise<ExcelJS.Workbook | ParseFailure> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes);
  } catch {
    return {
      code: "unreadable_file",
      message: "File tidak bisa dibaca sebagai spreadsheet .xlsx",
    };
  }
  return wb;
}

/* ---------------------------------------------------------------- catalogues */

export type CatalogueExisting = {
  id: string;
  name: string;
  description?: string;
  /** Companies only — the short form beside the name. */
  code?: string;
  /** Positions only — whether the allocation engine may draw from this one. */
  fleetAllocation?: boolean;
  /**
   * The owner's names, outermost first: `["PT UDU"]` for a department,
   * `["PT UDU", "HRM"]` for a position. Absent where the catalogue owns itself.
   */
  path?: string[];
  active: boolean;
};

export type ParsedCatalogue = {
  name: string;
  description: string | undefined;
  code: string | undefined;
  fleetAllocation: boolean | undefined;
  /** The resolved owner, where the kind has one. */
  parentId: string | undefined;
  /** `name`, or `owner|…|name` — what identifies this row in this file. */
  key: string;
  active: boolean;
};

/**
 * What a kind needs beyond a name, for the three that need something.
 *
 * `byPath` is keyed on the joined lowercased owner names because that is what
 * the sheet can express — a spreadsheet names a company, not a uuid.
 */
export type CatalogueShape = {
  /** Companies carry a code, and it is required. */
  hasCode?: boolean;
  /** Positions carry the fleet-allocation flag. */
  hasFleetFlag?: boolean;
  parent?: {
    /** Import columns naming the owner, outermost first. */
    columns: readonly string[];
    /** `company` or `company|department`, lowercased → the owner's id. */
    byPath: Map<string, string>;
    label: string;
  };
};

export function catalogueTarget(
  kind: MasterKind,
  extra: "none" | "description",
  existing: Map<string, CatalogueExisting>,
  shape: CatalogueShape = {}
): ImportTarget<CatalogueExisting, ParsedCatalogue> {
  const columns = MASTER_IMPORT_COLUMNS[kind];
  const parent = shape.parent;

  /** The owner names this row states, joined the way `byPath` is keyed. */
  const pathOf = (read: (column: string) => string) =>
    (parent?.columns ?? []).map((c) => read(c));

  return {
    columns,
    required: ["nama"],
    existing,
    existingKeyOf: parent
      ? (read) => [...pathOf(read), read("nama")].join("|")
      : undefined,
    parse: (read, current) => {
      const name = read("nama");
      if (!name) return { issue: "Nama kosong", key: "", label: "" };

      const path = pathOf(read);
      let parentId: string | undefined;
      if (parent) {
        if (path.some((p) => !p))
          return {
            issue: `${parent.columns.join(" dan ")} wajib diisi — ${parent.label} menentukan baris ini milik siapa`,
            key: name,
            label: "",
          };
        parentId = parent.byPath.get(path.join("|").toLowerCase());
        if (!parentId)
          return {
            issue: `${parent.label} "${path[path.length - 1]}" tidak ada di master${
              path.length > 1 ? ` di bawah "${path[0]}"` : ""
            } — tambahkan dulu, lalu import ulang`,
            key: name,
            label: path.join(" / "),
          };
      }

      const code = read("kode");
      if (shape.hasCode && !code && !current)
        return { issue: "Kode wajib diisi", key: name, label: "" };

      return {
        name,
        description:
          extra === "description"
            ? // Blank keeps what the record has, matching every other optional
              // column here and in the unit import. It used to overwrite, which
              // meant a file that simply left the column out silently wiped the
              // description off every row it touched.
              read("deskripsi") || (current?.description ?? "")
            : undefined,
        code: shape.hasCode ? code || (current?.code ?? "") : undefined,
        // Blank keeps what the record has, like every other optional column
        // here — a file that omits the column must not clear the flag off
        // every position it touches.
        fleetAllocation: shape.hasFleetFlag
          ? boolCell(read("alokasi_fleet"), current?.fleetAllocation ?? false)
          : undefined,
        parentId,
        key: [...path, name].join("|"),
        active: boolCell(read("aktif"), current?.active ?? true),
      };
    },
    keyOf: (p) => p.key,
    labelOf: (p) => p.description ?? "",
    // The key *is* the master entry here, so a new one close to an existing one
    // is the near-duplicate worth catching.
    nearMatch: (key) =>
      nearestName(
        key,
        [...existing.values()].map((r) => r.name)
      ),
    diff: (current, parsed) => {
      const changes: MasterImportChange[] = [];
      // Compared case-sensitively even though the *match* is not: renaming
      // `hitachi` to `HITACHI` is a real change to what the screen shows.
      if (current.name !== parsed.name)
        changes.push({ field: "nama", from: current.name, to: parsed.name });
      if (
        parsed.description !== undefined &&
        (current.description ?? "") !== parsed.description
      )
        changes.push({
          field: "deskripsi",
          from: current.description ?? "",
          to: parsed.description,
        });
      if (parsed.code !== undefined && (current.code ?? "") !== parsed.code)
        changes.push({
          field: "kode",
          from: current.code ?? "",
          to: parsed.code,
        });
      if (
        parsed.fleetAllocation !== undefined &&
        (current.fleetAllocation ?? false) !== parsed.fleetAllocation
      )
        changes.push({
          field: "alokasi_fleet",
          from: boolText(current.fleetAllocation ?? false),
          to: boolText(parsed.fleetAllocation),
        });
      if (current.active !== parsed.active)
        changes.push({
          field: "aktif",
          from: boolText(current.active),
          to: boolText(parsed.active),
        });
      return changes;
    },
  };
}

function catalogueSheet(
  kind: MasterKind
): [ExcelJS.Workbook, ExcelJS.Worksheet] {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(kind);
  ws.columns = MASTER_IMPORT_COLUMNS[kind].map((key) => ({
    header: key,
    key,
    width: key === "nama" || key === "deskripsi" ? 32 : 16,
  }));
  ws.getRow(HEADER_ROW).font = { bold: true };
  return [wb, ws];
}

export async function catalogueWorkbook(
  kind: MasterKind,
  extra: "none" | "description",
  rows: CatalogueExisting[]
): Promise<Buffer> {
  const [wb, ws] = catalogueSheet(kind);
  const parentColumns = MASTER_IMPORT_PARENT_COLUMNS[kind] ?? [];
  for (const row of rows)
    ws.addRow({
      // The owner columns come from the row's own path, so an export of
      // `jabatan` is a file the import can take straight back.
      ...Object.fromEntries(
        parentColumns.map((column, i) => [column, row.path?.[i] ?? ""])
      ),
      nama: row.name,
      ...(extra === "description" ? { deskripsi: row.description ?? "" } : {}),
      ...(row.code !== undefined ? { kode: row.code } : {}),
      ...(row.fleetAllocation !== undefined
        ? { alokasi_fleet: boolText(row.fleetAllocation) }
        : {}),
      aktif: boolText(row.active),
    });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * One filled-in row per kind, so the expected shape is obvious without a
 * manual — the same job the account template's example row does.
 *
 * A worked example rather than a description: `kelas-unit` shows a code beside
 * its description so the two are not transposed.
 */
const CATALOGUE_EXAMPLE: Record<MasterKind, Record<string, string>> = {
  "jenis-unit": { nama: "EXCAVATOR" },
  "model-unit": { nama: "EX2600-7BH" },
  "merk-unit": { nama: "HITACHI" },
  mess: { nama: "Mess A" },
  "kelas-unit": { nama: "BIGDIGGER", deskripsi: "Excavator besar (250T)" },
  simper: { nama: "F", deskripsi: "Full permit" },
  "kode-simper": {
    nama: "EXC 2600",
    deskripsi: "Excavator Hitachi EX2600 / EX2000",
  },
  perusahaan: {
    nama: "PT UNGGUL DINAMIKA UTAMA",
    kode: "UDU",
    deskripsi: "Kontraktor penambangan",
  },
  // The owner columns are filled in too, because a blank one in the example is
  // the reading "this is optional" — and it is the opposite of optional.
  departemen: {
    perusahaan: "PT UNGGUL DINAMIKA UTAMA",
    nama: "MINING OPERATION",
    deskripsi: "Operasi penambangan",
  },
  jabatan: {
    perusahaan: "PT UNGGUL DINAMIKA UTAMA",
    departemen: "MINING OPERATION",
    nama: "OPERATOR DUMP TRUCK",
    deskripsi: "Operator dump truck produksi",
    alokasi_fleet: "TRUE",
  },
};

/**
 * The blank template an operator downloads before filling it in.
 *
 * Separate from the export on purpose, even though the two share their columns:
 * an export of four hundred work areas is not something to type a new one into,
 * and a template is not something to check current data against. Reaching for
 * whichever template happened to be at hand is exactly how a spreadsheet of
 * account columns ends up at a catalogue's import.
 */
export async function catalogueTemplate(kind: MasterKind): Promise<Buffer> {
  const [wb, ws] = catalogueSheet(kind);
  ws.addRow({ ...CATALOGUE_EXAMPLE[kind], aktif: boolText(true) });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* -------------------------------------------------------------------- units */

export type UnitExisting = {
  id: string;
  code: string;
  className: string;
  typeName: string;
  modelName: string;
  brandName: string;
  simperCodeName: string | null;
  /**
   * Carried beside the name because the name alone no longer identifies a
   * department: two companies may each hold a `MINING OPERATION`, and a row
   * that keeps its department must keep *this* one, not whichever same-named
   * one a lookup happens to find.
   */
  departmentId: string | null;
  departmentName: string | null;
  serial: string;
  engineBrand: string;
  description: string;
  ftw: boolean;
  active: boolean;
};

/**
 * A parsed unit row.
 *
 * Every catalogue id may be `null`, meaning "this name is not in the master
 * yet" — the reference is carried by name until the commit creates the record
 * and can supply an id. `pending` says which ones, so nothing has to re-derive
 * it by scanning for nulls.
 *
 * A `null` id with a `null` *name* is a different thing entirely: the column
 * was left blank and that is allowed. Only the two optional references can be
 * in that state — `simperCodeId` on a unit needing no qualification, and
 * `departmentId` on a unit no department owns.
 */
export type ParsedUnit = {
  code: string;
  classId: string | null;
  className: string;
  typeId: string | null;
  typeName: string;
  modelId: string | null;
  modelName: string;
  brandId: string | null;
  brandName: string;
  simperCodeId: string | null;
  simperCodeName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  serial: string;
  engineBrand: string;
  description: string;
  ftw: boolean;
  active: boolean;
  pending: PendingRef[];
};

/** One department a bare name could mean, with the company that qualifies it. */
export type UnitDepartment = { id: string; name: string; company: string };

/**
 * name (lowercased) → { id, name }, for each catalogue a unit row can name.
 *
 * Departments are the exception: their name is unique only within a company,
 * and the unit sheet has no company column — so the map carries *every* record
 * a name could mean, and the parser refuses the ones it cannot settle.
 */
export type Catalogues = {
  classes: Map<string, { id: string; name: string }>;
  types: Map<string, { id: string; name: string }>;
  models: Map<string, { id: string; name: string }>;
  brands: Map<string, { id: string; name: string }>;
  simperCodes: Map<string, { id: string; name: string }>;
  departments: Map<string, UnitDepartment[]>;
};

/** Which catalogue each reference column draws on, for the warning and the offer. */
const UNIT_REFS = {
  kelas: { kind: "kelas-unit", label: "Kelas" },
  jenis: { kind: "jenis-unit", label: "Jenis" },
  model: { kind: "model-unit", label: "Model" },
  merk: { kind: "merk-unit", label: "Merk" },
  departemen: { kind: "departemen", label: "Departemen" },
  kode_simper: { kind: "kode-simper", label: "Kode SIMPER" },
} as const satisfies Record<string, { kind: MasterKind; label: string }>;

export type UnitRefColumn = keyof typeof UNIT_REFS;

/**
 * What looking up one reference can come to. Spelled out rather than inferred:
 * the four cases are narrowed by `in` checks below, and an inferred union
 * collapses into one object of optional members that narrows to nothing.
 *
 * `null` is "the column was blank and there is no previous value" — only legal
 * for `kode_simper`. `undefined` cannot occur in practice but is what a `Map`
 * miss types as, and treating it as absent is the honest reading.
 */
type Resolution =
  | { id: string; name: string }
  | { pending: PendingRef }
  | {
      missing: string;
      label: string;
      /**
       * Why it cannot simply be created, when the reason is not "you lack the
       * grant". A department and a position each belong to something, and the
       * sheet names that something in another column — so an unknown one is a
       * pairing that does not exist rather than a name nobody has typed yet.
       */
      because?: string;
    }
  | null
  | undefined;

export function unitTarget(
  existing: Map<string, UnitExisting>,
  catalogues: Catalogues,
  /**
   * Whether an unknown value in this column may be created rather than refused.
   *
   * A predicate rather than a flag because the answer is per catalogue: the
   * caller's `manage` grants are per master menu, and someone who may add a
   * unit model has not thereby been given departments.
   */
  mayCreate: (kind: MasterKind) => boolean
): ImportTarget<UnitExisting, ParsedUnit> {
  return {
    columns: UNIT_IMPORT_COLUMNS,
    required: ["kode"],
    existing,
    parse: (read, current) => {
      const code = read("kode").toUpperCase();
      if (!code) return { issue: "Kode unit kosong", key: "", label: "" };

      /**
       * Resolve one catalogue reference.
       *
       * Matched lowercased and trimmed (`cellText` already trimmed), which is
       * the same comparison the `lower(name)` index enforces — so a file whose
       * casing differs from the catalogue imports cleanly, and only a genuine
       * misspelling misses.
       *
       * A miss is not automatically a failure any more: if the caller may add
       * to that catalogue it comes back as `{ pending }`, carrying the name
       * until the commit creates the record and can supply an id.
       */
      const resolve = (
        column: UnitRefColumn,
        map: Map<string, { id: string; name: string }>,
        currentName: string | null | undefined
      ): Resolution => {
        const raw = read(column);
        if (!raw)
          return currentName ? map.get(currentName.toLowerCase()) : null;
        const found = map.get(raw.toLowerCase());
        if (found) return found;
        const ref = UNIT_REFS[column];
        if (!mayCreate(ref.kind)) return { missing: raw, label: ref.label };
        // Checked only once a value is known to be new, which is the only time
        // "did you mean" is a question worth asking.
        const similarTo = nearestName(
          raw,
          [...map.values()].map((r) => r.name)
        );
        return {
          pending: {
            kind: ref.kind,
            name: raw,
            label: ref.label,
            ...(similarTo ? { similarTo } : {}),
          },
        };
      };

      /**
       * The department, resolved apart from the leaf catalogues above.
       *
       * A department belongs to a company (design D1) and its name is unique
       * only within one (D2), while the unit sheet carries no company column —
       * so a bare name can be ambiguous, and an unknown one can never be
       * created from here: a department without a company is a row the
       * database refuses, and one filed under a guessed company is worse (D7).
       *
       * A cell that names the unit's own current department keeps it — by id,
       * not by lookup — so an untouched export re-imports cleanly even where
       * the name is ambiguous. Only a cell that would *move* the unit has to
       * settle which department it means.
       */
      const department = (): Resolution => {
        const raw = read("departemen");
        if (!raw)
          return current?.departmentId
            ? { id: current.departmentId, name: current.departmentName ?? "" }
            : null;
        if (
          current?.departmentId &&
          current.departmentName?.toLowerCase() === raw.toLowerCase()
        )
          return { id: current.departmentId, name: current.departmentName };
        const candidates = catalogues.departments.get(raw.toLowerCase()) ?? [];
        if (candidates.length === 1)
          return { id: candidates[0]!.id, name: candidates[0]!.name };
        if (candidates.length > 1)
          return {
            missing: raw,
            label: "Departemen",
            because:
              `Departemen "${raw}" ada di beberapa perusahaan (${candidates
                .map((c) => c.company)
                .join(", ")}) — nama saja tidak menentukan yang mana. ` +
              `Pindahkan unit ini lewat menu Database Unit, yang memilih departemennya langsung.`,
          };
        return {
          missing: raw,
          label: "Departemen",
          because:
            `Departemen "${raw}" tidak ada di master. Departemen milik sebuah perusahaan, ` +
            `jadi tidak pernah dibuat lewat import unit — tambahkan dulu di menu Departemen ` +
            `di bawah perusahaan yang benar, lalu import ulang.`,
        };
      };

      const resolved = {
        cls: resolve("kelas", catalogues.classes, current?.className),
        typ: resolve("jenis", catalogues.types, current?.typeName),
        mdl: resolve("model", catalogues.models, current?.modelName),
        brd: resolve("merk", catalogues.brands, current?.brandName),
        dpt: department(),
        spc: resolve(
          "kode_simper",
          catalogues.simperCodes,
          current?.simperCodeName
        ),
      };

      for (const value of Object.values(resolved)) {
        if (value && "missing" in value)
          return {
            issue:
              value.because ??
              `${value.label} "${value.missing}" tidak ada di master, dan Anda tidak punya akses menambahnya — minta ditambahkan di menu masternya`,
            key: code,
            label: value.missing,
          };
      }

      // The four required references: absent on a new row is a failed row, not
      // a null column, because the database would refuse it anyway. A pending
      // one counts as present — it will exist by the time anything is written.
      //
      // `departemen` is deliberately not among them. A unit no department owns
      // is a company-wide asset, and a blank column says so; requiring it would
      // force operators to invent an owner for the shared fleet.
      const required = [
        [resolved.cls, "Kelas"],
        [resolved.typ, "Jenis"],
        [resolved.mdl, "Model"],
        [resolved.brd, "Merk"],
      ] as const;
      for (const [value, label] of required) {
        if (!value)
          return { issue: `${label} wajib diisi`, key: code, label: "" };
      }

      /** `{ id, name }` once resolved, `{ id: null, name }` while pending. */
      type Ref = { id: string | null; name: string };
      const pending: PendingRef[] = [];
      const ref = (value: Resolution): Ref => {
        if (!value) return { id: null, name: "" };
        if ("pending" in value) {
          pending.push(value.pending);
          return { id: null, name: value.pending.name };
        }
        // `missing` was returned above, so only a resolved record is left.
        return value as { id: string; name: string };
      };

      const cls = ref(resolved.cls);
      const typ = ref(resolved.typ);
      const mdl = ref(resolved.mdl);
      const brd = ref(resolved.brd);
      // The two optional references: a blank column means none at all, which is
      // a null id *and* a null name — distinct from a pending one, whose name
      // is what the commit resolves it by.
      const spc = resolved.spc ? ref(resolved.spc) : null;
      const dpt = resolved.dpt ? ref(resolved.dpt) : null;

      return {
        code,
        classId: cls.id,
        className: cls.name,
        typeId: typ.id,
        typeName: typ.name,
        modelId: mdl.id,
        modelName: mdl.name,
        brandId: brd.id,
        brandName: brd.name,
        simperCodeId: spc?.id ?? null,
        simperCodeName: spc?.name ?? null,
        departmentId: dpt?.id ?? null,
        departmentName: dpt?.name ?? null,
        serial: read("serial") || (current?.serial ?? ""),
        engineBrand: read("engine_brand") || (current?.engineBrand ?? ""),
        description: read("deskripsi") || (current?.description ?? ""),
        ftw: boolCell(read("ftw"), current?.ftw ?? false),
        active: boolCell(read("aktif"), current?.active ?? true),
        pending,
      };
    },
    pendingOf: (p) => p.pending,
    keyOf: (p) => p.code,
    labelOf: (p) => `${p.modelName} · ${p.brandName}`,
    diff: (current, parsed) => {
      const changes: MasterImportChange[] = [];
      const compare = (
        field: string,
        from: string | null,
        to: string | null
      ) => {
        if ((from ?? "") !== (to ?? "")) changes.push({ field, from, to });
      };
      compare("kelas", current.className, parsed.className);
      compare("jenis", current.typeName, parsed.typeName);
      compare("model", current.modelName, parsed.modelName);
      compare("merk", current.brandName, parsed.brandName);
      compare("kode_simper", current.simperCodeName, parsed.simperCodeName);
      compare("departemen", current.departmentName, parsed.departmentName);
      compare("serial", current.serial, parsed.serial);
      compare("engine_brand", current.engineBrand, parsed.engineBrand);
      compare("deskripsi", current.description, parsed.description);
      compare("ftw", boolText(current.ftw), boolText(parsed.ftw));
      compare("aktif", boolText(current.active), boolText(parsed.active));
      return changes;
    },
  };
}

function unitSheet(): [ExcelJS.Workbook, ExcelJS.Worksheet] {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("unit");
  ws.columns = UNIT_IMPORT_COLUMNS.map((key) => ({
    header: key,
    key,
    width: key === "deskripsi" || key === "serial" ? 30 : 18,
  }));
  ws.getRow(HEADER_ROW).font = { bold: true };
  return [wb, ws];
}

/**
 * The unit template's example row names catalogue values that the seed
 * creates, so a first import against a seeded database succeeds as written
 * rather than failing on six references at once.
 */
export async function unitTemplate(): Promise<Buffer> {
  const [wb, ws] = unitSheet();
  ws.addRow({
    kode: "EX8001",
    kelas: "BIGDIGGER",
    jenis: "EXCAVATOR",
    model: "EX2600-7BH",
    merk: "HITACHI",
    kode_simper: "EXC 2600",
    departemen: "Mining Operation",
    serial: "KEA90E00007046",
    engine_brand: "CUMMINS",
    deskripsi: "EXCAVATOR250T",
    ftw: boolText(false),
    aktif: boolText(true),
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function unitWorkbook(rows: UnitExisting[]): Promise<Buffer> {
  const [wb, ws] = unitSheet();
  for (const row of rows)
    ws.addRow({
      kode: row.code,
      kelas: row.className,
      jenis: row.typeName,
      model: row.modelName,
      merk: row.brandName,
      // Both optional references export blank when absent, and a blank cell is
      // what the import reads back as "leave it alone" — so the round trip of
      // an unowned unit stays unowned rather than acquiring a department.
      kode_simper: row.simperCodeName ?? "",
      departemen: row.departmentName ?? "",
      serial: row.serial,
      engine_brand: row.engineBrand,
      deskripsi: row.description,
      ftw: boolText(row.ftw),
      aktif: boolText(row.active),
    });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ---------------------------------------------------------------- employees */

export type EmployeeExisting = {
  id: string;
  nik: string;
  name: string;
  companyName: string;
  positionName: string;
  departmentName: string;
  messName: string | null;
  simperTypeName: string | null;
  joinDate: string | null;
  status: EmployeeStatus;
  simperNo: string;
  simperExp: string | null;
  /** Qualification code names, sorted — the shape the sheet's cell holds. */
  skills: string[];
  license: string;
  mcu: McuResult | null;
  mcuExp: string | null;
  blood: BloodType | null;
  medical: string;
  block: string;
  room: string;
  phone: string;
  emergency: string;
};

/**
 * A parsed employee row.
 *
 * Same convention as `ParsedUnit`: a catalogue id may be `null` while the
 * reference is carried by name until the commit creates the record and can
 * supply one. `skillIds` is the exception — it is never null, because a
 * qualification code is never created by an employee import (design D11), so a
 * code that did not resolve failed the row long before this shape was built.
 */
export type ParsedEmployee = {
  nik: string;
  name: string;
  companyId: string | null;
  companyName: string;
  positionId: string | null;
  positionName: string;
  departmentId: string | null;
  departmentName: string;
  messId: string | null;
  messName: string | null;
  simperTypeId: string | null;
  simperTypeName: string | null;
  joinDate: string | null;
  status: EmployeeStatus;
  simperNo: string;
  simperExp: string | null;
  skillIds: string[];
  skillNames: string[];
  license: string;
  mcu: McuResult | null;
  mcuExp: string | null;
  blood: BloodType | null;
  medical: string;
  block: string;
  room: string;
  phone: string;
  emergency: string;
  pending: PendingRef[];
};

/**
 * Lowercased key → { id, name }, for each catalogue an employee row names.
 *
 * Two of them are keyed on more than a name, because two of them are no longer
 * identified by one: a department by `company|department`, a position by
 * `company|department|position`.
 */
export type EmployeeCatalogues = {
  companies: Map<string, { id: string; name: string }>;
  positions: Map<string, { id: string; name: string }>;
  departments: Map<string, { id: string; name: string }>;
  messes: Map<string, { id: string; name: string }>;
  simperTypes: Map<string, { id: string; name: string }>;
  /** Read but never written: see `kode_simper` below. */
  simperCodes: Map<string, { id: string; name: string }>;
};

/**
 * The five columns that may offer a catalogue addition.
 *
 * `kode_simper` is deliberately absent, and that absence is the whole of D11 —
 * see the parse below.
 */
const EMPLOYEE_REFS = {
  perusahaan: { kind: "perusahaan", label: "Perusahaan" },
  jabatan: { kind: "jabatan", label: "Jabatan" },
  departemen: { kind: "departemen", label: "Departemen" },
  mess: { kind: "mess", label: "Mess" },
  simper: { kind: "simper", label: "Tipe SIMPER" },
} as const satisfies Record<string, { kind: MasterKind; label: string }>;

type EmployeeRefColumn = keyof typeof EMPLOYEE_REFS;

/** What the row's own text says about a qualification code that does not exist. */
const UNKNOWN_SKILL_ISSUE = (code: string) =>
  `Kode SIMPER "${code}" tidak ada di master. Kode kualifikasi tidak pernah ` +
  `dibuat lewat import karyawan — tambahkan dulu di menu Kode SIMPER, lalu ` +
  `import ulang. Kode yang salah ketik menghasilkan operator yang tampak ` +
  `punya keahlian tapi tidak pernah cocok dengan unit mana pun.`;

/** `YYYY-MM-DD`, or a reason it is not one. Blank keeps what the record has. */
function dateValue(
  raw: string,
  current: string | null | undefined
): { date: string | null } | { issue: string } {
  if (!raw) return { date: current ?? null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw))
    return { issue: `Tanggal "${raw}" harus berformat YYYY-MM-DD` };
  /*
   * The shape is not the date. "2027-01-32" matches the pattern above
   * perfectly, and only Postgres knows January has 31 days — so it used to
   * pass validation, reach the driver mid-sheet, and come back as a raw
   * `date/time field value out of range`, with no row and no column named.
   * That is precisely the failure this validator exists to prevent, and the
   * spreadsheets that produce it are common: a generator that counts days
   * upward without rolling the month emits a run of them.
   *
   * Round-tripping through `Date.UTC` is the check — it normalizes rather than
   * rejects, so a value that comes back different is a value that does not
   * exist. UTC, not local: a local-midnight construction shifts the day either
   * side of the date line and would reject or accept by the server's timezone.
   */
  const [year, month, day] = raw.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  )
    return { issue: `Tanggal "${raw}" tidak ada dalam kalender` };
  return { date: raw };
}

/** Case-insensitive lookup into a small closed vocabulary. */
const matchIn = <T extends string>(
  values: readonly T[],
  raw: string
): T | undefined => values.find((v) => v.toLowerCase() === raw.toLowerCase());

export function employeeTarget(
  existing: Map<string, EmployeeExisting>,
  catalogues: EmployeeCatalogues,
  /**
   * Whether an unknown value in this column may be created rather than refused.
   *
   * Per catalogue, because the caller's `manage` grants are per master menu:
   * someone who may add a position has not thereby been given departments.
   * Never consulted for `kode-simper`, which is refused regardless.
   */
  mayCreate: (kind: MasterKind) => boolean,
  /**
   * The one department a scoped caller may write into, if their scope names
   * one.
   *
   * Checked on both sides of the row: the department the sheet states, and the
   * one the employee is already in. Only the first would let a department admin
   * pull somebody out of a neighbouring department by writing their NIK into
   * their own sheet — a transfer nobody in the other department agreed to, and
   * one that reads as an ordinary import.
   *
   * `existing` is deliberately still unscoped, for the reason its caller
   * documents: a NIK the caller cannot see has to *resolve* in order to be
   * refused, or the row would be treated as a new employee and collide with
   * the unique index halfway through the commit.
   */
  restrictTo?: { id: string; name: string }
): ImportTarget<EmployeeExisting, ParsedEmployee> {
  return {
    columns: EMPLOYEE_IMPORT_COLUMNS,
    required: ["nik"],
    existing,
    parse: (read, current) => {
      const nik = read("nik");
      if (!nik) return { issue: "NIK kosong", key: "", label: "" };
      const name = read("nama") || current?.name || "";
      if (!name) return { issue: "Nama kosong", key: nik, label: "" };

      /** Resolve one catalogue reference — the same shape `unitTarget` uses. */
      const resolve = (
        column: EmployeeRefColumn,
        map: Map<string, { id: string; name: string }>,
        currentName: string | null | undefined
      ): Resolution => {
        const raw = read(column);
        if (!raw)
          return currentName ? map.get(currentName.toLowerCase()) : null;
        const found = map.get(raw.toLowerCase());
        if (found) return found;
        const ref = EMPLOYEE_REFS[column];
        if (!mayCreate(ref.kind)) return { missing: raw, label: ref.label };
        const similarTo = nearestName(
          raw,
          [...map.values()].map((r) => r.name)
        );
        return {
          pending: {
            kind: ref.kind,
            name: raw,
            label: ref.label,
            ...(similarTo ? { similarTo } : {}),
          },
        };
      };

      /**
       * A department is identified by its company and a position by its
       * department, so these two are not looked up by name.
       *
       * `MINING OPERATION` names a department under each company and `ADMIN`
       * names one under every department; a lookup on the bare name would
       * resolve to whichever row was loaded last and attach the person to a
       * plausible-looking stranger. The sheet already carries the qualifying
       * columns, so the key is built from them.
       *
       * Neither may be created from here, whatever the caller's grants. A new
       * one would have to be filed under a parent this import inferred, and a
       * department invented under the wrong company is not a row an operator
       * would notice — it is a department that looks right on the employee
       * screen and is missing from the roster of the company that expected it.
       * The same reasoning `kode_simper` already carries (D11).
       */
      const companyName = read("perusahaan") || current?.companyName || "";
      const departmentName =
        read("departemen") || current?.departmentName || "";
      const positionName = read("jabatan") || current?.positionName || "";

      const owned = (
        raw: string,
        key: string,
        map: Map<string, { id: string; name: string }>,
        label: string,
        because: string
      ): Resolution => {
        if (!raw) return null;
        return map.get(key.toLowerCase()) ?? { missing: raw, label, because };
      };

      const resolved = {
        cmp: resolve("perusahaan", catalogues.companies, current?.companyName),
        dpt: owned(
          departmentName,
          `${companyName}|${departmentName}`,
          catalogues.departments,
          "Departemen",
          `Departemen "${departmentName}" tidak ada di perusahaan "${companyName || "—"}". ` +
            `Departemen tidak pernah dibuat lewat import karyawan — tambahkan dulu ` +
            `di menu Departemen di bawah perusahaan yang benar, lalu import ulang.`
        ),
        pos: owned(
          positionName,
          `${companyName}|${departmentName}|${positionName}`,
          catalogues.positions,
          "Jabatan",
          `Jabatan "${positionName}" tidak ada di departemen "${departmentName || "—"}". ` +
            `Jabatan tidak pernah dibuat lewat import karyawan — tambahkan dulu ` +
            `di menu Jabatan di bawah departemen yang benar, lalu import ulang.`
        ),
        mss: resolve("mess", catalogues.messes, current?.messName),
        spt: resolve("simper", catalogues.simperTypes, current?.simperTypeName),
      };

      for (const value of Object.values(resolved)) {
        if (value && "missing" in value)
          return {
            issue:
              value.because ??
              `${value.label} "${value.missing}" tidak ada di master, dan Anda tidak punya akses menambahnya — minta ditambahkan di menu masternya`,
            key: nik,
            label: value.missing,
          };
      }

      // The three required references. Blank on a new row fails it rather than
      // writing a null column, because the database would refuse it anyway. A
      // pending one counts as present — it will exist before anything is
      // written. Mess and permit type are not among them: living off site and
      // holding no permit are both real states.
      const required = [
        [resolved.cmp, "Perusahaan"],
        [resolved.pos, "Jabatan"],
        [resolved.dpt, "Departemen"],
      ] as const;
      for (const [value, label] of required) {
        if (!value)
          return { issue: `${label} wajib diisi`, key: nik, label: "" };
      }

      if (restrictTo) {
        // Where the row would put them.
        const target = resolved.dpt as { id: string; name: string };
        if (target.id !== restrictTo.id)
          return {
            issue: `Departemen "${target.name}" bukan departemen Anda — akun ini hanya boleh menulis ke "${restrictTo.name}"`,
            key: nik,
            label: target.name,
          };
        // Where they are now. A NIK from a neighbouring department is refused
        // even when the sheet files them correctly, because the import would
        // otherwise be a transfer nobody over there agreed to.
        if (current && current.departmentName !== restrictTo.name)
          return {
            issue: `NIK ${nik} terdaftar di departemen "${current.departmentName}" — pemindahan antar departemen tidak lewat import`,
            key: nik,
            label: current.name,
          };
      }

      type Ref = { id: string | null; name: string };
      const pending: PendingRef[] = [];
      const ref = (value: Resolution): Ref => {
        if (!value) return { id: null, name: "" };
        if ("pending" in value) {
          pending.push(value.pending);
          return { id: null, name: value.pending.name };
        }
        return value as { id: string; name: string };
      };

      const cmp = ref(resolved.cmp);
      const pos = ref(resolved.pos);
      const dpt = ref(resolved.dpt);
      const mss = resolved.mss ? ref(resolved.mss) : null;
      const spt = resolved.spt ? ref(resolved.spt) : null;

      /**
       * The qualification codes, from one multi-valued cell (design D11).
       *
       * A blank cell keeps whatever the record holds, the same rule every other
       * optional column follows here — otherwise a file that simply omits the
       * column would strip every operator of every qualification, which is the
       * failure mode this product is built to prevent and which produces no
       * error at all.
       *
       * An unknown code is the one reference that is never offered for
       * creation. The asymmetry is deliberate and the issue text has to explain
       * it, because five columns offering an addition and one refusing reads as
       * a bug otherwise.
       */
      const rawSkills = read("kode_simper");
      const skillNames: string[] = [];
      const skillIds: string[] = [];
      if (rawSkills) {
        const seenSkill = new Set<string>();
        for (const piece of rawSkills.split(SKILL_SEPARATOR)) {
          const code = piece.trim();
          if (!code) continue;
          // The same code twice in one cell is one assignment.
          if (seenSkill.has(code.toLowerCase())) continue;
          seenSkill.add(code.toLowerCase());
          const found = catalogues.simperCodes.get(code.toLowerCase());
          if (!found)
            return { issue: UNKNOWN_SKILL_ISSUE(code), key: nik, label: code };
          skillNames.push(found.name);
          skillIds.push(found.id);
        }
      } else if (current) {
        for (const code of current.skills) {
          const found = catalogues.simperCodes.get(code.toLowerCase());
          if (found) {
            skillNames.push(found.name);
            skillIds.push(found.id);
          }
        }
      }
      skillNames.sort();

      const dates: Record<string, string | null> = {};
      for (const [column, currentValue] of [
        ["tanggal_masuk", current?.joinDate],
        ["simper_exp", current?.simperExp],
        ["mcu_exp", current?.mcuExp],
      ] as const) {
        const value = dateValue(read(column), currentValue);
        if ("issue" in value)
          return { issue: value.issue, key: nik, label: name };
        dates[column] = value.date;
      }

      const rawStatus = read("status");
      const status = rawStatus
        ? matchIn(EMPLOYEE_STATUSES, rawStatus)
        : (current?.status ?? "aktif");
      if (!status)
        return {
          issue: `Status "${rawStatus}" bukan ${EMPLOYEE_STATUSES.join(" atau ")}`,
          key: nik,
          label: name,
        };

      const rawMcu = read("mcu");
      const mcu = rawMcu
        ? matchIn(MCU_RESULTS, rawMcu)
        : (current?.mcu ?? null);
      if (rawMcu && !mcu)
        return {
          issue: `Hasil MCU "${rawMcu}" bukan ${MCU_RESULTS.join(", ")}`,
          key: nik,
          label: name,
        };

      const rawBlood = read("golongan_darah");
      const blood = rawBlood
        ? matchIn(BLOOD_TYPES, rawBlood)
        : (current?.blood ?? null);
      if (rawBlood && !blood)
        return {
          issue: `Golongan darah "${rawBlood}" bukan ${BLOOD_TYPES.join(", ")}`,
          key: nik,
          label: name,
        };

      return {
        nik,
        name,
        companyId: cmp.id,
        companyName: cmp.name,
        positionId: pos.id,
        positionName: pos.name,
        departmentId: dpt.id,
        departmentName: dpt.name,
        messId: mss?.id ?? null,
        messName: mss?.name ?? null,
        simperTypeId: spt?.id ?? null,
        simperTypeName: spt?.name ?? null,
        joinDate: dates["tanggal_masuk"] ?? null,
        status,
        simperNo: read("simper_no") || (current?.simperNo ?? ""),
        simperExp: dates["simper_exp"] ?? null,
        skillIds,
        skillNames,
        license: read("lisensi") || (current?.license ?? ""),
        mcu: mcu ?? null,
        mcuExp: dates["mcu_exp"] ?? null,
        blood: blood ?? null,
        medical: read("riwayat_medis") || (current?.medical ?? ""),
        block: read("blok") || (current?.block ?? ""),
        room: read("kamar") || (current?.room ?? ""),
        phone: read("telepon") || (current?.phone ?? ""),
        emergency: read("kontak_darurat") || (current?.emergency ?? ""),
        pending,
      };
    },
    pendingOf: (p) => p.pending,
    keyOf: (p) => p.nik,
    labelOf: (p) => p.name,
    // No `nearMatch`: the key is a NIK, and two employee numbers differing by
    // one digit is the normal case rather than a suspicious one.
    diff: (current, parsed) => {
      const changes: MasterImportChange[] = [];
      const compare = (
        field: string,
        from: string | null,
        to: string | null
      ) => {
        if ((from ?? "") !== (to ?? "")) changes.push({ field, from, to });
      };
      compare("nama", current.name, parsed.name);
      compare("perusahaan", current.companyName, parsed.companyName);
      compare("jabatan", current.positionName, parsed.positionName);
      compare("departemen", current.departmentName, parsed.departmentName);
      compare("mess", current.messName, parsed.messName);
      compare("simper", current.simperTypeName, parsed.simperTypeName);
      compare("tanggal_masuk", current.joinDate, parsed.joinDate);
      compare("status", current.status, parsed.status);
      compare("simper_no", current.simperNo, parsed.simperNo);
      compare("simper_exp", current.simperExp, parsed.simperExp);
      // Compared as a sorted joined list, so a reordered cell is not a change.
      compare(
        "kode_simper",
        skillText(current.skills),
        skillText(parsed.skillNames)
      );
      compare("lisensi", current.license, parsed.license);
      compare("mcu", current.mcu, parsed.mcu);
      compare("mcu_exp", current.mcuExp, parsed.mcuExp);
      compare("golongan_darah", current.blood, parsed.blood);
      compare("riwayat_medis", current.medical, parsed.medical);
      compare("blok", current.block, parsed.block);
      compare("kamar", current.room, parsed.room);
      compare("telepon", current.phone, parsed.phone);
      compare("kontak_darurat", current.emergency, parsed.emergency);
      return changes;
    },
  };
}

/** The cell a set of qualification codes is written to and read back from. */
export const skillText = (codes: string[]) =>
  [...codes].sort().join(`${SKILL_SEPARATOR} `);

function employeeSheet(): [ExcelJS.Workbook, ExcelJS.Worksheet] {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("karyawan");
  ws.columns = EMPLOYEE_IMPORT_COLUMNS.map((key) => ({
    header: key,
    key,
    width:
      key === "kontak_darurat" || key === "kode_simper" || key === "nama"
        ? 32
        : 18,
  }));
  ws.getRow(HEADER_ROW).font = { bold: true };
  return [wb, ws];
}

/** One filled-in row, naming values the seed creates, so a first import lands. */
export async function employeeTemplate(): Promise<Buffer> {
  const [wb, ws] = employeeSheet();
  ws.addRow({
    nik: "503220421",
    nama: "Budi Santoso",
    perusahaan: "PT Unggul Dinamika Utama",
    jabatan: "Driver OHT",
    departemen: "Mining Operation",
    tanggal_masuk: "2022-03-01",
    status: "aktif",
    simper: "F",
    simper_no: "F-2022-0421",
    simper_exp: "2027-03-14",
    kode_simper: skillText(["OHT 777", "OHT 773"]),
    lisensi: "SIM BII Umum",
    mcu: "Fit",
    mcu_exp: "2027-01-15",
    golongan_darah: "O",
    riwayat_medis: "",
    mess: "Mess A",
    blok: "Blok 1",
    kamar: "A-12",
    telepon: "0812-3456-7890",
    kontak_darurat: "Siti Santoso (istri) — 0813-1111-2222",
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function employeeWorkbook(
  rows: EmployeeExisting[]
): Promise<Buffer> {
  const [wb, ws] = employeeSheet();
  for (const row of rows)
    ws.addRow({
      nik: row.nik,
      nama: row.name,
      perusahaan: row.companyName,
      jabatan: row.positionName,
      departemen: row.departmentName,
      // Every optional value exports blank when absent, and a blank cell is
      // what the import reads back as "leave it alone" — so the round trip of
      // an employee with no mess stays without one rather than acquiring one.
      tanggal_masuk: row.joinDate ?? "",
      status: row.status,
      simper: row.simperTypeName ?? "",
      simper_no: row.simperNo,
      simper_exp: row.simperExp ?? "",
      kode_simper: skillText(row.skills),
      lisensi: row.license,
      mcu: row.mcu ?? "",
      mcu_exp: row.mcuExp ?? "",
      golongan_darah: row.blood ?? "",
      riwayat_medis: row.medical,
      mess: row.messName ?? "",
      blok: row.block,
      kamar: row.room,
      telepon: row.phone,
      kontak_darurat: row.emergency,
    });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
