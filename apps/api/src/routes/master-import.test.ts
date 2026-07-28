/**
 * The import parser's contract, and the atomicity the commit depends on.
 *
 * Needs the dev Postgres, the same as `db:seed`:
 *   bun --env-file=.env test src/routes/master-import.test.ts
 */

import { describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { eq, inArray, sql } from "drizzle-orm";

import { db, schema } from "../db";
import {
  catalogueTarget,
  catalogueWorkbook,
  employeeTarget,
  employeeWorkbook,
  nearestName,
  readWorkbook,
  similarity,
  skillText,
  unitTarget,
  validateWorkbook,
  type CatalogueExisting,
  type Catalogues,
  type EmployeeCatalogues,
  type EmployeeExisting,
  type UnitExisting,
} from "./master-import";

/* ----------------------------------------------------------------- helpers */

async function sheet(
  headers: string[],
  rows: (string | number | boolean)[][]
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("s");
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  const loaded = await readWorkbook(await wb.xlsx.writeBuffer());
  if ("code" in loaded) throw new Error(loaded.message);
  return loaded;
}

const catalogue = (rows: CatalogueExisting[]) =>
  new Map(rows.map((r) => [r.name.toLowerCase(), r]));

/* -------------------------------------------------------------- near match */

describe("near-match detection", () => {
  test("scores by proportion of the longer name, not by absolute distance", () => {
    // One wrong character out of nine is a typo; one out of three is a
    // different word. An absolute threshold cannot tell those apart.
    expect(similarity("bigdiger", "bigdigger")).toBeCloseTo(8 / 9, 5);
    expect(similarity("exc", "exo")).toBeCloseTo(2 / 3, 5);
    expect(similarity("", "")).toBe(1);
  });

  test("flags a misspelling of an existing entry", () => {
    expect(nearestName("excavtor", ["EXCAVATOR", "DUMPTRUCK"])).toBe(
      "EXCAVATOR"
    );
  });

  test("a difference of case alone is a match, not a near match", () => {
    // Nothing should reach this function in that state — it resolves earlier —
    // but reporting "excavator looks like EXCAVATOR" would be nonsense.
    expect(nearestName("excavator", ["EXCAVATOR"])).toBeNull();
  });

  test("an unrelated name is left alone", () => {
    expect(nearestName("BULLDOZER", ["EXCAVATOR", "DUMPTRUCK"])).toBeNull();
  });

  test("returns the closest of several candidates", () => {
    expect(
      nearestName("EXCAVTOR", ["DUMPTRUCK", "EXCAVATION", "EXCAVATOR"])
    ).toBe("EXCAVATOR");
  });

  test("an exact tie keeps the first candidate", () => {
    // `DT R13` is one character from both. Which one gets named does not
    // matter — the message asks "did you mean something that exists", and
    // either answer sends the operator to the same place.
    expect(nearestName("DT R13", ["DT R10", "DT R12"])).toBe("DT R10");
  });

  test("short real codes do trip it — which is why it only ever warns", () => {
    // `DT R10` and `DT R12` are both real and differ by one character. No
    // threshold that catches `excavtor` can spare them, so this is documented
    // as accepted behaviour rather than papered over: it annotates, never
    // blocks, and the operator decides.
    expect(nearestName("DT R14", ["DT R10", "DT R12"])).not.toBeNull();
  });
});

/* -------------------------------------------------------------- catalogues */

describe("catalogue import", () => {
  const existing = catalogue([
    {
      id: "c1",
      name: "BIGDIGGER",
      description: "Excavator besar",
      active: true,
    },
    {
      id: "c2",
      name: "DUMPTRUCK30T",
      description: "Dump truck 30T",
      active: true,
    },
  ]);

  test("a blank description keeps the stored one instead of wiping it", async () => {
    // The column left out entirely, which is what an operator does when they
    // only mean to flip a status. It used to clear every description it saw.
    const wb = await sheet(["nama", "aktif"], [["BIGDIGGER", "FALSE"]]);
    const result = validateWorkbook(
      "k.xlsx",
      catalogueTarget("kelas-unit", "description", existing),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.errorCount).toBe(0);
    expect(result.preview.rows[0]!.changes).toEqual([
      { field: "aktif", from: "TRUE", to: "FALSE" },
    ]);
  });

  test("a new name close to an existing one is flagged, not refused", async () => {
    const wb = await sheet(
      ["nama", "deskripsi", "aktif"],
      [["BIGDIGER", "Excavator besar", "TRUE"]]
    );
    const result = validateWorkbook(
      "k.xlsx",
      catalogueTarget("kelas-unit", "description", existing),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.newCount).toBe(1);
    expect(result.preview.errorCount).toBe(0);
    expect(result.preview.warnings).toHaveLength(1);
    expect(result.preview.warnings[0]!.issue).toContain("BIGDIGGER");
    expect(result.preview.warnings[0]!.badgeVariant).toBe("warning");
  });

  test("the data column carries the row as typed", async () => {
    const wb = await sheet(
      ["nama", "deskripsi", "aktif"],
      [["BIGDIGGER", "Excavator besar", "TRUE"]]
    );
    const result = validateWorkbook(
      "k.xlsx",
      catalogueTarget("kelas-unit", "description", existing),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.rows[0]!.data).toBe(
      "BIGDIGGER - Excavator besar - TRUE"
    );
  });

  test("an unchanged file reports nothing new and nothing changed", async () => {
    const wb = await sheet(
      ["nama", "deskripsi", "aktif"],
      [
        ["BIGDIGGER", "Excavator besar", "TRUE"],
        ["DUMPTRUCK30T", "Dump truck 30T", "TRUE"],
      ]
    );
    const result = validateWorkbook(
      "k.xlsx",
      catalogueTarget("kelas-unit", "description", existing),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.newCount).toBe(0);
    expect(result.preview.updatedCount).toBe(0);
    expect(result.preview.unchangedCount).toBe(2);
    expect(result.preview.errorCount).toBe(0);
  });

  /**
   * The counts being zero must not mean the preview is blank: an operator who
   * re-uploads an export needs to see that their rows were read, or a file that
   * parsed perfectly is indistinguishable from one that was ignored.
   */
  test("unchanged rows are still listed, marked unchanged", async () => {
    const wb = await sheet(
      ["nama", "deskripsi", "aktif"],
      [
        ["BIGDIGGER", "Excavator besar", "TRUE"],
        ["DUMPTRUCK30T", "Dump truck 30T", "TRUE"],
      ]
    );
    const result = validateWorkbook(
      "k.xlsx",
      catalogueTarget("kelas-unit", "description", existing),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.rows.length).toBe(2);
    expect(result.preview.rows.map((r) => r.kind)).toEqual([
      "unchanged",
      "unchanged",
    ]);
    expect(result.preview.rows.map((r) => r.row)).toEqual([2, 3]);
    expect(result.preview.rows.every((r) => r.changes.length === 0)).toBe(true);
  });

  test("new, changed, and unchanged rows appear together in file order", async () => {
    const wb = await sheet(
      ["nama", "deskripsi", "aktif"],
      [
        ["BIGDIGGER", "Excavator besar", "TRUE"], // unchanged
        ["SMALLDIGGER", "Excavator kecil", "TRUE"], // new
        ["DUMPTRUCK30T", "Dump truck 35T", "TRUE"], // changed
      ]
    );
    const result = validateWorkbook(
      "k.xlsx",
      catalogueTarget("kelas-unit", "description", existing),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.rows.map((r) => [r.row, r.kind])).toEqual([
      [2, "unchanged"],
      [3, "new"],
      [4, "updated"],
    ]);
    expect(result.preview.newCount).toBe(1);
    expect(result.preview.updatedCount).toBe(1);
    expect(result.preview.unchangedCount).toBe(1);
  });

  test("an export round-trips through its own import", async () => {
    const rows = [...existing.values()];
    const buffer = await catalogueWorkbook("kelas-unit", "description", rows);
    const wb = await readWorkbook(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      ) as ArrayBuffer
    );
    if ("code" in wb) throw new Error(wb.message);
    const result = validateWorkbook(
      "k.xlsx",
      catalogueTarget("kelas-unit", "description", existing),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.newCount).toBe(0);
    expect(result.preview.updatedCount).toBe(0);
    expect(result.preview.errorCount).toBe(0);
  });

  test("names the fields an update would change", async () => {
    const wb = await sheet(
      ["nama", "deskripsi", "aktif"],
      [["BIGDIGGER", "Excavator raksasa", "FALSE"]]
    );
    const result = validateWorkbook(
      "k.xlsx",
      catalogueTarget("kelas-unit", "description", existing),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.updatedCount).toBe(1);
    expect(result.preview.rows[0]!.changes).toEqual([
      { field: "deskripsi", from: "Excavator besar", to: "Excavator raksasa" },
      { field: "aktif", from: "TRUE", to: "FALSE" },
    ]);
  });

  test("a row named twice in one file is refused with the row that claimed it", async () => {
    const wb = await sheet(
      ["nama", "deskripsi", "aktif"],
      [
        ["ALPHA", "satu", "TRUE"],
        ["alpha", "dua", "TRUE"],
      ]
    );
    const result = validateWorkbook(
      "k.xlsx",
      catalogueTarget("kelas-unit", "description", existing),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.errorCount).toBe(1);
    expect(result.preview.errors[0]!.row).toBe("3");
    expect(result.preview.errors[0]!.issue).toContain("baris 2");
  });

  test("an unknown column is refused rather than ignored", async () => {
    const wb = await sheet(["nama", "warna"], [["ALPHA", "merah"]]);
    const result = validateWorkbook(
      "k.xlsx",
      catalogueTarget("kelas-unit", "description", existing),
      wb
    );
    expect("code" in result && result.code).toBe("unknown_columns");
  });

  test("a work-area type outside the vocabulary fails its row", async () => {
    const areas = catalogue([
      { id: "a1", name: "Workshop", type: "Non Mining", active: true },
    ]);
    const wb = await sheet(
      ["nama", "tipe", "aktif"],
      [["Quarry Baru", "Quarry", "TRUE"]]
    );
    const result = validateWorkbook(
      "a.xlsx",
      catalogueTarget("area-kerja", "type", areas),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.errorCount).toBe(1);
    expect(result.preview.errors[0]!.issue).toContain("Mining");
  });
});

/* -------------------------------------------------------------------- units */

describe("unit import", () => {
  const named = (id: string, name: string) => [
    name.toLowerCase(),
    { id, name },
  ];
  const catalogues: Catalogues = {
    classes: new Map([named("c1", "BIGDIGGER")] as [
      string,
      { id: string; name: string },
    ][]),
    types: new Map([named("t1", "EXCAVATOR")] as [
      string,
      { id: string; name: string },
    ][]),
    models: new Map([named("m1", "EX2600-7BH")] as [
      string,
      { id: string; name: string },
    ][]),
    brands: new Map([named("b1", "HITACHI")] as [
      string,
      { id: string; name: string },
    ][]),
    simperCodes: new Map([named("s1", "EXC 2600")] as [
      string,
      { id: string; name: string },
    ][]),
    departments: new Map([named("d1", "Mining Operation")] as [
      string,
      { id: string; name: string },
    ][]),
  };

  const HEADERS = [
    "kode",
    "kelas",
    "jenis",
    "model",
    "merk",
    "kode_simper",
    "departemen",
  ];
  const empty = new Map<string, UnitExisting>();

  /** Stands in for the caller's `manage` grants on the master menus. */
  const mayCreate = () => true;
  const mayNotCreate = () => false;

  test("resolves catalogue values ignoring case and surrounding whitespace", async () => {
    const wb = await sheet(HEADERS, [
      [
        "ex8001",
        "  bigdigger ",
        "excavator",
        "ex2600-7bh",
        "hitachi",
        "exc 2600",
        "MINING OPERATION",
      ],
    ]);
    const result = validateWorkbook(
      "u.xlsx",
      unitTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.errorCount).toBe(0);
    expect(result.preview.newCount).toBe(1);
    // A match is a match: differing case must not be mistaken for a new value
    // and offered up as a catalogue addition.
    expect(result.preview.newMasters).toEqual([]);
    expect(result.preview.warnings).toEqual([]);
    expect(result.accepted[0]!.parsed.classId).toBe("c1");
    expect(result.accepted[0]!.parsed.departmentId).toBe("d1");
    // The code is normalised; the catalogue names come back as stored.
    expect(result.accepted[0]!.parsed.code).toBe("EX8001");
    expect(result.accepted[0]!.parsed.className).toBe("BIGDIGGER");
  });

  const unknownClassRows = [
    [
      "EX8001",
      "BIGDIGGER",
      "EXCAVATOR",
      "EX2600-7BH",
      "HITACHI",
      "EXC 2600",
      "Mining Operation",
    ],
    [
      "EX8002",
      "BIGDIGER", // not in the catalogue
      "EXCAVATOR",
      "EX2600-7BH",
      "HITACHI",
      "EXC 2600",
      "Mining Operation",
    ],
  ];

  test("an unknown catalogue value is offered rather than refused", async () => {
    const wb = await sheet(HEADERS, unknownClassRows);
    const result = validateWorkbook(
      "u.xlsx",
      unitTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);

    // Both rows import; the second only because a class will be created first.
    expect(result.preview.newCount).toBe(2);
    expect(result.preview.errorCount).toBe(0);
    // Offered, and flagged: one letter from an existing class is what a typo
    // looks like, and the operator is the only one who can settle it.
    expect(result.preview.newMasters).toEqual([
      {
        kind: "kelas-unit",
        name: "BIGDIGER",
        rows: 1,
        similarTo: "BIGDIGGER",
      },
    ]);
    // Named by row number, exactly as an error would be, at lower severity.
    expect(result.preview.warnings).toHaveLength(1);
    expect(result.preview.warnings[0]!.row).toBe("3");
    expect(result.preview.warnings[0]!.nik).toBe("EX8002");
    expect(result.preview.warnings[0]!.badgeVariant).toBe("warning");
    // The reference is carried by name until a commit can supply an id — the
    // parser itself still writes nothing into the catalogue it was handed.
    const pendingRow = result.accepted.find((a) => a.key === "EX8002")!;
    expect(pendingRow.parsed.classId).toBeNull();
    expect(pendingRow.parsed.className).toBe("BIGDIGER");
    expect(catalogues.classes.has("bigdiger")).toBe(false);
  });

  test("without manage on that master, the same value still fails its row", async () => {
    const wb = await sheet(HEADERS, unknownClassRows);
    const result = validateWorkbook(
      "u.xlsx",
      unitTarget(empty, catalogues, mayNotCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);

    expect(result.preview.newCount).toBe(1);
    expect(result.preview.errorCount).toBe(1);
    expect(result.preview.errors[0]!.row).toBe("3");
    expect(result.preview.errors[0]!.issue).toContain("BIGDIGER");
    expect(result.preview.newMasters).toEqual([]);
    expect(result.accepted.some((a) => a.key === "EX8002")).toBe(false);
  });

  test("one addition however many rows name it, counted and cased by the first", async () => {
    const row = (code: string, jenis: string) => [
      code,
      "BIGDIGGER",
      jenis,
      "EX2600-7BH",
      "HITACHI",
      "EXC 2600",
      "Mining Operation",
    ];
    const wb = await sheet(HEADERS, [
      row("EX8001", "DUMTRUCK"),
      row("EX8002", "dumtruck"),
      row("EX8003", "DumTruck"),
    ]);
    const result = validateWorkbook(
      "u.xlsx",
      unitTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);

    // Three warnings — one per row, since each row is where a reader looks —
    // but one catalogue entry, spelled as the first row spelled it.
    expect(result.preview.warnings).toHaveLength(3);
    expect(result.preview.newMasters).toEqual([
      { kind: "jenis-unit", name: "DUMTRUCK", rows: 3 },
    ]);
  });

  test("a genuinely new name carries no near-match flag", async () => {
    const wb = await sheet(HEADERS, [
      [
        "EX8001",
        "BIGDIGGER",
        "BULLDOZER", // nothing in the catalogue is close to this
        "EX2600-7BH",
        "HITACHI",
        "EXC 2600",
        "Mining Operation",
      ],
    ]);
    const result = validateWorkbook(
      "u.xlsx",
      unitTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.newMasters).toEqual([
      { kind: "jenis-unit", name: "BULLDOZER", rows: 1 },
    ]);
    expect(result.preview.warnings[0]!.issue).toContain("belum ada di master");
  });

  test("two columns naming the same string are two additions", async () => {
    const wb = await sheet(HEADERS, [
      [
        "EX8001",
        "BIGDIGGER",
        "SANY", // not a type
        "EX2600-7BH",
        "SANY", // not a brand either — same string, different catalogue
        "EXC 2600",
        "Mining Operation",
      ],
    ]);
    const result = validateWorkbook(
      "u.xlsx",
      unitTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.newMasters).toEqual([
      { kind: "jenis-unit", name: "SANY", rows: 1 },
      { kind: "merk-unit", name: "SANY", rows: 1 },
    ]);
  });

  test("a blank departemen is a company-wide asset, not a failed row", async () => {
    const wb = await sheet(HEADERS, [
      [
        "EX8001",
        "BIGDIGGER",
        "EXCAVATOR",
        "EX2600-7BH",
        "HITACHI",
        "EXC 2600",
        "", // no owning department
      ],
    ]);
    const result = validateWorkbook(
      "u.xlsx",
      unitTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.errorCount).toBe(0);
    expect(result.preview.newCount).toBe(1);
    // Null id *and* null name: nothing pending, nothing to create — the column
    // is simply empty, the way `kode_simper` already could be.
    expect(result.accepted[0]!.parsed.departmentId).toBeNull();
    expect(result.accepted[0]!.parsed.departmentName).toBeNull();
    expect(result.preview.newMasters).toEqual([]);
  });

  test("a missing required reference on a new row fails it", async () => {
    const wb = await sheet(["kode", "kelas"], [["EX9001", "BIGDIGGER"]]);
    const result = validateWorkbook(
      "u.xlsx",
      unitTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    // A blank column is not an unknown value: there is nothing to create, and
    // creating it is not what an operator who left it blank asked for.
    expect(result.preview.errorCount).toBe(1);
    expect(result.preview.errors[0]!.issue).toContain("wajib diisi");
    expect(result.preview.newMasters).toEqual([]);
  });
});

/* ---------------------------------------------------------------- employees */

describe("employee import", () => {
  const named = (
    id: string,
    name: string
  ): [string, { id: string; name: string }] => [
    name.toLowerCase(),
    { id, name },
  ];
  const catalogues: EmployeeCatalogues = {
    companies: new Map([named("k1", "PT Unggul Dinamika Utama")]),
    positions: new Map([named("j1", "Driver OHT")]),
    departments: new Map([named("d1", "Mining Operation")]),
    messes: new Map([named("m1", "Mess A")]),
    simperTypes: new Map([named("t1", "F")]),
    simperCodes: new Map([named("s1", "OHT 777"), named("s2", "OHT 773")]),
  };

  const HEADERS = [
    "nik",
    "nama",
    "perusahaan",
    "jabatan",
    "departemen",
    "kode_simper",
  ];
  const row = (
    nik: string,
    nama: string,
    jabatan = "Driver OHT",
    kode = "OHT 777"
  ) => [
    nik,
    nama,
    "PT Unggul Dinamika Utama",
    jabatan,
    "Mining Operation",
    kode,
  ];

  const empty = new Map<string, EmployeeExisting>();

  /** Stands in for the caller's `manage` grants on the master menus. */
  const mayCreate = () => true;
  const mayNotCreate = () => false;

  const budi: EmployeeExisting = {
    id: "e1",
    nik: "503220421",
    name: "Budi Santoso",
    companyName: "PT Unggul Dinamika Utama",
    positionName: "Driver OHT",
    departmentName: "Mining Operation",
    messName: "Mess A",
    simperTypeName: "F",
    joinDate: "2022-03-01",
    status: "aktif",
    simperNo: "F-2022-0421",
    simperExp: "2027-03-14",
    skills: ["OHT 777", "OHT 773"],
    license: "SIM BII Umum",
    mcu: "Fit",
    mcuExp: "2027-01-15",
    blood: "O",
    medical: "",
    block: "Blok 1",
    room: "A-12",
    phone: "0812-3456-7890",
    emergency: "Siti Santoso (istri)",
  };

  /** An employee who operates nothing — no permit, no codes, no mess. */
  const sari: EmployeeExisting = {
    ...budi,
    id: "e2",
    nik: "505200233",
    name: "Sari Lestari",
    messName: null,
    simperTypeName: null,
    simperNo: "",
    simperExp: null,
    skills: [],
    license: "",
    block: "",
    room: "",
    phone: "",
    emergency: "",
  };

  test("an export round-trips through its own import, unchanged", async () => {
    const buffer = await employeeWorkbook([budi, sari]);
    const wb = await readWorkbook(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      ) as ArrayBuffer
    );
    if ("code" in wb) throw new Error(wb.message);
    const existing = new Map([
      [budi.nik.toLowerCase(), budi],
      [sari.nik.toLowerCase(), sari],
    ]);
    const result = validateWorkbook(
      "k.xlsx",
      employeeTarget(existing, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    // The whole point of one column list serving both directions: an untouched
    // export reads back as "nothing to do", not as "everything changed".
    expect(result.preview.newCount).toBe(0);
    expect(result.preview.updatedCount).toBe(0);
    expect(result.preview.unchangedCount).toBe(2);
    expect(result.preview.errorCount).toBe(0);
    expect(result.preview.newMasters).toEqual([]);
  });

  test("several codes in one cell become several skills", async () => {
    const wb = await sheet(HEADERS, [
      row("601", "Operator Baru", "Driver OHT", "OHT 777; OHT 773"),
    ]);
    const result = validateWorkbook(
      "k.xlsx",
      employeeTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.errorCount).toBe(0);
    expect(result.accepted[0]!.parsed.skillIds.sort()).toEqual(["s1", "s2"]);
  });

  test("codes are matched ignoring case and surrounding whitespace", async () => {
    const wb = await sheet(HEADERS, [
      row("602", "Operator Dua", "Driver OHT", "  oht 777 ;oht 773"),
    ]);
    const result = validateWorkbook(
      "k.xlsx",
      employeeTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.errorCount).toBe(0);
    // Stored as the catalogue spells them, not as the sheet did.
    expect(result.accepted[0]!.parsed.skillNames).toEqual([
      "OHT 773",
      "OHT 777",
    ]);
  });

  test("the same code twice in one cell is held once", async () => {
    const wb = await sheet(HEADERS, [
      row("603", "Operator Tiga", "Driver OHT", "OHT 777; oht 777"),
    ]);
    const result = validateWorkbook(
      "k.xlsx",
      employeeTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.accepted[0]!.parsed.skillIds).toEqual(["s1"]);
  });

  test("an empty skills cell is an employee with no skills, not an error", async () => {
    const wb = await sheet(HEADERS, [
      row("604", "Admin Baru", "Driver OHT", ""),
    ]);
    const result = validateWorkbook(
      "k.xlsx",
      employeeTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.errorCount).toBe(0);
    expect(result.preview.newCount).toBe(1);
    expect(result.accepted[0]!.parsed.skillIds).toEqual([]);
  });

  test("a blank skills cell on an existing row keeps the codes it has", async () => {
    // The same rule every other optional column follows. Otherwise a file that
    // simply omits the column strips every operator of every qualification —
    // and produces no error at all while doing it.
    const wb = await sheet(["nik", "nama"], [[budi.nik, "Budi Santoso"]]);
    const result = validateWorkbook(
      "k.xlsx",
      employeeTarget(
        new Map([[budi.nik.toLowerCase(), budi]]),
        catalogues,
        mayCreate
      ),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.errorCount).toBe(0);
    expect(result.accepted[0]!.parsed.skillIds.sort()).toEqual(["s1", "s2"]);
    expect(result.preview.rows[0]!.kind).toBe("unchanged");
  });

  test("the same NIK on two rows fails the second, naming the first", async () => {
    const wb = await sheet(HEADERS, [row("605", "Satu"), row("605", "Dua")]);
    const result = validateWorkbook(
      "k.xlsx",
      employeeTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.errorCount).toBe(1);
    expect(result.preview.errors[0]!.row).toBe("3");
    expect(result.preview.errors[0]!.issue).toContain("baris 2");
  });

  /**
   * The one asymmetry in the import (design D11), asserted at the grant level
   * that would make every other column permissive.
   */
  test("an unknown qualification code fails the row even with manage on kode-simper", async () => {
    const wb = await sheet(HEADERS, [
      row("606", "Operator Salah Ketik", "Driver OHT", "OHT 7777"),
    ]);
    const result = validateWorkbook(
      "k.xlsx",
      employeeTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.errorCount).toBe(1);
    expect(result.preview.errors[0]!.row).toBe("2");
    expect(result.preview.errors[0]!.issue).toContain("OHT 7777");
    // Nothing is offered for creation, at any grant.
    expect(result.preview.newMasters).toEqual([]);
    expect(result.accepted).toEqual([]);
  });

  test("the refusal explains itself rather than saying only 'not found'", async () => {
    const wb = await sheet(HEADERS, [
      row("607", "Operator Salah Ketik", "Driver OHT", "OHT 7777"),
    ]);
    const result = validateWorkbook(
      "k.xlsx",
      employeeTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    const issue = result.preview.errors[0]!.issue;
    // Five columns offer an addition and this one refuses; without the reason
    // in place, the refusal reads as a defect.
    expect(issue).toContain("tidak pernah dibuat lewat import");
    expect(issue).toContain("Kode SIMPER");
  });

  test("an unknown position is offered as a pending addition", async () => {
    const wb = await sheet(HEADERS, [
      row("608", "Jabatan Baru", "Foreman Pit"),
    ]);
    const result = validateWorkbook(
      "k.xlsx",
      employeeTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.errorCount).toBe(0);
    expect(result.preview.newCount).toBe(1);
    expect(result.preview.newMasters).toEqual([
      { kind: "jabatan", name: "Foreman Pit", rows: 1 },
    ]);
    expect(result.preview.warnings).toHaveLength(1);
    expect(result.preview.warnings[0]!.badgeVariant).toBe("warning");
    // Carried by name until a commit can supply an id.
    expect(result.accepted[0]!.parsed.positionId).toBeNull();
    expect(result.accepted[0]!.parsed.positionName).toBe("Foreman Pit");
  });

  test("without manage on jabatan, the same position fails its row", async () => {
    const wb = await sheet(HEADERS, [
      row("609", "Jabatan Baru", "Foreman Pit"),
    ]);
    const result = validateWorkbook(
      "k.xlsx",
      employeeTarget(empty, catalogues, mayNotCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.errorCount).toBe(1);
    expect(result.preview.errors[0]!.issue).toContain("Foreman Pit");
    expect(result.preview.newMasters).toEqual([]);
    expect(result.accepted).toEqual([]);
  });

  test("a missing required reference on a new row fails it", async () => {
    const wb = await sheet(
      ["nik", "nama", "perusahaan"],
      [["610", "Tanpa Departemen", "PT Unggul Dinamika Utama"]]
    );
    const result = validateWorkbook(
      "k.xlsx",
      employeeTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.errorCount).toBe(1);
    expect(result.preview.errors[0]!.issue).toContain("wajib diisi");
  });

  test("a status outside the vocabulary fails its row", async () => {
    const wb = await sheet(
      [...HEADERS, "status"],
      [[...row("611", "Cuti Panjang"), "cuti"]]
    );
    const result = validateWorkbook(
      "k.xlsx",
      employeeTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    // `cuti` was a status in the static port and is not one any more (D7): it
    // belongs to the roster, which is dated, and this column is not.
    expect(result.preview.errorCount).toBe(1);
    expect(result.preview.errors[0]!.issue).toContain("aktif");
  });

  test("a malformed date fails its row rather than being read as something else", async () => {
    const wb = await sheet(
      [...HEADERS, "tanggal_masuk"],
      [[...row("612", "Tanggal Aneh"), "01/03/2022"]]
    );
    const result = validateWorkbook(
      "k.xlsx",
      employeeTarget(empty, catalogues, mayCreate),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.errorCount).toBe(1);
    expect(result.preview.errors[0]!.issue).toContain("YYYY-MM-DD");
  });

  test("a reordered skills cell is not a change", async () => {
    const wb = await sheet(
      ["nik", "kode_simper"],
      [[budi.nik, "OHT 773; OHT 777"]]
    );
    const result = validateWorkbook(
      "k.xlsx",
      employeeTarget(
        new Map([[budi.nik.toLowerCase(), budi]]),
        catalogues,
        mayCreate
      ),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.rows[0]!.kind).toBe("unchanged");
    expect(skillText(["OHT 777", "OHT 773"])).toBe("OHT 773; OHT 777");
  });

  test("names the fields an update would change", async () => {
    const wb = await sheet(
      ["nik", "jabatan", "kamar"],
      [[budi.nik, "Driver OHT", "A-15"]]
    );
    const result = validateWorkbook(
      "k.xlsx",
      employeeTarget(
        new Map([[budi.nik.toLowerCase(), budi]]),
        catalogues,
        mayCreate
      ),
      wb
    );
    if ("code" in result) throw new Error(result.message);
    expect(result.preview.updatedCount).toBe(1);
    expect(result.preview.rows[0]!.changes).toEqual([
      { field: "kamar", from: "A-12", to: "A-15" },
    ]);
  });
});

/* ---------------------------------------------------------------- atomicity */

describe("commit atomicity", () => {
  /**
   * The commit writes every row of a file inside one `db.transaction`, so a
   * failure part-way leaves nothing applied.
   *
   * Driven directly rather than through the route, because the route cannot be
   * made to fail: the preview refuses every in-file conflict before a commit is
   * allowed to start, so there is no request that gets half-way. What is worth
   * asserting is therefore the mechanism the commit relies on — that a throw
   * inside the transaction takes the earlier inserts with it.
   */
  test("a failure part-way through leaves no row from that file applied", async () => {
    const names = ["ZZ Uji Satu", "ZZ Uji Dua", "ZZ Uji Tiga"];
    const before = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.unitBrands);

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(schema.unitBrands).values({ name: names[0]! });
        await tx.insert(schema.unitBrands).values({ name: names[1]! });
        throw new Error("simulated failure part-way through the file");
      })
    ).rejects.toThrow("simulated failure");

    const after = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.unitBrands);
    expect(after[0]!.count).toBe(before[0]!.count);

    const survivors = await db
      .select({ name: schema.unitBrands.name })
      .from(schema.unitBrands)
      .where(inArray(schema.unitBrands.name, names));
    expect(survivors).toEqual([]);
  });

  test("a successful commit applies every row", async () => {
    const names = ["ZZ Uji Empat", "ZZ Uji Lima"];
    await db.transaction(async (tx) => {
      for (const name of names)
        await tx.insert(schema.unitBrands).values({ name });
    });
    const written = await db
      .select({ name: schema.unitBrands.name })
      .from(schema.unitBrands)
      .where(inArray(schema.unitBrands.name, names));
    expect(written.length).toBe(2);

    await db
      .delete(schema.unitBrands)
      .where(inArray(schema.unitBrands.name, names));
  });

  test("the case-insensitive index is what refuses a duplicate name", async () => {
    // Cleared first: a run that failed before its cleanup would otherwise leave
    // the row behind and make every later run fail on the *setup* insert, which
    // reads as the assertion failing when it never got to run.
    await db
      .delete(schema.unitBrands)
      .where(sql`lower(${schema.unitBrands.name}) = 'zz uji unik'`);
    const [row] = await db
      .insert(schema.unitBrands)
      .values({ name: "ZZ Uji Unik" })
      .returning({ id: schema.unitBrands.id });
    // Wrapped in an async call: a Drizzle query builder is a thenable, not a
    // Promise, and `expect().rejects` wants the real thing.
    await expect(
      (async () =>
        db.insert(schema.unitBrands).values({ name: "zz uji unik" }))()
    ).rejects.toThrow();
    await db.delete(schema.unitBrands).where(eq(schema.unitBrands.id, row!.id));
  });
});
