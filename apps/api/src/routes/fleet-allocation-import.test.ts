/**
 * The PLAN spreadsheet import: every pairing rule the single-slot route
 * enforces, applied to a whole file — including rows that only a file can
 * produce, like an operator moved between units by re-upload.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/fleet-allocation-import.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import ExcelJS from "exceljs";
import { inArray } from "drizzle-orm";
import type { PlanImportPreview } from "@universe/contracts";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { localDate } from "../scheduler";
import { redis } from "../redis";
import { fleetAllocationRoutes } from "./fleet-allocation";

const app = new Elysia().use(fleetAllocationRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji AllocImp ${uid()}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  rosterDocuments: [] as string[],
  employees: [] as string[],
  units: [] as string[],
  positions: [] as string[],
  departments: [] as string[],
  companies: [] as string[],
  simperCodes: [] as string[],
  catalogues: [] as string[],
};

let admin: { id: string; cookie: string };
let viewer: { cookie: string };

let deptA = "";
let skillCode = { id: "", name: "" };

type Person = { id: string; nik: string; name: string };
let opFit: Person; //      dept A, skilled, valid SIMPER
let opFit2: Person; //     dept A, skilled, valid SIMPER
let opNoSkill: Person; //  dept A, no qualification
let opExpired: Person; //  dept A, skilled, SIMPER expired
let opWrongDept: Person; // dept B, skilled
let clerk: Person; //      dept A, position outside fleet allocation
let opDay: Person; //      roster: D today
let opDay2: Person; //     roster: D today
let opNight: Person; //    roster: N today

type Unit = { id: string; code: string };
let unitReq: Unit; //  global, requires the skill code
let unitDept: Unit; // owned by dept A, no requirement
let unitFree: Unit; // global, no requirement
let unitOther: Unit; // global, no requirement

/* ------------------------------------------------------------- fixtures */

async function makeUser(mode: "view" | "manage") {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-aimp-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values([{ roleId: role!.id, menuSlug: "fleet-allocation", mode }]);
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId: role!.id,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  return { id: user!.id, cookie: `${SESSION_COOKIE}=${session.id}` };
}

const get = (path: string, cookie: string) =>
  app.handle(new Request(`http://localhost${path}`, { headers: { cookie } }));

const postForm = (path: string, cookie: string, form: FormData) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { cookie },
      body: form,
    })
  );

async function file(
  rows: string[][],
  headers = ["unit", "nik"]
): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Plan");
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  const buffer = await wb.xlsx.writeBuffer();
  return new File([buffer], "plan.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function form(f: File) {
  const fd = new FormData();
  fd.append("file", f);
  return fd;
}

async function validate(rows: string[][]) {
  const response = await postForm(
    "/fleet-allocation/plan/import/validate",
    admin.cookie,
    form(await file(rows))
  );
  expect(response.status).toBe(200);
  return (await response.json()) as PlanImportPreview;
}

const commit = async (rows: string[][], cookie = admin.cookie) =>
  postForm(
    "/fleet-allocation/plan/import/commit",
    cookie,
    form(await file(rows))
  );

beforeAll(async () => {
  // scheduler.test.ts disconnects the shared client in its teardown, and bun
  // runs every file in one process.
  if (redis.status === "end") await redis.connect();

  admin = await makeUser("manage");
  viewer = await makeUser("view");

  const [company] = await db
    .insert(schema.companies)
    .values({ name: tag, code: `ZI${uid()}` })
    .returning({ id: schema.companies.id });
  made.companies.push(company!.id);
  const [a] = await db
    .insert(schema.departments)
    .values({ name: `${tag} A`, companyId: company!.id })
    .returning({ id: schema.departments.id });
  const [b] = await db
    .insert(schema.departments)
    .values({ name: `${tag} B`, companyId: company!.id })
    .returning({ id: schema.departments.id });
  deptA = a!.id;
  made.departments.push(a!.id, b!.id);

  const position = async (departmentId: string, fleetAllocation: boolean) => {
    const [row] = await db
      .insert(schema.positions)
      .values({ name: `${tag} ${uid()}`, departmentId, fleetAllocation })
      .returning({ id: schema.positions.id });
    made.positions.push(row!.id);
    return row!.id;
  };
  const operatorA = await position(a!.id, true);
  const operatorB = await position(b!.id, true);
  const clerkPos = await position(a!.id, false);

  const [sc] = await db
    .insert(schema.simperCodes)
    .values({ name: `${tag} CODE` })
    .returning({ id: schema.simperCodes.id, name: schema.simperCodes.name });
  skillCode = sc!;
  made.simperCodes.push(sc!.id);

  const employee = async (input: {
    label: string;
    departmentId: string;
    positionId: string;
    skilled?: boolean;
    simperExp?: string | null;
  }): Promise<Person> => {
    const nik = `ZZI${uid()}`;
    const [row] = await db
      .insert(schema.employees)
      .values({
        nik,
        name: `${tag} ${input.label}`,
        companyId: company!.id,
        departmentId: input.departmentId,
        positionId: input.positionId,
        simperExp: input.simperExp ?? null,
      })
      .returning({ id: schema.employees.id });
    made.employees.push(row!.id);
    if (input.skilled)
      await db
        .insert(schema.employeeSkills)
        .values({ employeeId: row!.id, simperCodeId: skillCode.id });
    return { id: row!.id, nik, name: `${tag} ${input.label}` };
  };

  opFit = await employee({
    label: "Fit",
    departmentId: deptA,
    positionId: operatorA,
    skilled: true,
    simperExp: "2099-01-01",
  });
  opFit2 = await employee({
    label: "FitTwo",
    departmentId: deptA,
    positionId: operatorA,
    skilled: true,
    simperExp: "2099-01-01",
  });
  opNoSkill = await employee({
    label: "NoSkill",
    departmentId: deptA,
    positionId: operatorA,
  });
  opExpired = await employee({
    label: "Expired",
    departmentId: deptA,
    positionId: operatorA,
    skilled: true,
    simperExp: "2020-01-01",
  });
  opWrongDept = await employee({
    label: "WrongDept",
    departmentId: b!.id,
    positionId: operatorB,
    skilled: true,
  });
  clerk = await employee({
    label: "Clerk",
    departmentId: deptA,
    positionId: clerkPos,
  });
  opDay = await employee({
    label: "Day",
    departmentId: deptA,
    positionId: operatorA,
  });
  opDay2 = await employee({
    label: "DayTwo",
    departmentId: deptA,
    positionId: operatorA,
  });
  opNight = await employee({
    label: "Night",
    departmentId: deptA,
    positionId: operatorA,
  });

  const [cls] = await db
    .insert(schema.unitClasses)
    .values({ name: `${tag} CLASS` })
    .returning({ id: schema.unitClasses.id });
  const [typ] = await db
    .insert(schema.unitTypes)
    .values({ name: `${tag} TYPE` })
    .returning({ id: schema.unitTypes.id });
  const [mdl] = await db
    .insert(schema.unitModels)
    .values({ name: `${tag} MODEL` })
    .returning({ id: schema.unitModels.id });
  const [brd] = await db
    .insert(schema.unitBrands)
    .values({ name: `${tag} BRAND` })
    .returning({ id: schema.unitBrands.id });
  made.catalogues.push(cls!.id, typ!.id, mdl!.id, brd!.id);

  const unit = async (
    extra: Partial<{ simperCodeId: string; departmentId: string }>
  ) => {
    const [row] = await db
      .insert(schema.units)
      .values({
        code: `ZZIU${uid()}`,
        classId: cls!.id,
        typeId: typ!.id,
        modelId: mdl!.id,
        brandId: brd!.id,
        ...extra,
      })
      .returning({ id: schema.units.id, code: schema.units.code });
    made.units.push(row!.id);
    return { id: row!.id, code: row!.code };
  };
  unitReq = await unit({ simperCodeId: skillCode.id });
  unitDept = await unit({ departmentId: deptA });
  unitFree = await unit({});
  unitOther = await unit({});

  const today = localDate(new Date());
  const month = `${today.slice(0, 7)}-01`;
  const [doc] = await db
    .insert(schema.rosterDocuments)
    .values({
      departmentId: deptA,
      month,
      fileName: `${tag}.xlsx`,
      uploadedBy: admin.id,
    })
    .returning({ id: schema.rosterDocuments.id });
  made.rosterDocuments.push(doc!.id);
  await db.insert(schema.rosterDays).values([
    { documentId: doc!.id, employeeId: opDay.id, date: today, code: "D" },
    { documentId: doc!.id, employeeId: opDay2.id, date: today, code: "D" },
    { documentId: doc!.id, employeeId: opNight.id, date: today, code: "N" },
  ]);
});

afterAll(async () => {
  if (made.employees.length) {
    await db
      .delete(schema.fleetPlanSlots)
      .where(inArray(schema.fleetPlanSlots.employeeId, made.employees));
    await db
      .delete(schema.employeeSkills)
      .where(inArray(schema.employeeSkills.employeeId, made.employees));
  }
  if (made.rosterDocuments.length)
    await db
      .delete(schema.rosterDocuments)
      .where(inArray(schema.rosterDocuments.id, made.rosterDocuments));
  if (made.employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
  if (made.units.length)
    await db.delete(schema.units).where(inArray(schema.units.id, made.units));
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
  if (made.simperCodes.length)
    await db
      .delete(schema.simperCodes)
      .where(inArray(schema.simperCodes.id, made.simperCodes));
  await db
    .delete(schema.unitClasses)
    .where(inArray(schema.unitClasses.id, made.catalogues));
  await db
    .delete(schema.unitTypes)
    .where(inArray(schema.unitTypes.id, made.catalogues));
  await db
    .delete(schema.unitModels)
    .where(inArray(schema.unitModels.id, made.catalogues));
  await db
    .delete(schema.unitBrands)
    .where(inArray(schema.unitBrands.id, made.catalogues));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

/* ------------------------------------------------------------- template */

describe("the template names its columns", () => {
  test("downloads as an .xlsx with unit and nik", async () => {
    const response = await get(
      "/fleet-allocation/plan/import/template",
      admin.cookie
    );
    expect(response.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await response.arrayBuffer());
    const headers = (wb.worksheets[0]!.getRow(1).values as string[])
      .slice(1)
      .map((v) => String(v).toLowerCase());
    expect(headers).toEqual(["unit", "nik"]);
  });
});

/* ------------------------------------------------------------- validate */

describe("every pairing rule refuses by row, with its reason", () => {
  test("who may not be paired, and why", async () => {
    const preview = await validate([
      [unitFree.code, "ZZNOPE01"], //          unknown NIK
      ["ZZNOUNIT1", opFit.nik], //             unknown unit
      [unitFree.code, clerk.nik], //           position outside fleet allocation
      [unitReq.code, opNoSkill.nik], //        no qualification
      [unitReq.code, opExpired.nik], //        expired SIMPER
      [unitDept.code, opWrongDept.nik], //     wrong department
    ]);
    expect(preview.rows).toEqual([]);
    expect(preview.errorCount).toBe(6);
    const issues = preview.errors.map((e) => e.issue).join(" | ");
    expect(issues).toContain("ZZNOPE01");
    expect(issues).toContain("ZZNOUNIT1");
    expect(issues).toContain("alokasi fleet");
    expect(issues).toContain(skillCode.name);
    expect(issues).toContain("kedaluwarsa");
    expect(issues).toContain(`${tag} A`);
  });

  test("the file may not disagree with itself", async () => {
    const preview = await validate([
      [unitFree.code, opFit.nik],
      [unitFree.code, opFit.nik], //   the same pairing twice
      [unitOther.code, opFit.nik], //  one operator, two units
      [unitDept.code, opFit2.nik],
      [unitDept.code, opNoSkill.nik],
      [unitDept.code, opDay.nik], //   a third operator for a full unit
    ]);
    expect(preview.errorCount).toBe(3);
    const issues = preview.errors.map((e) => e.issue).join(" | ");
    expect(issues).toContain("baris");
  });

  test("a Day/Day pair is refused even when both come from the file", async () => {
    const preview = await validate([
      [unitFree.code, opDay.nik],
      [unitFree.code, opDay2.nik],
    ]);
    expect(preview.errorCount).toBe(1);
    expect(preview.errors[0]!.issue).toContain("pagi");
  });

  test("a Day/Night pair from the file is welcome", async () => {
    const preview = await validate([
      [unitFree.code, opDay.nik],
      [unitFree.code, opNight.nik],
    ]);
    expect(preview.errors).toEqual([]);
    expect(preview.newCount).toBe(2);
  });
});

/* ---------------------------------------------------------------- commit */

describe("the commit writes the plan whole, or not at all", () => {
  test("view may not import", async () => {
    const response = await commit([[unitFree.code, opFit.nik]], viewer.cookie);
    expect(response.status).toBe(403);
  });

  test("a file with errors writes nothing", async () => {
    const response = await commit([
      [unitFree.code, opFit.nik],
      [unitReq.code, opNoSkill.nik],
    ]);
    expect(response.status).toBe(422);
    const slots = await db
      .select()
      .from(schema.fleetPlanSlots)
      .where(inArray(schema.fleetPlanSlots.employeeId, made.employees));
    expect(slots).toEqual([]);
  });

  test("a clean file pairs; a re-upload moves and leaves the rest", async () => {
    const first = await commit([
      [unitReq.code, opFit.nik],
      [unitFree.code, opDay.nik],
      [unitFree.code, opNight.nik],
    ]);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ created: 3, moved: 0 });

    // The re-upload previews the move by name and keeps the unchanged rows
    // out of the write.
    const preview = await validate([
      [unitOther.code, opFit.nik], //  moved from unitReq
      [unitFree.code, opDay.nik], //   already there
      [unitFree.code, opNight.nik], // already there
    ]);
    expect(preview.errorCount).toBe(0);
    expect(preview.movedCount).toBe(1);
    expect(preview.unchangedCount).toBe(2);
    const moved = preview.rows.find((r) => r.nik === opFit.nik);
    expect(moved).toMatchObject({ kind: "moved", fromUnit: unitReq.code });

    const second = await commit([
      [unitOther.code, opFit.nik],
      [unitFree.code, opDay.nik],
      [unitFree.code, opNight.nik],
    ]);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ created: 0, moved: 1 });

    // The old slot is gone, the new one holds.
    const slots = await db
      .select({
        unitId: schema.fleetPlanSlots.unitId,
        employeeId: schema.fleetPlanSlots.employeeId,
      })
      .from(schema.fleetPlanSlots)
      .where(inArray(schema.fleetPlanSlots.employeeId, made.employees));
    const ofFit = slots.filter((s) => s.employeeId === opFit.id);
    expect(ofFit).toEqual([{ unitId: unitOther.id, employeeId: opFit.id }]);
  });

  test("capacity counts what the database already holds", async () => {
    // unitFree holds its Day/Night pair from the commit above; a third
    // operator must be refused at validation, not at the constraint.
    const preview = await validate([[unitFree.code, opFit2.nik]]);
    expect(preview.errorCount).toBe(1);
    expect(preview.errors[0]!.issue).toContain("2");
  });

  test("the pair rule sees the partner already in the database", async () => {
    // opDay holds unitFree; moving opDay2 (also Day) beside them by file must
    // refuse the same way the dialog does. Free a slot first so capacity is
    // not the rule that fires.
    const release = await app.handle(
      new Request(
        `http://localhost/fleet-allocation/plan/slots/${unitFree.code}/${opNight.nik}`,
        { method: "DELETE", headers: { cookie: admin.cookie } }
      )
    );
    expect(release.status).toBe(200);

    const preview = await validate([[unitFree.code, opDay2.nik]]);
    expect(preview.errorCount).toBe(1);
    expect(preview.errors[0]!.issue).toContain("pagi");
  });
});
