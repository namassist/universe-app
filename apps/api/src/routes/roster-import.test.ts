/**
 * The roster parser's contract, and the re-upload transaction it hands off to.
 *
 * The parsing half needs no database — `validateRosterSheet` is pure and the
 * context is handed to it — so most of this file is table-stakes assertions
 * about what the file says. The last block does need the dev Postgres, the same
 * as `db:seed`:
 *   bun --env-file=.env test src/routes/roster-import.test.ts
 */

import { afterAll, describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { and, eq, inArray } from "drizzle-orm";
import { ROSTER_IMPORT_FIXED_COLUMNS } from "@universe/contracts";

import { db, schema } from "../db";
import { dayHeader, monthDays } from "./roster-month";
import {
  commitRoster,
  readRosterSheet,
  readRosterWorkbook,
  rosterSheetWorkbook,
  validateRosterSheet,
  type RosterContext,
  type RosterEmployee,
} from "./roster-import";

const MONTH = "2026-07-01";
const DAYS = monthDays(MONTH); // 31

/* ----------------------------------------------------------------- helpers */

async function workbook(
  headers: string[],
  rows: (string | number)[][]
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("roster");
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  const loaded = await readRosterWorkbook(await wb.xlsx.writeBuffer());
  if ("code" in loaded) throw new Error(loaded.message);
  return loaded;
}

/** The five fixed columns, then a day column per day — a July sheet. */
const julyHeaders = [
  ...ROSTER_IMPORT_FIXED_COLUMNS,
  ...DAYS.map((d) => dayHeader(d)),
];

/**
 * One line of the sheet.
 *
 * `no`, `departemen`, and `posisi` are filled with something plausible and
 * never asserted on: the parser reads neither, and these tests would give a
 * false pass if it started to.
 */
const line = (nik: string, name: string, cells: (string | number)[]) => [
  1,
  nik,
  name,
  "Hauling",
  "Operator Dump Truck",
  ...cells,
];

/** ExcelJS reads an `ArrayBuffer`; `rosterSheetWorkbook` returns a `Buffer`. */
const asArrayBuffer = (b: Buffer): ArrayBuffer =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** One row of `count` cells all carrying the same code. */
const filled = (code: string, count = DAYS.length) =>
  Array.from({ length: count }, () => code);

const employee = (over: Partial<RosterEmployee> = {}): RosterEmployee => ({
  id: "emp-1",
  nik: "503220421",
  name: "Budi Santoso",
  departmentId: "dept-hauling",
  departmentName: "Hauling",
  status: "aktif",
  ...over,
});

const context = (
  employees: RosterEmployee[],
  over: Partial<RosterContext> = {}
): RosterContext => ({
  departmentId: "dept-hauling",
  departmentName: "Hauling",
  byNik: new Map(employees.map((e) => [e.nik.toLowerCase(), e])),
  activeDocumentId: null,
  inForce: new Map(),
  approvedRevisions: [],
  ...over,
});

async function validate(
  headers: string[],
  rows: (string | number)[][],
  ctx: RosterContext
) {
  const sheet = readRosterSheet(await workbook(headers, rows), DAYS.length);
  if ("code" in sheet) throw new Error(`sheet refused: ${sheet.code}`);
  return validateRosterSheet("roster.xlsx", MONTH, sheet, ctx);
}

/* --------------------------------------------------------------- the header */

describe("the sheet's width is decided by the month", () => {
  test("a month's worth of day columns is accepted", async () => {
    const sheet = readRosterSheet(
      await workbook(julyHeaders, [line("503220421", "Budi", filled("D"))]),
      DAYS.length
    );
    expect("code" in sheet).toBe(false);
  });

  test("too many day columns refuses the file as a whole", async () => {
    // Thirty-one columns for a thirty-day month is one mistake, and reporting
    // it as two thousand bad rows would bury it.
    const sheet = readRosterSheet(
      await workbook(julyHeaders, [line("503220421", "Budi", filled("D"))]),
      30
    );
    expect(sheet).toMatchObject({ code: "day_column_mismatch" });
  });

  test("too few day columns refuses the file as a whole", async () => {
    const short = [
      ...ROSTER_IMPORT_FIXED_COLUMNS,
      ...DAYS.slice(0, 28).map((d) => dayHeader(d)),
    ];
    const sheet = readRosterSheet(
      await workbook(short, [line("503220421", "Budi", filled("D", 28))]),
      DAYS.length
    );
    expect(sheet).toMatchObject({ code: "day_column_mismatch" });
  });

  test("the fixed columns must lead, and must be named", async () => {
    const wrong = [
      "nik",
      "no",
      "nama",
      "departemen",
      "posisi",
      ...DAYS.map((d) => dayHeader(d)),
    ];
    const sheet = readRosterSheet(await workbook(wrong, []), DAYS.length);
    expect(sheet).toMatchObject({ code: "missing_columns" });
  });
});

/* ----------------------------------------------------------------- the rows */

describe("row validation", () => {
  test("a NIK the register does not carry is a failed row", async () => {
    const result = await validate(
      julyHeaders,
      [line("512259998", "Siapa Saja", filled("D"))],
      context([employee()])
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.preview.errorCount).toBe(1);
    expect(result.preview.errors[0]!.issue).toContain("tidak terdaftar");
  });

  test("a NIK from another department names both departments", async () => {
    const result = await validate(
      julyHeaders,
      [line("508210388", "Andi", filled("D"))],
      context([
        employee({
          id: "emp-2",
          nik: "508210388",
          name: "Andi Wijaya",
          departmentId: "dept-loading",
          departmentName: "Loading",
        }),
      ])
    );
    expect(result.accepted).toHaveLength(0);
    const issue = result.preview.errors[0]!.issue;
    expect(issue).toContain("Loading");
    expect(issue).toContain("Hauling");
  });

  test("an empty day cell is a failed row", async () => {
    const cells = filled("D");
    cells[13] = "";
    const result = await validate(
      julyHeaders,
      [line("503220421", "Budi", cells)],
      context([employee()])
    );
    expect(result.accepted).toHaveLength(0);
    expect(result.preview.errors[0]!.issue).toContain("kosong");
  });

  test("a cell outside the vocabulary names the day and the value", async () => {
    const cells = filled("D");
    cells[13] = "D12";
    const result = await validate(
      julyHeaders,
      [line("503220421", "Budi", cells)],
      context([employee()])
    );
    expect(result.accepted).toHaveLength(0);
    const issue = result.preview.errors[0]!.issue;
    expect(issue).toContain("D12");
    expect(issue).toContain("14");
  });

  test("the same NIK twice is refused, naming the row that claimed it", async () => {
    const result = await validate(
      julyHeaders,
      [
        line("503220421", "Budi", filled("D")),
        line("503220421", "Budi", filled("N")),
      ],
      context([employee()])
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.preview.errors[0]!.issue).toContain("baris 2");
  });

  test("a good row is accepted with its codes in day order", async () => {
    const cells = filled("D");
    cells[0] = "off";
    const result = await validate(
      julyHeaders,
      [line("503220421", "Budi", cells)],
      context([employee()])
    );
    expect(result.preview.errorCount).toBe(0);
    expect(result.accepted).toHaveLength(1);
    // Case-insensitive on the way in, canonical on the way out.
    expect(result.accepted[0]!.codes[0]).toBe("OFF");
    expect(result.accepted[0]!.codes).toHaveLength(DAYS.length);
  });
});

/* ------------------------------------------------------------ the remarks */

describe("revisions the file would revert", () => {
  const revision = {
    employeeId: "emp-1",
    nik: "503220421",
    employeeName: "Budi Santoso",
    date: DAYS[20]!, // 21 July
    fromCode: "D" as const,
    toCode: "OFF" as const,
    revisionCode: "REV-0001",
  };

  test("a differing cell is reported, and does not block the commit", async () => {
    const result = await validate(
      julyHeaders,
      [line("503220421", "Budi", filled("D"))],
      context([employee()], { approvedRevisions: [revision] })
    );
    expect(result.preview.errorCount).toBe(0);
    expect(result.accepted).toHaveLength(1);
    expect(result.preview.warnings).toHaveLength(1);
    const warning = result.preview.warnings[0]!;
    expect(warning.badgeVariant).toBe("warning");
    expect(warning.issue).toContain("REV-0001");
    expect(warning.issue).toContain(DAYS[20]!);
  });

  test("a cell that already matches the revision is not reported", async () => {
    const cells = filled("D");
    cells[20] = "OFF";
    const result = await validate(
      julyHeaders,
      [line("503220421", "Budi", cells)],
      context([employee()], { approvedRevisions: [revision] })
    );
    expect(result.preview.warnings).toHaveLength(0);
  });

  test("each reverted revision is its own row, never a count", async () => {
    const result = await validate(
      julyHeaders,
      [line("503220421", "Budi", filled("D"))],
      context([employee()], {
        approvedRevisions: [
          revision,
          { ...revision, date: DAYS[5]!, revisionCode: "REV-0002" },
        ],
      })
    );
    expect(result.preview.warnings).toHaveLength(2);
  });
});

describe("employment status is reported, never changed", () => {
  test("a termination code on an active employee is a remark", async () => {
    const cells = filled("D");
    cells[29] = "TERM";
    const result = await validate(
      julyHeaders,
      [line("503220421", "Budi", cells)],
      context([employee({ status: "aktif" })])
    );
    expect(result.preview.errorCount).toBe(0);
    expect(result.accepted).toHaveLength(1);
    expect(result.preview.warnings).toHaveLength(1);
    expect(result.preview.warnings[0]!.badgeVariant).toBe("warning");
    expect(result.preview.warnings[0]!.issue).toContain("TERM");
  });

  test("a shift code on an inactive employee is a remark", async () => {
    const result = await validate(
      julyHeaders,
      [line("503220421", "Budi", filled("N"))],
      context([employee({ status: "nonaktif" })])
    );
    expect(result.preview.errorCount).toBe(0);
    expect(result.accepted).toHaveLength(1);
    expect(result.preview.warnings[0]!.issue).toContain("nonaktif");
  });

  test("an inactive employee rostered OFF says nothing", async () => {
    const result = await validate(
      julyHeaders,
      [line("503220421", "Budi", filled("OFF"))],
      context([employee({ status: "nonaktif" })])
    );
    expect(result.preview.warnings).toHaveLength(0);
  });
});

describe("what a re-upload would change", () => {
  test("a row matching the active document is unchanged, not new", async () => {
    const inForce = new Map(DAYS.map((d) => [`emp-1|${d}`, "D" as const]));
    const result = await validate(
      julyHeaders,
      [line("503220421", "Budi", filled("D"))],
      context([employee()], { activeDocumentId: "doc-1", inForce })
    );
    expect(result.preview.unchangedCount).toBe(1);
    expect(result.preview.newCount).toBe(0);
    expect(result.preview.rows[0]!.changes).toHaveLength(0);
  });

  test("a changed day is listed as a change, day by day", async () => {
    const inForce = new Map(DAYS.map((d) => [`emp-1|${d}`, "D" as const]));
    const cells = filled("D");
    cells[3] = "OFF";
    const result = await validate(
      julyHeaders,
      [line("503220421", "Budi", cells)],
      context([employee()], { activeDocumentId: "doc-1", inForce })
    );
    expect(result.preview.updatedCount).toBe(1);
    expect(result.preview.rows[0]!.changes).toEqual([
      { field: DAYS[3]!, from: "D", to: "OFF" },
    ]);
  });
});

/* ---------------------------------------------------------------- the commit */

/**
 * The one thing no pure test can assert: that archiving the previous document,
 * rejecting its pending entries, and inserting the new one all happen or none
 * of them do (design D5, D12).
 *
 * Driven through `commitRoster` rather than through the route, because the
 * route refuses every blocking error before a commit is allowed to start.
 */
describe("re-uploading a month", () => {
  const made = {
    departments: [] as string[],
    companies: [] as string[],
    positions: [] as string[],
    employees: [] as string[],
    roles: [] as string[],
    users: [] as string[],
    documents: [] as string[],
  };

  afterAll(async () => {
    // Order matters: the fixtures reference each other exactly as the schema
    // says they do, and `restrict` means unwinding has to be exact too.
    if (made.documents.length)
      await db
        .delete(schema.rosterDocuments)
        .where(inArray(schema.rosterDocuments.id, made.documents));
    if (made.employees.length)
      await db
        .delete(schema.employees)
        .where(inArray(schema.employees.id, made.employees));
    if (made.users.length)
      await db.delete(schema.users).where(inArray(schema.users.id, made.users));
    if (made.roles.length)
      await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
    if (made.positions.length)
      await db
        .delete(schema.positions)
        .where(inArray(schema.positions.id, made.positions));
    if (made.departments.length)
      await db
        .delete(schema.departments)
        .where(inArray(schema.departments.id, made.departments));
    if (made.companies.length)
      await db
        .delete(schema.companies)
        .where(inArray(schema.companies.id, made.companies));
  });

  test("archives the previous document, keeps its rows, and rejects its pending entries", async () => {
    const tag = `ZZ Uji Roster ${crypto.randomUUID().slice(0, 8)}`;

    const [company] = await db
      .insert(schema.companies)
      .values({ name: tag, code: tag.slice(-8) })
      .returning({ id: schema.companies.id });
    made.companies.push(company!.id);

    const [department] = await db
      .insert(schema.departments)
      .values({ name: tag, companyId: company!.id })
      .returning({ id: schema.departments.id });
    made.departments.push(department!.id);

    const [position] = await db
      .insert(schema.positions)
      .values({ name: tag, departmentId: department!.id })
      .returning({ id: schema.positions.id });
    made.positions.push(position!.id);

    const nik = `ZZ${crypto.randomUUID().slice(0, 10)}`;
    const [person] = await db
      .insert(schema.employees)
      .values({
        nik,
        name: tag,
        companyId: company!.id,
        positionId: position!.id,
        departmentId: department!.id,
      })
      .returning({ id: schema.employees.id });
    made.employees.push(person!.id);

    const [role] = await db
      .insert(schema.roles)
      .values({
        slug: tag.toLowerCase().replace(/\s+/g, "-"),
        name: tag,
        scope: "all",
      })
      .returning({ id: schema.roles.id });
    made.roles.push(role!.id);

    const [uploader] = await db
      .insert(schema.users)
      .values({
        nik,
        name: tag,
        passwordHash: "x",
        roleId: role!.id,
      })
      .returning({ id: schema.users.id });
    made.users.push(uploader!.id);

    const accepted = [
      {
        row: 2,
        employeeId: person!.id,
        nik,
        name: tag,
        codes: DAYS.map(() => "D" as const),
      },
    ];

    const first = await commitRoster(
      {
        departmentId: department!.id,
        monthFirstDay: MONTH,
        fileName: "juli.xlsx",
        uploadedBy: uploader!.id,
      },
      accepted,
      DAYS
    );
    made.documents.push(first.documentId);
    expect(first.archivedDocumentId).toBeNull();
    expect(first.dayCount).toBe(DAYS.length);

    // A revision against that document, still waiting for a decision.
    const [revision] = await db
      .insert(schema.rosterRevisions)
      .values({
        code: `REV-${crypto.randomUUID().slice(0, 8)}`,
        documentId: first.documentId,
        submittedBy: uploader!.id,
      })
      .returning({ id: schema.rosterRevisions.id });
    const [pending] = await db
      .insert(schema.rosterRevisionItems)
      .values({
        revisionId: revision!.id,
        employeeId: person!.id,
        date: DAYS[20]!,
        fromCode: "D",
        toCode: "OFF",
        reason: "uji",
      })
      .returning({ id: schema.rosterRevisionItems.id });

    const second = await commitRoster(
      {
        departmentId: department!.id,
        monthFirstDay: MONTH,
        fileName: "juli-revisi.xlsx",
        uploadedBy: uploader!.id,
      },
      accepted,
      DAYS
    );
    made.documents.push(second.documentId);

    expect(second.archivedDocumentId).toBe(first.documentId);
    expect(second.rejectedRevisions).toBe(1);

    const [archived] = await db
      .select({ status: schema.rosterDocuments.status })
      .from(schema.rosterDocuments)
      .where(eq(schema.rosterDocuments.id, first.documentId));
    expect(archived!.status).toBe("arsip");

    // The archived document keeps every row it had: its detail screen must
    // still render what the roster said that day.
    const oldRows = await db
      .select({ id: schema.rosterDays.id })
      .from(schema.rosterDays)
      .where(eq(schema.rosterDays.documentId, first.documentId));
    expect(oldRows).toHaveLength(DAYS.length);

    const [decided] = await db
      .select({
        status: schema.rosterRevisionItems.status,
        note: schema.rosterRevisionItems.decisionNote,
      })
      .from(schema.rosterRevisionItems)
      .where(eq(schema.rosterRevisionItems.id, pending!.id));
    expect(decided!.status).toBe("rejected");
    expect(decided!.note).toContain("diunggah ulang");

    // One active document for the department and month, enforced by the
    // partial unique index rather than by the route alone.
    const active = await db
      .select({ id: schema.rosterDocuments.id })
      .from(schema.rosterDocuments)
      .where(
        and(
          eq(schema.rosterDocuments.departmentId, department!.id),
          eq(schema.rosterDocuments.month, MONTH),
          eq(schema.rosterDocuments.status, "aktif")
        )
      );
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(second.documentId);
  });
});

/* -------------------------------------------------------------- the template */

/**
 * The template is the department's own sheet, and the parser has to take it
 * back unchanged.
 *
 * That round trip is the whole point of one builder serving both the template
 * and the export: a template the import refuses is worse than no template,
 * because the operator has no way to tell whose fault it is.
 */
describe("the template a department downloads", () => {
  const people = [
    {
      nik: "503220421",
      name: "Budi Santoso",
      department: "Hauling",
      position: "Operator Dump Truck",
    },
    {
      nik: "0504253156",
      name: "Sri Wahyuni",
      department: "Hauling",
      position: "Foreman",
    },
  ];

  test("carries the fixed columns, one column per day, and the people", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(asArrayBuffer(await rosterSheetWorkbook(MONTH, people)));
    const ws = wb.worksheets[0]!;

    const headers = (ws.getRow(1).values as ExcelJS.CellValue[])
      .slice(1)
      .map((v) => String(v));
    expect(headers.slice(0, 5)).toEqual([
      "NO",
      "NIK",
      "NAMA",
      "DEPARTEMEN",
      "POSISI",
    ]);
    expect(headers).toHaveLength(5 + DAYS.length);
    // The heading a planner's own workbook uses, not an invented one.
    expect(headers[5]).toBe("01 Jul 26");

    expect(ws.getRow(2).getCell(1).value).toBe(1);
    expect(ws.getRow(2).getCell(3).value).toBe("Budi Santoso");
    expect(ws.getRow(2).getCell(5).value).toBe("Operator Dump Truck");
    // A blank day cell is the point: the codes are what the operator types.
    expect(ws.getRow(2).getCell(6).value).toBe("");
  });

  test("a NIK with a leading zero survives the round trip", async () => {
    // Written as text, because Excel reads 0504253156 as a number and hands
    // back 504253156 — an unknown employee, reported as a typo that is not one.
    const bytes = asArrayBuffer(await rosterSheetWorkbook(MONTH, people));
    const loaded = await readRosterWorkbook(bytes);
    if ("code" in loaded) throw new Error(loaded.message);
    const sheet = readRosterSheet(loaded, DAYS.length);
    if ("code" in sheet) throw new Error(`sheet refused: ${sheet.code}`);

    expect(sheet.rows.map((r) => r.nik)).toEqual(["503220421", "0504253156"]);
    expect(sheet.rows[0]!.name).toBe("Budi Santoso");
    expect(sheet.rows[0]!.cells).toHaveLength(DAYS.length);
    expect(sheet.rows[0]!.cells.every((c) => c === "")).toBe(true);
  });

  test("filled in, it validates as an ordinary upload", async () => {
    const bytes = asArrayBuffer(
      await rosterSheetWorkbook(MONTH, [
        { ...people[0]!, codes: DAYS.map(() => "D" as const) },
      ])
    );
    const loaded = await readRosterWorkbook(bytes);
    if ("code" in loaded) throw new Error(loaded.message);
    const sheet = readRosterSheet(loaded, DAYS.length);
    if ("code" in sheet) throw new Error(`sheet refused: ${sheet.code}`);

    const result = validateRosterSheet(
      "template.xlsx",
      MONTH,
      sheet,
      context([employee()])
    );
    expect(result.preview.errorCount).toBe(0);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]!.codes).toHaveLength(DAYS.length);
  });
});
