/**
 * Bulk fleet composition by spreadsheet — one fleet per row, keyed by its
 * digger.
 *
 * This module parses and checks what a file can prove about itself: the
 * columns, the codes it names, and its own internal consistency (a digger
 * leading twice, a hauler claimed by two rows). What it cannot prove — the
 * exclusivity rules against fleets *outside* the file — the route checks with
 * `refuseComposition`, the same function the form goes through, so the import
 * can never be the laxer path.
 */

import ExcelJS from "exceljs";
import {
  FLEET_IMPORT_COLUMNS,
  FLEET_MAX_UNITS,
  FLEET_MIN_UNITS,
  type FleetImportChange,
  type FleetImportPreviewRow,
  type ImportErrorRow,
} from "@universe/contracts";

import {
  cellText,
  missingColumnsFailure,
  unknownColumnsFailure,
  type ParseFailure,
} from "./import-columns";

const HEADER_ROW = 1;

export type ImportUnit = { id: string; code: string; typeName: string };

export type ExistingFleet = {
  id: string;
  areaName: string;
  busCode: string | null;
  memberCodes: string[];
};

export type FleetCatalogues = {
  /** Keyed lowercase code. */
  unitsByCode: Map<string, ImportUnit>;
  /** Keyed lowercase name. */
  areasByName: Map<string, { id: string; name: string; type: string }>;
  /** Keyed lowercase digger code. */
  fleetsByDigger: Map<string, ExistingFleet>;
};

/** A row the file itself could not refute, ready for the database checks. */
export type ParsedFleetRow = {
  preview: FleetImportPreviewRow;
  diggerUnitId: string;
  workAreaId: string;
  busUnitId: string | null;
  unitIds: string[];
  /** The fleet this digger already leads, when the row is an update. */
  selfId: string | null;
};

export type FleetParseResult = {
  rows: ParsedFleetRow[];
  errors: ImportErrorRow[];
};

function danger(
  row: number,
  digger: string,
  detail: string,
  issue: string
): ImportErrorRow {
  return {
    row: String(row),
    nik: digger,
    emp: detail,
    issue,
    badgeVariant: "danger",
    badge: "Error",
  };
}

/** The template a caller downloads before filling it in. */
export async function buildTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Fleet");
  ws.columns = FLEET_IMPORT_COLUMNS.map((key) => ({
    header: key,
    key,
    width: key === "units" ? 48 : key === "area" ? 32 : 18,
  }));
  ws.getRow(HEADER_ROW).font = { bold: true };
  // One example row, so the expected shape is obvious without a manual.
  ws.addRow({
    digger: "EX8001",
    area: "Panel East Puncak Utara",
    bus: "BUS3244",
    units: "RD5001, RD5002, RD4001",
  });
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** The member cell: codes separated by comma, semicolon, or newline. */
const splitUnits = (cell: string) =>
  cell
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const joinCodes = (codes: string[]) => [...codes].sort().join(", ");

/**
 * Validate an uploaded workbook against the catalogues and the file itself.
 * Nothing here touches the database — the route layers the cross-fleet
 * exclusivity checks on top of what survives.
 */
export async function validateFleetWorkbook(
  bytes: ArrayBuffer,
  catalogues: FleetCatalogues
): Promise<FleetParseResult | ParseFailure> {
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
    (h) => !(FLEET_IMPORT_COLUMNS as readonly string[]).includes(h)
  );
  if (unknown.length)
    return unknownColumnsFailure(unknown, FLEET_IMPORT_COLUMNS);

  const missing = FLEET_IMPORT_COLUMNS.filter(
    (c) => c !== "bus" && !headers.includes(c)
  );
  if (missing.length)
    return missingColumnsFailure([...missing], FLEET_IMPORT_COLUMNS);

  const index = (name: string) => headers.indexOf(name) + 1;
  const col = {
    digger: index("digger"),
    area: index("area"),
    bus: index("bus"),
    units: index("units"),
  };

  const rows: ParsedFleetRow[] = [];
  const errors: ImportErrorRow[] = [];
  // Every digger and member the file has already spoken for, by unit code —
  // one fleet per digger and one fleet per hauler must hold *inside* the file
  // too, and the refusal names the row that got there first.
  const claimed = new Map<string, number>();

  for (let n = HEADER_ROW + 1; n <= ws.rowCount; n++) {
    const raw = ws.getRow(n);
    const diggerCell = cellText(raw.getCell(col.digger).value);
    const areaCell = cellText(raw.getCell(col.area).value);
    const busCell = col.bus > 0 ? cellText(raw.getCell(col.bus).value) : "";
    const unitsCell = cellText(raw.getCell(col.units).value);

    if (!diggerCell && !areaCell && !busCell && !unitsCell) continue;

    if (!diggerCell) {
      errors.push(danger(n, "—", unitsCell || "—", "Kolom digger kosong"));
      continue;
    }
    if (!areaCell) {
      errors.push(danger(n, diggerCell, "—", "Kolom area kosong"));
      continue;
    }
    if (!unitsCell) {
      errors.push(danger(n, diggerCell, "—", "Kolom units kosong"));
      continue;
    }

    const digger = catalogues.unitsByCode.get(diggerCell.toLowerCase());
    if (!digger) {
      errors.push(
        danger(
          n,
          diggerCell,
          "—",
          `Digger "${diggerCell}" tidak ada di master unit`
        )
      );
      continue;
    }

    const area = catalogues.areasByName.get(areaCell.toLowerCase());
    if (!area) {
      errors.push(
        danger(
          n,
          digger.code,
          areaCell,
          `Area "${areaCell}" tidak ada di master area kerja`
        )
      );
      continue;
    }
    if (area.type !== "Mining") {
      errors.push(
        danger(
          n,
          digger.code,
          area.name,
          "Lokasi fleet harus area kerja bertipe Mining"
        )
      );
      continue;
    }

    let busUnit: ImportUnit | null = null;
    if (busCell) {
      busUnit = catalogues.unitsByCode.get(busCell.toLowerCase()) ?? null;
      if (!busUnit) {
        errors.push(
          danger(
            n,
            digger.code,
            busCell,
            `Bus "${busCell}" tidak ada di master unit`
          )
        );
        continue;
      }
      if (busUnit.typeName !== "BUS") {
        errors.push(
          danger(
            n,
            digger.code,
            busUnit.code,
            `Unit ${busUnit.code} bukan unit berjenis BUS`
          )
        );
        continue;
      }
    }

    // A doubled code in one cell is not two haulers.
    const memberCodes = [
      ...new Map(splitUnits(unitsCell).map((c) => [c.toLowerCase(), c])),
    ].map(([, original]) => original);

    const unknownMembers = memberCodes.filter(
      (c) => !catalogues.unitsByCode.has(c.toLowerCase())
    );
    if (unknownMembers.length) {
      errors.push(
        danger(
          n,
          digger.code,
          unknownMembers.join(", "),
          `Unit ${unknownMembers.join(", ")} tidak ada di master unit`
        )
      );
      continue;
    }

    const members = memberCodes.map((c) =>
      catalogues.unitsByCode.get(c.toLowerCase())!
    );

    if (members.some((m) => m.id === digger.id)) {
      errors.push(
        danger(
          n,
          digger.code,
          digger.code,
          "Digger tidak bisa sekaligus menjadi anggota fleet-nya sendiri"
        )
      );
      continue;
    }
    if (members.length < FLEET_MIN_UNITS) {
      errors.push(
        danger(n, digger.code, "—", "Fleet butuh minimal satu unit anggota")
      );
      continue;
    }
    if (members.length > FLEET_MAX_UNITS) {
      errors.push(
        danger(
          n,
          digger.code,
          String(members.length),
          `Fleet paling banyak memuat ${FLEET_MAX_UNITS} unit anggota`
        )
      );
      continue;
    }

    const conflicts = [digger, ...members]
      .map((u) => ({ unit: u, at: claimed.get(u.code.toLowerCase()) }))
      .filter((c): c is { unit: ImportUnit; at: number } => c.at !== undefined);
    if (conflicts.length) {
      const first = conflicts[0]!;
      errors.push(
        danger(
          n,
          digger.code,
          first.unit.code,
          `Unit ${first.unit.code} sudah dipakai baris ${first.at} file ini`
        )
      );
      continue;
    }
    for (const u of [digger, ...members]) claimed.set(u.code.toLowerCase(), n);

    const existing =
      catalogues.fleetsByDigger.get(digger.code.toLowerCase()) ?? null;
    const changes: FleetImportChange[] = [];
    if (existing) {
      if (existing.areaName.toLowerCase() !== area.name.toLowerCase())
        changes.push({ field: "area", from: existing.areaName, to: area.name });
      if ((existing.busCode ?? "") !== (busUnit?.code ?? ""))
        changes.push({
          field: "bus",
          from: existing.busCode,
          to: busUnit?.code ?? null,
        });
      const fromUnits = joinCodes(existing.memberCodes);
      const toUnits = joinCodes(members.map((m) => m.code));
      if (fromUnits.toLowerCase() !== toUnits.toLowerCase())
        changes.push({ field: "units", from: fromUnits, to: toUnits });
    }

    rows.push({
      preview: {
        row: n,
        kind: existing ? "updated" : "new",
        digger: digger.code,
        area: area.name,
        bus: busUnit?.code ?? null,
        units: members.map((m) => m.code),
        changes,
      },
      diggerUnitId: digger.id,
      workAreaId: area.id,
      busUnitId: busUnit?.id ?? null,
      unitIds: members.map((m) => m.id),
      selfId: existing?.id ?? null,
    });
  }

  return { rows, errors };
}
