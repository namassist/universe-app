/**
 * Spreadsheet export and preview-then-commit import for the master catalogues
 * and the unit registry (design D10).
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
 */

import ExcelJS from "exceljs";
import {
  AREA_TYPES,
  MASTER_IMPORT_COLUMNS,
  UNIT_IMPORT_COLUMNS,
  type AreaType,
  type ImportErrorRow,
  type MasterImportChange,
  type MasterImportPreview,
  type MasterImportPreviewRow,
  type MasterKind,
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

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
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
    const rawKey = read(keyColumn).toLowerCase();
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
  type?: string;
  active: boolean;
};

export type ParsedCatalogue = {
  name: string;
  description: string | undefined;
  type: AreaType | undefined;
  active: boolean;
};

export function catalogueTarget(
  kind: MasterKind,
  extra: "none" | "description" | "type",
  existing: Map<string, CatalogueExisting>
): ImportTarget<CatalogueExisting, ParsedCatalogue> {
  const columns = MASTER_IMPORT_COLUMNS[kind];
  return {
    columns,
    required: ["nama"],
    existing,
    parse: (read, current) => {
      const name = read("nama");
      if (!name) return { issue: "Nama kosong", key: "", label: "" };

      let type: AreaType | undefined;
      if (extra === "type") {
        const raw = read("tipe");
        // Empty is allowed on an update — the row keeps the type it has. On a
        // new row there is nothing to keep, so it has to be stated.
        if (!raw && current) type = current.type as AreaType;
        else {
          const matched = AREA_TYPES.find(
            (t) => t.toLowerCase() === raw.toLowerCase()
          );
          if (!matched)
            return {
              issue: `Tipe "${raw || "—"}" bukan ${AREA_TYPES.join(" atau ")}`,
              key: name,
              label: raw,
            };
          type = matched;
        }
      }

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
        type,
        active: boolCell(read("aktif"), current?.active ?? true),
      };
    },
    keyOf: (p) => p.name,
    labelOf: (p) => p.description ?? p.type ?? "",
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
      if (parsed.type !== undefined && current.type !== parsed.type)
        changes.push({
          field: "tipe",
          from: current.type ?? null,
          to: parsed.type,
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
  extra: "none" | "description" | "type",
  rows: CatalogueExisting[]
): Promise<Buffer> {
  const [wb, ws] = catalogueSheet(kind);
  for (const row of rows)
    ws.addRow({
      nama: row.name,
      ...(extra === "description" ? { deskripsi: row.description ?? "" } : {}),
      ...(extra === "type" ? { tipe: row.type ?? "" } : {}),
      aktif: boolText(row.active),
    });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * One filled-in row per kind, so the expected shape is obvious without a
 * manual — the same job the account template's example row does.
 *
 * A worked example rather than a description: `area-kerja` shows `Mining` in
 * the `tipe` column, which says what that column accepts more precisely than a
 * note beside it would, and `kelas-unit` shows a code beside its description so
 * the two are not transposed.
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
  departemen: { nama: "Mining Operation", deskripsi: "Operasi penambangan" },
  "area-kerja": { nama: "Panel East Puncak Utara", tipe: "Mining" },
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

/** name (lowercased) → { id, name }, for each catalogue a unit row can name. */
export type Catalogues = {
  classes: Map<string, { id: string; name: string }>;
  types: Map<string, { id: string; name: string }>;
  models: Map<string, { id: string; name: string }>;
  brands: Map<string, { id: string; name: string }>;
  simperCodes: Map<string, { id: string; name: string }>;
  departments: Map<string, { id: string; name: string }>;
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
  | { missing: string; label: string }
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
        map: Catalogues[keyof Catalogues],
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

      const resolved = {
        cls: resolve("kelas", catalogues.classes, current?.className),
        typ: resolve("jenis", catalogues.types, current?.typeName),
        mdl: resolve("model", catalogues.models, current?.modelName),
        brd: resolve("merk", catalogues.brands, current?.brandName),
        dpt: resolve(
          "departemen",
          catalogues.departments,
          current?.departmentName
        ),
        spc: resolve(
          "kode_simper",
          catalogues.simperCodes,
          current?.simperCodeName
        ),
      };

      for (const value of Object.values(resolved)) {
        if (value && "missing" in value)
          return {
            issue: `${value.label} "${value.missing}" tidak ada di master, dan Anda tidak punya akses menambahnya — minta ditambahkan di menu masternya`,
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
