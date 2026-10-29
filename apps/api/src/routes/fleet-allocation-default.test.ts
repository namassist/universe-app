/**
 * The saved default PLAN and Reset, driven through the real routes.
 *
 * Importing a PLAN file replaces the saved default and never touches the live
 * plan; Reset is the one door from the default back to the live plan. The
 * default is one global thing, so this file saves whatever stood before it ran
 * and puts it back, and asserts only on its own fixture units and people.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/fleet-allocation-default.test.ts
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { Elysia } from "elysia";
import ExcelJS from "exceljs";
import { and, eq, inArray } from "drizzle-orm";
import type {
  PlanDefaultInfo,
  PlanImportPreview,
  PlanResetPreview,
  PlanResetResult,
} from "@universe/contracts";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { fleetAllocationRoutes } from "./fleet-allocation";
import { clearPlanDefault, snapshotPlanDefault } from "./plan-default-snapshot";

const app = new Elysia().use(fleetAllocationRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji AllocDef ${uid()}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
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
let restoreDefault: () => Promise<void>;

type Person = { id: string; nik: string; name: string };
let op1: Person;
let op2: Person;
let op3: Person;
let op4: Person;
let opSkilled: Person; //  holds the unit's code, valid SIMPER
let opLeaver: Person; //   made nonaktif by a test
let opLapsing: Person; //  skilled, SIMPER expired by a test
let opGone: Person; //     deleted by a test

type Unit = { id: string; code: string };
let uA: Unit;
let uB: Unit;
let uC: Unit;
let uReq: Unit; //  requires the skill code

const FIXTURE_FILE = "default.xlsx";

/* ------------------------------------------------------------- fixtures */

async function makeUser(mode: "view" | "manage") {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-adef-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values([{ roleId: role!.id, menuSlug: "fleet-allocation", mode }]);
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-${uid()}@uji.local`,
      name: `${tag} ${mode}`,
      passwordHash: "x",
      roleId: role!.id,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  return { id: user!.id, cookie: `${SESSION_COOKIE}=${session.id}` };
}

const get = (path: string, cookie = admin.cookie) =>
  app.handle(new Request(`http://localhost${path}`, { headers: { cookie } }));

const post = (path: string, cookie = admin.cookie, body?: FormData) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { cookie },
      ...(body ? { body } : {}),
    })
  );

async function form(rows: string[][]): Promise<FormData> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Plan");
  ws.addRow(["unit", "nik"]);
  for (const r of rows) ws.addRow(r);
  const buffer = await wb.xlsx.writeBuffer();
  const fd = new FormData();
  fd.append(
    "file",
    new File([buffer], FIXTURE_FILE, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })
  );
  return fd;
}

async function validate(rows: string[][]) {
  const response = await post(
    "/fleet-allocation/plan/import/validate",
    admin.cookie,
    await form(rows)
  );
  expect(response.status).toBe(200);
  return (await response.json()) as PlanImportPreview;
}

const commit = async (rows: string[][], cookie = admin.cookie) =>
  post("/fleet-allocation/plan/import/commit", cookie, await form(rows));

async function setDefault(rows: string[][]) {
  const response = await commit(rows);
  expect(response.status).toBe(200);
}

const pairLive = async (unit: Unit, person: Person) => {
  const response = await app.handle(
    new Request("http://localhost/fleet-allocation/plan/slots", {
      method: "POST",
      headers: { cookie: admin.cookie, "content-type": "application/json" },
      body: JSON.stringify({ unitCode: unit.code, nik: person.nik }),
    })
  );
  expect(response.status).toBe(201);
};

const resetPreview = async () => {
  const response = await get("/fleet-allocation/plan/reset/preview");
  expect(response.status).toBe(200);
  return (await response.json()) as PlanResetPreview;
};

/** Who holds what in the live plan, among this file's own fixtures. */
async function liveOf(people: Person[]) {
  const rows = await db
    .select({
      nik: schema.employees.nik,
      unitId: schema.fleetPlanSlots.unitId,
    })
    .from(schema.fleetPlanSlots)
    .innerJoin(
      schema.employees,
      eq(schema.employees.id, schema.fleetPlanSlots.employeeId)
    )
    .where(
      inArray(
        schema.fleetPlanSlots.employeeId,
        people.map((p) => p.id)
      )
    );
  return Object.fromEntries(rows.map((r) => [r.nik, r.unitId]));
}

async function wipeFixtureState() {
  if (made.units.length)
    await db
      .delete(schema.fleetPlanHistory)
      .where(inArray(schema.fleetPlanHistory.unitId, made.units));
  if (made.employees.length)
    await db
      .delete(schema.fleetPlanSlots)
      .where(inArray(schema.fleetPlanSlots.employeeId, made.employees));
}

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
  restoreDefault = await snapshotPlanDefault();

  admin = await makeUser("manage");
  viewer = await makeUser("view");

  const [company] = await db
    .insert(schema.companies)
    .values({ name: tag, code: `ZD${uid()}` })
    .returning({ id: schema.companies.id });
  made.companies.push(company!.id);
  const [dept] = await db
    .insert(schema.departments)
    .values({ name: `${tag} A`, companyId: company!.id })
    .returning({ id: schema.departments.id });
  made.departments.push(dept!.id);
  const [pos] = await db
    .insert(schema.positions)
    .values({
      name: `${tag} ${uid()}`,
      departmentId: dept!.id,
      fleetAllocation: true,
    })
    .returning({ id: schema.positions.id });
  made.positions.push(pos!.id);

  const [code] = await db
    .insert(schema.simperCodes)
    .values({ name: `${tag} CODE` })
    .returning({ id: schema.simperCodes.id });
  made.simperCodes.push(code!.id);

  const employee = async (
    label: string,
    extra: { skilled?: boolean; simperExp?: string } = {}
  ): Promise<Person> => {
    const nik = `ZZD${uid()}`;
    const [row] = await db
      .insert(schema.employees)
      .values({
        nik,
        name: `${tag} ${label}`,
        companyId: company!.id,
        departmentId: dept!.id,
        positionId: pos!.id,
        simperExp: extra.simperExp ?? null,
      })
      .returning({ id: schema.employees.id });
    made.employees.push(row!.id);
    if (extra.skilled)
      await db
        .insert(schema.employeeSkills)
        .values({ employeeId: row!.id, simperCodeId: code!.id });
    return { id: row!.id, nik, name: `${tag} ${label}` };
  };
  op1 = await employee("One");
  op2 = await employee("Two");
  op3 = await employee("Three");
  op4 = await employee("Four");
  opSkilled = await employee("Skilled", {
    skilled: true,
    simperExp: "2099-01-01",
  });
  opLeaver = await employee("Leaver");
  opLapsing = await employee("Lapsing", {
    skilled: true,
    simperExp: "2099-01-01",
  });
  opGone = await employee("Gone");

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

  const unit = async (simperCodeId?: string): Promise<Unit> => {
    const [row] = await db
      .insert(schema.units)
      .values({
        code: `ZZDU${uid()}`,
        classId: cls!.id,
        typeId: typ!.id,
        modelId: mdl!.id,
        brandId: brd!.id,
        ...(simperCodeId ? { simperCodeId } : {}),
      })
      .returning({ id: schema.units.id, code: schema.units.code });
    made.units.push(row!.id);
    return { id: row!.id, code: row!.code };
  };
  uA = await unit();
  uB = await unit();
  uC = await unit();
  uReq = await unit(code!.id);
});

beforeEach(async () => {
  // Tests age their people (leave, lapse); every test starts from fit ones.
  await db
    .update(schema.employees)
    .set({ status: "aktif" })
    .where(eq(schema.employees.id, opLeaver.id));
  await db
    .update(schema.employees)
    .set({ simperExp: "2099-01-01" })
    .where(eq(schema.employees.id, opLapsing.id));
  await wipeFixtureState();
  await clearPlanDefault();
});

afterAll(async () => {
  // The suite's defaults first: `fleet_plan_defaults.unit_id` is `restrict`,
  // and the default that stood before this file ran comes back with them.
  await restoreDefault();
  await wipeFixtureState();
  if (made.employees.length) {
    await db
      .delete(schema.employeeSkills)
      .where(inArray(schema.employeeSkills.employeeId, made.employees));
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
  }
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
  for (const table of [
    schema.unitClasses,
    schema.unitTypes,
    schema.unitModels,
    schema.unitBrands,
  ])
    await db.delete(table).where(inArray(table.id, made.catalogues));
  if (made.users.length) {
    await db
      .delete(schema.fleetPlanDefaultImports)
      .where(inArray(schema.fleetPlanDefaultImports.actorUserId, made.users));
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  }
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

/* -------------------------------------------------------------- preview */

describe("the import preview compares the file with the saved default", () => {
  test("new, moved, unchanged and removed are relative to the default", async () => {
    await setDefault([
      [uA.code, op1.nik],
      [uA.code, op2.nik],
      [uB.code, op3.nik],
    ]);

    const preview = await validate([
      [uA.code, op1.nik], //  unchanged
      [uB.code, op2.nik], //  moved from uA
      [uC.code, op4.nik], //  new
    ]);

    expect(preview.errors).toEqual([]);
    expect(preview.unchangedCount).toBe(1);
    expect(preview.movedCount).toBe(1);
    expect(preview.newCount).toBe(1);
    expect(preview.removedCount).toBe(1);
    expect(preview.removed).toEqual([
      { unit: uB.code, nik: op3.nik, name: op3.name },
    ]);
    expect(preview.rows.find((r) => r.nik === op2.nik)).toMatchObject({
      kind: "moved",
      fromUnit: uA.code,
    });
  });

  test("the live plan is not what the file is compared with", async () => {
    await setDefault([[uA.code, op1.nik]]);
    await pairLive(uC, op1); // the board disagrees with the default

    const preview = await validate([[uA.code, op1.nik]]);

    expect(preview.unchangedCount).toBe(1);
    expect(preview.movedCount).toBe(0);
  });

  test("with no default yet, every row is new and nothing is removed", async () => {
    const preview = await validate([[uA.code, op1.nik]]);

    expect(preview.newCount).toBe(1);
    expect(preview.removedCount).toBe(0);
    expect(preview.removed).toEqual([]);
  });

  test("a default pairing the file names with an error is not reported removed", async () => {
    await setDefault([[uA.code, op1.nik]]);

    const preview = await validate([["ZZNOUNIT", op1.nik]]);

    expect(preview.errorCount).toBe(1);
    expect(preview.removedCount).toBe(0);
  });
});

describe("capacity is judged inside the file alone", () => {
  test("a third operator on one unit is refused at the third row", async () => {
    const preview = await validate([
      [uC.code, op1.nik],
      [uC.code, op2.nik],
      [uC.code, op3.nik],
    ]);

    expect(preview.errorCount).toBe(1);
    expect(preview.errors[0]).toMatchObject({ row: "4", nik: op3.nik });
    expect(preview.errors[0]!.issue).toContain("2");
  });

  test("unchanged rows count toward the unit's two", async () => {
    await setDefault([
      [uC.code, op1.nik],
      [uC.code, op2.nik],
    ]);

    const preview = await validate([
      [uC.code, op1.nik],
      [uC.code, op2.nik],
      [uC.code, op3.nik],
    ]);

    expect(preview.errorCount).toBe(1);
    expect(preview.errors[0]!.nik).toBe(op3.nik);
  });

  test("operators the old default put on a unit do not fill it for the new file", async () => {
    await setDefault([
      [uA.code, op1.nik],
      [uA.code, op2.nik],
    ]);
    await pairLive(uA, op1);
    await pairLive(uA, op2);

    const preview = await validate([[uA.code, op3.nik]]);

    expect(preview.errors).toEqual([]);
    expect(preview.newCount).toBe(1);
    expect(preview.removedCount).toBe(2);
  });
});

/* --------------------------------------------------------------- commit */

describe("the commit saves the default and leaves the live plan alone", () => {
  test("view may not import", async () => {
    const response = await commit([[uA.code, op1.nik]], viewer.cookie);

    expect(response.status).toBe(403);
  });

  test("a file with errors saves nothing", async () => {
    await setDefault([[uA.code, op1.nik]]);

    const response = await commit([
      [uB.code, op2.nik],
      ["ZZNOUNIT", op3.nik],
    ]);

    expect(response.status).toBe(422);
    const info = (await (
      await get("/fleet-allocation/plan/default")
    ).json()) as PlanDefaultInfo;
    expect(info.pairs).toBe(1);
  });

  test("an empty file is refused rather than wiping the default", async () => {
    await setDefault([[uA.code, op1.nik]]);

    const response = await commit([]);

    expect(response.status).toBe(422);
    const info = (await (
      await get("/fleet-allocation/plan/default")
    ).json()) as PlanDefaultInfo;
    expect(info.pairs).toBe(1);
  });

  test("replaces the whole default and reports what changed", async () => {
    await setDefault([
      [uA.code, op1.nik],
      [uB.code, op2.nik],
    ]);

    const response = await commit([
      [uA.code, op1.nik], //  unchanged
      [uC.code, op2.nik], //  moved
      [uB.code, op3.nik], //  new
    ]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      pairs: 3,
      created: 1,
      moved: 1,
      removed: 0,
    });

    const third = await commit([[uA.code, op4.nik]]);
    expect(await third.json()).toEqual({
      pairs: 1,
      created: 1,
      moved: 0,
      removed: 3,
    });
    const held = await db
      .select({ nik: schema.fleetPlanDefaults.nik })
      .from(schema.fleetPlanDefaults);
    expect(held).toEqual([{ nik: op4.nik }]);
  });

  test("never touches fleet_plan_slots or fleet_plan_history", async () => {
    await pairLive(uA, op1);
    const slotsBefore = await liveOf([op1, op2]);
    const historyBefore = await db
      .select({ id: schema.fleetPlanHistory.id })
      .from(schema.fleetPlanHistory)
      .where(inArray(schema.fleetPlanHistory.unitId, made.units));

    await setDefault([
      [uB.code, op1.nik],
      [uB.code, op2.nik],
    ]);

    expect(await liveOf([op1, op2])).toEqual(slotsBefore);
    const historyAfter = await db
      .select({ id: schema.fleetPlanHistory.id })
      .from(schema.fleetPlanHistory)
      .where(inArray(schema.fleetPlanHistory.unitId, made.units));
    expect(historyAfter).toEqual(historyBefore);
  });

  test("keeps one import row per commit as the audit trail", async () => {
    await setDefault([[uA.code, op1.nik]]);
    await setDefault([[uB.code, op1.nik]]);

    const imports = await db
      .select({
        fileName: schema.fleetPlanDefaultImports.fileName,
        actorUserId: schema.fleetPlanDefaultImports.actorUserId,
      })
      .from(schema.fleetPlanDefaultImports)
      .where(eq(schema.fleetPlanDefaultImports.actorUserId, admin.id));
    expect(imports).toEqual([
      { fileName: FIXTURE_FILE, actorUserId: admin.id },
      { fileName: FIXTURE_FILE, actorUserId: admin.id },
    ]);
  });
});

describe("GET /plan/default", () => {
  test("is null before any import and describes the default after", async () => {
    const before = await get("/fleet-allocation/plan/default");
    expect(before.status).toBe(200);
    expect(await before.json()).toBeNull();

    await setDefault([
      [uA.code, op1.nik],
      [uB.code, op2.nik],
    ]);

    const after = (await (
      await get("/fleet-allocation/plan/default")
    ).json()) as PlanDefaultInfo;
    expect(after).toMatchObject({
      fileName: FIXTURE_FILE,
      actorName: `${tag} manage`,
      pairs: 2,
    });
    expect(Number.isNaN(Date.parse(after.createdAt))).toBe(false);
  });

  test("view may read it", async () => {
    const response = await get("/fleet-allocation/plan/default", viewer.cookie);

    expect(response.status).toBe(200);
  });
});

/* ---------------------------------------------------------------- reset */

describe("Reset with no default", () => {
  test("the preview and the reset are both 409 no_default", async () => {
    const preview = await get("/fleet-allocation/plan/reset/preview");
    expect(preview.status).toBe(409);
    expect(await preview.json()).toMatchObject({ code: "no_default" });

    const reset = await post("/fleet-allocation/plan/reset");
    expect(reset.status).toBe(409);
    expect(await reset.json()).toMatchObject({ code: "no_default" });
  });
});

describe("the reset preview", () => {
  test("lists release, assign and skipped, each with a reason", async () => {
    await setDefault([
      [uA.code, op1.nik], //            already live: unchanged
      [uA.code, op2.nik], //            to assign
      [uB.code, opLeaver.nik], //       will have left
      [uReq.code, opLapsing.nik], //    SIMPER will have lapsed
      [uC.code, opGone.nik], //         will be deleted
    ]);
    await pairLive(uA, op1);
    await pairLive(uC, op3); //         not in the default: to release
    await db
      .update(schema.employees)
      .set({ status: "nonaktif" })
      .where(eq(schema.employees.id, opLeaver.id));
    await db
      .update(schema.employees)
      .set({ simperExp: "2020-01-01" })
      .where(eq(schema.employees.id, opLapsing.id));
    await db.delete(schema.employees).where(eq(schema.employees.id, opGone.id));

    const preview = await resetPreview();

    expect(preview.release).toEqual([
      { unit: uC.code, nik: op3.nik, name: op3.name },
    ]);
    expect(preview.assign).toEqual([
      { unit: uA.code, nik: op2.nik, name: op2.name },
    ]);
    expect(preview.unchanged).toBe(1);
    expect(preview.defaultInfo).toMatchObject({ fileName: FIXTURE_FILE });
    const skipped = Object.fromEntries(preview.skipped.map((s) => [s.nik, s]));
    expect(Object.keys(skipped).sort()).toEqual(
      [opLeaver.nik, opLapsing.nik, opGone.nik].sort()
    );
    expect(skipped[opLeaver.nik]).toMatchObject({
      unit: uB.code,
      name: opLeaver.name,
    });
    expect(skipped[opLeaver.nik]!.reason).toContain("nonaktif");
    expect(skipped[opLapsing.nik]!.reason).toContain("kedaluwarsa");
    expect(skipped[opGone.nik]!.reason.length).toBeGreaterThan(0);
  });

  test("changes nothing", async () => {
    await setDefault([[uA.code, op1.nik]]);
    await pairLive(uB, op2);

    await resetPreview();

    expect(await liveOf([op1, op2])).toEqual({ [op2.nik]: uB.id });
  });
});

describe("POST /plan/reset", () => {
  test("view may not reset", async () => {
    await setDefault([[uA.code, op1.nik]]);

    const response = await post("/fleet-allocation/plan/reset", viewer.cookie);

    expect(response.status).toBe(403);
    expect(await liveOf([op1])).toEqual({});
  });

  test("makes live equal the default minus the skipped, and moves holders", async () => {
    await setDefault([
      [uA.code, op1.nik],
      [uA.code, op2.nik],
      [uB.code, opSkilled.nik],
      [uC.code, opLeaver.nik],
    ]);
    await pairLive(uC, op1); //   holds another unit: released from it, then placed
    await pairLive(uB, op3); //   not in the default: released
    await pairLive(uB, op4); //   not in the default: released
    await db
      .update(schema.employees)
      .set({ status: "nonaktif" })
      .where(eq(schema.employees.id, opLeaver.id));

    const response = await post("/fleet-allocation/plan/reset");
    expect(response.status).toBe(200);
    const result = (await response.json()) as PlanResetResult;

    expect(result.released).toBe(3);
    expect(result.assigned).toBe(3);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      unit: uC.code,
      nik: opLeaver.nik,
    });
    expect(await liveOf([op1, op2, op3, op4, opSkilled, opLeaver])).toEqual({
      [op1.nik]: uA.id,
      [op2.nik]: uA.id,
      [opSkilled.nik]: uB.id,
    });
  });

  test("writes history with source reset, releases before assigns", async () => {
    await setDefault([[uA.code, op1.nik]]);
    await pairLive(uC, op1);
    await pairLive(uB, op3);

    await post("/fleet-allocation/plan/reset");

    const trail = await db
      .select({
        unitId: schema.fleetPlanHistory.unitId,
        employeeId: schema.fleetPlanHistory.employeeId,
        action: schema.fleetPlanHistory.action,
        actorUserId: schema.fleetPlanHistory.actorUserId,
      })
      .from(schema.fleetPlanHistory)
      .where(
        and(
          inArray(schema.fleetPlanHistory.unitId, made.units),
          eq(schema.fleetPlanHistory.source, "reset")
        )
      )
      .orderBy(schema.fleetPlanHistory.createdAt);
    // Releases first (their order among themselves is not the point), then
    // the assignment.
    expect(trail.map((r) => r.action)).toEqual([
      "released",
      "released",
      "assigned",
    ]);
    const releases = trail.slice(0, 2);
    expect(releases).toContainEqual({
      unitId: uC.id,
      employeeId: op1.id,
      action: "released",
      actorUserId: admin.id,
    });
    expect(releases).toContainEqual({
      unitId: uB.id,
      employeeId: op3.id,
      action: "released",
      actorUserId: admin.id,
    });
    expect(trail[2]).toEqual({
      unitId: uA.id,
      employeeId: op1.id,
      action: "assigned",
      actorUserId: admin.id,
    });
  });

  test("a second reset changes nothing", async () => {
    await setDefault([
      [uA.code, op1.nik],
      [uB.code, op2.nik],
    ]);
    await pairLive(uC, op3);
    await post("/fleet-allocation/plan/reset");
    const liveAfterFirst = await liveOf([op1, op2, op3]);
    const historyAfterFirst = await db
      .select({ id: schema.fleetPlanHistory.id })
      .from(schema.fleetPlanHistory)
      .where(inArray(schema.fleetPlanHistory.unitId, made.units));

    const response = await post("/fleet-allocation/plan/reset");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      released: 0,
      assigned: 0,
      skipped: [],
    });
    expect(await liveOf([op1, op2, op3])).toEqual(liveAfterFirst);
    const historyAfterSecond = await db
      .select({ id: schema.fleetPlanHistory.id })
      .from(schema.fleetPlanHistory)
      .where(inArray(schema.fleetPlanHistory.unitId, made.units));
    expect(historyAfterSecond).toHaveLength(historyAfterFirst.length);
  });
});
