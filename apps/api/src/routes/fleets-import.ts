/**
 * Bulk fleet setting by spreadsheet — **one row per unit**.
 *
 * The file is the whole yard for one day: every machine, where it works, what
 * formation it belongs to, and which vehicle brings its crew. Roles are read
 * from the `fleet` cell alone — filled means "hauls for that formation", blank
 * means "leads a formation" when some other row named it, and blank-and-unnamed
 * means a support unit that is crewed without belonging to one.
 *
 * This module parses and checks what a file can prove about itself: the
 * columns, the codes it names, and its own internal consistency — a unit listed
 * twice, a leader that is also somebody's hauler, a formation whose members
 * disagree about where they are working. What it cannot prove — exclusivity
 * against formations *outside* the file — the route checks with
 * `refuseComposition`, the same function the form goes through, so the import
 * can never be the laxer path.
 */

import ExcelJS from "exceljs";
import {
  FLEET_IMPORT_COLUMNS,
  FLEET_MAX_UNITS,
  FLEET_MIN_UNITS,
  FLEET_TRANSPORT_TYPES_TEXT,
  isBreakdownArea,
  isFleetTransportType,
  type FleetImportChange,
  type FleetImportColumn,
  type FleetImportPreviewRow,
  type FleetImportSupportRow,
  type ImportErrorRow,
} from "@universe/contracts";

import {
  cellText,
  missingColumnsFailure,
  unknownColumnsFailure,
  type ParseFailure,
} from "./import-columns";

const HEADER_ROW = 1;

/**
 * What the yard's own file calls the columns.
 *
 * The transport column is headed "NO BUS" there — "nomor bus" — and refusing a
 * file over the word the people who maintain it already use would be asking
 * them to retype the header on every upload.
 */
const HEADER_ALIASES: Record<string, FleetImportColumn | undefined> = {
  "no bus": "bus",
  "no. bus": "bus",
  nobus: "bus",
  unit: "unit",
  area: "area",
  fleet: "fleet",
  bus: "bus",
};

export type ImportUnit = { id: string; code: string; typeName: string };

export type ExistingFleet = {
  id: string;
  leaderUnitId: string;
  area: string;
  memberCodes: string[];
  /** Distinct transport codes across the formation, for the change summary. */
  transportCodes: string[];
};

export type FleetCatalogues = {
  /** Keyed lowercase code. */
  unitsByCode: Map<string, ImportUnit>;
  /** Keyed lowercase leader code. */
  fleetsByLeader: Map<string, ExistingFleet>;
  /**
   * Every unit currently in today's operation, by lowercase code — a formation
   * member, a leader, or a support unit. What the file does not name again is
   * released, and the preview says so before the commit does it.
   */
  inOperation: Map<string, string>;
};

/** One formation the file describes, ready for the database checks. */
export type ParsedFleetRow = {
  preview: FleetImportPreviewRow;
  leaderUnitId: string;
  workArea: string;
  unitIds: string[];
  /** unit id → the vehicle it rides, for every unit in this formation. */
  transports: Record<string, string | null>;
  /** The fleet this leader already leads, when the row is an update. */
  selfId: string | null;
};

/** One crewed unit outside every formation. */
export type ParsedSupportUnit = {
  preview: FleetImportSupportRow;
  unitId: string;
  workArea: string | null;
  transportUnitId: string | null;
  breakdown: boolean;
};

export type FleetParseResult = {
  rows: ParsedFleetRow[];
  support: ParsedSupportUnit[];
  /** Leader codes of formations the file never mentions. */
  disband: { id: string; leaderCode: string }[];
  /** Codes of units in operation the file no longer names. */
  released: string[];
  errors: ImportErrorRow[];
};

function danger(
  row: number,
  unit: string,
  detail: string,
  issue: string
): ImportErrorRow {
  return {
    row: String(row),
    nik: unit,
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
    width: key === "area" ? 32 : 18,
  }));
  ws.getRow(HEADER_ROW).font = { bold: true };
  /* Four example rows rather than one, because the shape of this file is the
     part that needs explaining: a leader leaves `fleet` blank, its haulers
     name it, a support unit leaves it blank and nobody names it, and a broken
     unit says so where its area would go. */
  ws.addRows([
    { unit: "EX8001", area: "KASTURI TENGAH UTARA", fleet: "", bus: "UD-BU09" },
    {
      unit: "RD5024",
      area: "KASTURI TENGAH UTARA",
      fleet: "EX8001",
      bus: "UD-BU09",
    },
    { unit: "DZ6002", area: "DISPOSAL T4", fleet: "", bus: "UD-BU08" },
    { unit: "EX7005", area: "BREAKDOWN", fleet: "", bus: "" },
  ]);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/**
 * Vehicle codes are matched with spaces and dashes removed.
 *
 * The file writes the same bus as "UDBU 09", "UDBU09" and "UD-BU09" — three
 * spellings of one vehicle, from three people typing. Master holds `UD-BU09`.
 * Refusing the other two would be reading the punctuation instead of the code;
 * a genuinely unknown vehicle is still refused, by name and by row.
 */
const transportKey = (code: string) =>
  code.replace(/[\s-]+/g, "").toLowerCase();

const joinCodes = (codes: string[]) => [...codes].sort().join(", ");

type RawRow = {
  n: number;
  unit: string;
  area: string;
  fleet: string;
  bus: string;
};

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
    .map((v): string => {
      const raw = cellText(v).toLowerCase();
      return HEADER_ALIASES[raw] ?? raw;
    })
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
    unit: index("unit"),
    area: index("area"),
    fleet: index("fleet"),
    bus: index("bus"),
  };

  const errors: ImportErrorRow[] = [];

  /* ---- pass 1: read the sheet, and refuse a unit that appears twice ------ */

  const raw: RawRow[] = [];
  const seen = new Map<string, number>();
  for (let n = HEADER_ROW + 1; n <= ws.rowCount; n++) {
    const r = ws.getRow(n);
    const row: RawRow = {
      n,
      unit: cellText(r.getCell(col.unit).value),
      area: cellText(r.getCell(col.area).value),
      fleet: cellText(r.getCell(col.fleet).value),
      bus: col.bus > 0 ? cellText(r.getCell(col.bus).value) : "",
    };
    if (!row.unit && !row.area && !row.fleet && !row.bus) continue;
    if (!row.unit) {
      errors.push(danger(n, "—", row.area || "—", "Kolom unit kosong"));
      continue;
    }
    const key = row.unit.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) {
      /* One unit, one row. The file carries DT4601–DT4606 twice, once under
         their own formation and once under EX5004, and either reading changes
         who works where — so neither is guessed at. */
      errors.push(
        danger(
          n,
          row.unit,
          row.fleet || "—",
          `Unit ini sudah ada di baris ${first} — satu unit hanya boleh muncul sekali`
        )
      );
      continue;
    }
    seen.set(key, n);
    raw.push(row);
  }

  /* ---- pass 2: resolve every code, and settle each row's role ------------ */

  const referenced = new Set(
    raw.map((r) => r.fleet.toLowerCase()).filter((f) => f.length > 0)
  );

  /** Vehicles by their punctuation-free key, so three spellings find one unit. */
  const transportByKey = new Map<string, ImportUnit>();
  for (const unit of catalogues.unitsByCode.values())
    if (isFleetTransportType(unit.typeName))
      transportByKey.set(transportKey(unit.code), unit);

  type Resolved = RawRow & {
    unitRow: ImportUnit;
    transportId: string | null;
    transportCode: string | null;
    breakdown: boolean;
    /**
     * This row already has an error of its own.
     *
     * It stays in the list anyway, so the formation it belongs to can still be
     * *recognised* — dropping it made one mistyped vehicle code report itself
     * three times over: once as the bad code, once as a formation with no
     * leader row, and once as a formation with no members.
     */
    bad: boolean;
  };
  const resolved: Resolved[] = [];

  for (const row of raw) {
    const unitRow = catalogues.unitsByCode.get(row.unit.toLowerCase());
    if (!unitRow) {
      errors.push(
        danger(row.n, row.unit, "—", `Unit "${row.unit}" tidak ada di master`)
      );
      continue;
    }

    const breakdown = isBreakdownArea(row.area);
    if (!row.area) {
      errors.push(danger(row.n, row.unit, "—", "Kolom area kosong"));
      continue;
    }
    if (breakdown && row.fleet) {
      /* A broken machine is not hauling for anyone. Saying both is a mistake
         worth naming rather than resolving in one direction. */
      errors.push(
        danger(
          row.n,
          row.unit,
          row.fleet,
          "Unit breakdown tidak bisa sekaligus menjadi anggota fleet"
        )
      );
      continue;
    }

    let transportId: string | null = null;
    let transportCode: string | null = null;
    let bad = false;
    if (row.bus) {
      const vehicle = transportByKey.get(transportKey(row.bus));
      if (!vehicle) {
        const known = catalogues.unitsByCode.get(row.bus.toLowerCase());
        errors.push(
          danger(
            row.n,
            row.unit,
            row.bus,
            known
              ? `Unit ${known.code} bukan ${FLEET_TRANSPORT_TYPES_TEXT}`
              : `Transport "${row.bus}" tidak ada di master`
          )
        );
        bad = true;
      } else {
        transportId = vehicle.id;
        transportCode = vehicle.code;
      }
    }

    resolved.push({
      ...row,
      unitRow,
      transportId,
      transportCode,
      breakdown,
      bad,
    });
  }

  const byCode = new Map(resolved.map((r) => [r.unit.toLowerCase(), r]));

  /* ---- pass 3: gather the formations ------------------------------------ */

  type Group = { leader: Resolved; members: Resolved[] };
  const groups = new Map<string, Group>();

  for (const key of referenced) {
    const leader = byCode.get(key);
    if (!leader) {
      /* Named as a formation but with no row of its own. The file cannot say
         where that formation works or what its leader rides, and inventing
         either would put a machine somewhere nobody wrote down. */
      const row = resolved.find((r) => r.fleet.toLowerCase() === key);
      errors.push(
        danger(
          row?.n ?? HEADER_ROW,
          row?.fleet ?? key,
          "—",
          `Fleet "${row?.fleet ?? key}" tidak punya barisnya sendiri di file ini`
        )
      );
      continue;
    }
    if (leader.fleet) {
      /* Leading one formation and hauling for another at once. Both are in the
         file, so neither can be treated as the stale one. */
      errors.push(
        danger(
          leader.n,
          leader.unit,
          leader.fleet,
          `Unit ini memimpin sebuah fleet dan sekaligus terdaftar sebagai anggota fleet ${leader.fleet}`
        )
      );
      continue;
    }
    groups.set(key, { leader, members: [] });
  }

  for (const row of resolved) {
    if (!row.fleet) continue;
    const group = groups.get(row.fleet.toLowerCase());
    // Its leader was already refused above; the member's own row says nothing
    // new, so it is dropped rather than reported a second time.
    if (group) group.members.push(row);
  }

  /* ---- pass 4: build the preview ---------------------------------------- */

  const rows: ParsedFleetRow[] = [];
  const claimedLeaders = new Set<string>();

  for (const [key, group] of groups) {
    const { leader, members } = group;

    /* Somebody in it already has an error naming the row and the cell. Saying
       anything further about the formation would be describing the damage
       rather than the mistake. */
    if (leader.bad || members.some((m) => m.bad)) continue;

    if (members.length < FLEET_MIN_UNITS) {
      errors.push(
        danger(leader.n, leader.unit, "—", "Fleet butuh minimal satu anggota")
      );
      continue;
    }
    if (members.length > FLEET_MAX_UNITS) {
      errors.push(
        danger(
          leader.n,
          leader.unit,
          String(members.length),
          `Fleet ini punya ${members.length} anggota, batasnya ${FLEET_MAX_UNITS}`
        )
      );
      continue;
    }

    /* One formation cannot span two areas (owner). Enforced here rather than
       stored on the fleet, because the area is a fact about each unit. */
    const areas = [...new Set([leader, ...members].map((r) => r.area))];
    if (areas.length > 1) {
      const odd = members.find((m) => m.area !== leader.area)!;
      errors.push(
        danger(
          odd.n,
          odd.unit,
          odd.area,
          `Area berbeda dari fleet ${leader.unit} ("${leader.area}") — satu fleet tidak bisa berada di dua area`
        )
      );
      continue;
    }
    const broken = [leader, ...members].find((r) => r.breakdown);
    if (broken) {
      errors.push(
        danger(
          broken.n,
          broken.unit,
          "BREAKDOWN",
          "Unit breakdown tidak bisa berada di dalam fleet"
        )
      );
      continue;
    }

    const existing = catalogues.fleetsByLeader.get(key);
    const memberCodes = members.map((m) => m.unit);
    const transportCodes = [
      ...new Set(
        [leader, ...members]
          .map((r) => r.transportCode)
          .filter((c): c is string => c !== null)
      ),
    ].sort();

    const changes: FleetImportChange[] = [];
    if (existing) {
      if (existing.area !== leader.area)
        changes.push({ field: "area", from: existing.area, to: leader.area });
      if (joinCodes(existing.memberCodes) !== joinCodes(memberCodes))
        changes.push({
          field: "units",
          from: joinCodes(existing.memberCodes),
          to: joinCodes(memberCodes),
        });
      if (joinCodes(existing.transportCodes) !== joinCodes(transportCodes))
        changes.push({
          field: "transport",
          from: joinCodes(existing.transportCodes) || null,
          to: joinCodes(transportCodes) || null,
        });
    }

    claimedLeaders.add(key);
    rows.push({
      preview: {
        row: leader.n,
        kind: !existing ? "new" : changes.length ? "updated" : "unchanged",
        leader: leader.unit,
        area: leader.area,
        units: memberCodes,
        transports: transportCodes,
        changes,
      },
      leaderUnitId: leader.unitRow.id,
      workArea: leader.area,
      unitIds: members.map((m) => m.unitRow.id),
      transports: Object.fromEntries(
        [leader, ...members].map((r) => [r.unitRow.id, r.transportId])
      ),
      selfId: existing?.id ?? null,
    });
  }

  /* ---- pass 5: the support units ---------------------------------------- */

  const support: ParsedSupportUnit[] = [];
  for (const row of resolved) {
    if (row.fleet || row.bad) continue;
    if (referenced.has(row.unit.toLowerCase())) continue; // a leader
    support.push({
      preview: {
        row: row.n,
        unit: row.unit,
        // "BREAKDOWN" is a status, not a place, so it is not kept as one.
        area: row.breakdown ? null : row.area,
        transport: row.transportCode,
        breakdown: row.breakdown,
      },
      unitId: row.unitRow.id,
      workArea: row.breakdown ? null : row.area,
      transportUnitId: row.breakdown ? null : row.transportId,
      breakdown: row.breakdown,
    });
  }

  /* ---- pass 6: what the file leaves out --------------------------------- */

  const disband = [...catalogues.fleetsByLeader.entries()]
    .filter(([key]) => !claimedLeaders.has(key))
    .map(([key, fleet]) => ({
      id: fleet.id,
      leaderCode: catalogues.unitsByCode.get(key)?.code ?? key,
    }));

  const named = new Set(resolved.map((r) => r.unit.toLowerCase()));
  const released = [...catalogues.inOperation.entries()]
    .filter(([key]) => !named.has(key))
    .map(([, code]) => code)
    .sort();

  errors.sort((a, b) => Number(a.row) - Number(b.row));
  return { rows, support, disband, released, errors };
}
