/**
 * Bulk PLAN pairing by spreadsheet — one operator ↔ unit row at a time.
 *
 * This module parses and checks what a file can prove about itself: the codes
 * it names, its own internal consistency (the same pairing twice, one
 * operator on two units), and — via `pairingConflicts`, run after the route
 * has filtered rows through `refusePairing` — the capacity and Day/Night
 * rules against the *effective* plan: what the database holds, minus what
 * the file moves away, plus what it adds.
 */

import ExcelJS from "exceljs";
import {
  PLAN_IMPORT_COLUMNS,
  type ImportErrorRow,
  type PlanImportPreviewRow,
} from "@universe/contracts";

import {
  cellText,
  missingColumnsFailure,
  unknownColumnsFailure,
  type ParseFailure,
} from "./import-columns";

const HEADER_ROW = 1;

/** The same maximum the single-slot route enforces. */
export const PLAN_MAX_OPS = 2;

export type PlanCatalogues = {
  /** Active units, keyed lowercase code. */
  unitsByCode: Map<string, { id: string; code: string }>;
  /** Every employee, keyed NIK exactly as stored. */
  peopleByNik: Map<string, { id: string; nik: string; name: string }>;
  /** employeeId → the unit currently holding them in the plan. */
  slotOf: Map<string, { unitId: string; unitCode: string }>;
  /** unitId → employeeIds currently held. */
  heldByUnit: Map<string, string[]>;
};

/** A row the file itself could not refute, ready for the eligibility checks. */
export type ParsedPlanRow = {
  preview: PlanImportPreviewRow;
  unitId: string;
  employeeId: string;
  /** The unit a `moved` operator leaves; null for `new` and `unchanged`. */
  fromUnitId: string | null;
};

export type PlanParseResult = {
  rows: ParsedPlanRow[];
  errors: ImportErrorRow[];
};

function danger(
  row: number,
  nik: string,
  emp: string,
  issue: string
): ImportErrorRow {
  return {
    row: String(row),
    nik,
    emp,
    issue,
    badgeVariant: "danger",
    badge: "Error",
  };
}

/** The template a caller downloads before filling it in. */
export async function buildPlanTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Plan");
  ws.columns = PLAN_IMPORT_COLUMNS.map((key) => ({
    header: key,
    key,
    width: 18,
  }));
  ws.getRow(HEADER_ROW).font = { bold: true };
  // One example row, so the expected shape is obvious without a manual.
  ws.addRow({ unit: "EX8001", nik: "503220421" });
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/**
 * Parse an uploaded workbook against the catalogues and the file itself.
 * Eligibility is deliberately not judged here — the route holds each
 * surviving row against `refusePairing`, the same function the dialog goes
 * through, before asking `pairingConflicts` about capacity and shifts.
 */
export async function validatePlanWorkbook(
  bytes: ArrayBuffer,
  catalogues: PlanCatalogues
): Promise<PlanParseResult | ParseFailure> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes);
  } catch {
    return {
      code: "unreadable_file",
      message: "File tidak bisa dibaca sebagai spreadsheet .xlsx",
    };
  }

  const ws = wb.worksheets[0];
  if (!ws)
    return { code: "empty_file", message: "File tidak berisi sheet apa pun" };

  const headers = (ws.getRow(HEADER_ROW).values as ExcelJS.CellValue[])
    .slice(1)
    .map((v) => cellText(v).toLowerCase())
    .filter((h) => h.length > 0);

  const unknown = headers.filter(
    (h) => !(PLAN_IMPORT_COLUMNS as readonly string[]).includes(h)
  );
  if (unknown.length)
    return unknownColumnsFailure(unknown, PLAN_IMPORT_COLUMNS);

  const missing = PLAN_IMPORT_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length)
    return missingColumnsFailure([...missing], PLAN_IMPORT_COLUMNS);

  const index = (name: string) => headers.indexOf(name) + 1;
  const col = { unit: index("unit"), nik: index("nik") };

  const rows: ParsedPlanRow[] = [];
  const errors: ImportErrorRow[] = [];
  // One unit per operator holds *inside* the file too, and the refusal names
  // the row that spoke first. Keyed by employee id; the value is that row.
  const spokenFor = new Map<string, number>();

  for (let n = HEADER_ROW + 1; n <= ws.rowCount; n++) {
    const raw = ws.getRow(n);
    const unitCell = cellText(raw.getCell(col.unit).value);
    const nikCell = cellText(raw.getCell(col.nik).value);

    if (!unitCell && !nikCell) continue;

    if (!unitCell) {
      errors.push(danger(n, nikCell || "—", "—", "Kolom unit kosong"));
      continue;
    }
    if (!nikCell) {
      errors.push(danger(n, "—", unitCell, "Kolom nik kosong"));
      continue;
    }

    const unit = catalogues.unitsByCode.get(unitCell.toLowerCase());
    if (!unit) {
      errors.push(
        danger(
          n,
          nikCell,
          unitCell,
          `Unit "${unitCell}" tidak ada di master unit atau tidak aktif`
        )
      );
      continue;
    }

    const person = catalogues.peopleByNik.get(nikCell);
    if (!person) {
      errors.push(
        danger(
          n,
          nikCell,
          unit.code,
          `NIK "${nikCell}" tidak terdaftar di data karyawan`
        )
      );
      continue;
    }

    const earlier = spokenFor.get(person.id);
    if (earlier !== undefined) {
      errors.push(
        danger(
          n,
          person.nik,
          person.name,
          `${person.name} sudah dipakai baris ${earlier} file ini — satu operator satu unit`
        )
      );
      continue;
    }
    spokenFor.set(person.id, n);

    const held = catalogues.slotOf.get(person.id) ?? null;
    const kind =
      held === null
        ? ("new" as const)
        : held.unitId === unit.id
          ? ("unchanged" as const)
          : ("moved" as const);

    rows.push({
      preview: {
        row: n,
        kind,
        unit: unit.code,
        nik: person.nik,
        name: person.name,
        fromUnit: kind === "moved" ? held!.unitCode : null,
      },
      unitId: unit.id,
      employeeId: person.id,
      fromUnitId: kind === "moved" ? held!.unitId : null,
    });
  }

  return { rows, errors };
}

/**
 * Capacity and the Day/Night pair, judged against the effective plan.
 *
 * Walked in file order so the refusal lands on the row that overfilled the
 * unit or doubled the shift — the rows before it remain importable. Run this
 * on rows that already survived eligibility, or an ineligible row would be
 * blamed for a conflict its own refusal will dissolve.
 */
export function pairingConflicts(
  rows: ParsedPlanRow[],
  catalogues: PlanCatalogues,
  shiftOf: Map<string, "day" | "night">
): { rows: ParsedPlanRow[]; errors: ImportErrorRow[] } {
  // What each unit holds once every move in the file has released its old
  // slot — additions then land on top of this.
  const effective = new Map<string, string[]>();
  const leaving = new Set(
    rows.filter((r) => r.fromUnitId !== null).map((r) => r.employeeId)
  );
  for (const [unitId, held] of catalogues.heldByUnit)
    effective.set(
      unitId,
      held.filter((id) => !leaving.has(id))
    );

  const kept: ParsedPlanRow[] = [];
  const errors: ImportErrorRow[] = [];

  for (const row of rows) {
    if (row.preview.kind === "unchanged") {
      kept.push(row);
      continue;
    }
    const held = effective.get(row.unitId) ?? [];
    if (held.length >= PLAN_MAX_OPS) {
      errors.push(
        danger(
          row.preview.row,
          row.preview.nik,
          row.preview.name,
          `Unit ${row.preview.unit} sudah memegang ${PLAN_MAX_OPS} operator`
        )
      );
      continue;
    }
    const mine = shiftOf.get(row.employeeId);
    const partnerKind = held
      .map((id) => shiftOf.get(id))
      .find((k) => k !== undefined);
    if (mine && partnerKind && mine === partnerKind) {
      errors.push(
        danger(
          row.preview.row,
          row.preview.nik,
          row.preview.name,
          `${row.preview.name} dan pasangan unit ${row.preview.unit} sama-sama shift ${
            mine === "day" ? "pagi" : "malam"
          } hari ini — pasangan unit harus Day/Night`
        )
      );
      continue;
    }
    effective.set(row.unitId, [...held, row.employeeId]);
    kept.push(row);
  }

  return { rows: kept, errors };
}
