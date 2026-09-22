/**
 * The PLAN pairing history: every assign and release on the board leaves a
 * row, a refused one leaves none, and the history route reads them back
 * newest first.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/fleet-allocation-history.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { fleetAllocationRoutes } from "./fleet-allocation";

const app = new Elysia().use(fleetAllocationRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji PlanHist ${uid()}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  employees: [] as string[],
  units: [] as string[],
  positions: [] as string[],
  departments: [] as string[],
  companies: [] as string[],
  catalogues: [] as string[],
};

let admin: { id: string; cookie: string; name: string };
let viewer: { cookie: string };

type Person = { id: string; nik: string; name: string };
let opA: Person;
let opB: Person;
let opC: Person;
let opGone: Person;

type Unit = { id: string; code: string };
let unitMain: Unit;
let unitFull: Unit;
let unitQuiet: Unit;
let unitGone: Unit;

let fleetId = "";

type HistoryRow = {
  id: string;
  action: "assigned" | "released";
  source: "board" | "import" | "migration";
  nik: string;
  name: string;
  actorName: string | null;
  createdAt: string;
};

/* ------------------------------------------------------------- fixtures */

async function makeUser(mode: "view" | "manage") {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-planhist-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values([{ roleId: role!.id, menuSlug: "fleet-allocation", mode }]);
  const name = `${tag} ${mode}`;
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-${uid()}@uji.local`,
      name,
      passwordHash: "x",
      roleId: role!.id,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  return { id: user!.id, name, cookie: `${SESSION_COOKIE}=${session.id}` };
}

const send = (method: string, path: string, cookie: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: body
        ? { cookie, "content-type": "application/json" }
        : { cookie },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  );

const pair = (unit: Unit, person: Person) =>
  send("POST", "/fleet-allocation/plan/slots", admin.cookie, {
    unitCode: unit.code,
    nik: person.nik,
  });

const release = (unit: Unit, person: Person) =>
  send(
    "DELETE",
    `/fleet-allocation/plan/slots/${unit.code}/${person.nik}`,
    admin.cookie
  );

const historyPath = (code: string) =>
  `/fleet-allocation/plan/units/${encodeURIComponent(code)}/history`;

async function historyOf(unit: Unit, cookie = admin.cookie) {
  const response = await send("GET", historyPath(unit.code), cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as HistoryRow[];
}

beforeAll(async () => {
  // scheduler.test.ts disconnects the shared client in its teardown, and bun
  // runs every file in one process.
  if (redis.status === "end") await redis.connect();

  admin = await makeUser("manage");
  viewer = await makeUser("view");

  const [company] = await db
    .insert(schema.companies)
    .values({ name: tag, code: `ZH${uid()}` })
    .returning({ id: schema.companies.id });
  made.companies.push(company!.id);
  const [dept] = await db
    .insert(schema.departments)
    .values({ name: `${tag} A`, companyId: company!.id })
    .returning({ id: schema.departments.id });
  made.departments.push(dept!.id);
  const [position] = await db
    .insert(schema.positions)
    .values({
      name: `${tag} OP`,
      departmentId: dept!.id,
      fleetAllocation: true,
    })
    .returning({ id: schema.positions.id });
  made.positions.push(position!.id);

  const employee = async (label: string): Promise<Person> => {
    const nik = `ZZH${uid()}`;
    const name = `${tag} ${label}`;
    const [row] = await db
      .insert(schema.employees)
      .values({
        nik,
        name,
        companyId: company!.id,
        departmentId: dept!.id,
        positionId: position!.id,
      })
      .returning({ id: schema.employees.id });
    made.employees.push(row!.id);
    return { id: row!.id, nik, name };
  };
  opA = await employee("Alpha");
  opB = await employee("Bravo");
  opC = await employee("Charlie");
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

  const unitRow = async (breakdown = false) => {
    const [row] = await db
      .insert(schema.units)
      .values({
        code: `ZZHU${uid()}`,
        classId: cls!.id,
        typeId: typ!.id,
        modelId: mdl!.id,
        brandId: brd!.id,
        breakdown,
      })
      .returning({ id: schema.units.id, code: schema.units.code });
    made.units.push(row!.id);
    return { id: row!.id, code: row!.code };
  };

  // A broken-down digger to lead the formation the fixture units haul for.
  const leader = await unitRow(true);
  const [fleet] = await db
    .insert(schema.fleets)
    .values({ leaderUnitId: leader.id })
    .returning({ id: schema.fleets.id });
  fleetId = fleet!.id;
  const unit = async () => {
    const row = await unitRow();
    await db.insert(schema.fleetUnits).values({ fleetId, unitId: row.id });
    return row;
  };
  unitMain = await unit();
  unitFull = await unit();
  unitQuiet = await unit();
  unitGone = await unit();
});

afterAll(async () => {
  if (made.units.length)
    await db
      .delete(schema.fleetPlanHistory)
      .where(inArray(schema.fleetPlanHistory.unitId, made.units));
  if (made.employees.length) {
    await db
      .delete(schema.fleetPlanSlots)
      .where(inArray(schema.fleetPlanSlots.employeeId, made.employees));
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
  }
  if (fleetId)
    await db.delete(schema.fleets).where(eq(schema.fleets.id, fleetId));
  if (made.units.length) {
    await db
      .delete(schema.fleetUnits)
      .where(inArray(schema.fleetUnits.unitId, made.units));
    await db.delete(schema.units).where(inArray(schema.units.id, made.units));
  }
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

/* ---------------------------------------------------------------- writes */

describe("a pairing change on the board leaves a trail", () => {
  test("assigning records who, by whom, from the board", async () => {
    expect((await pair(unitMain, opA)).status).toBe(201);

    const rows = await historyOf(unitMain);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "assigned",
      source: "board",
      nik: opA.nik,
      name: opA.name,
      actorName: admin.name,
    });
  });

  test("releasing records the operator taken off, newest first", async () => {
    expect((await release(unitMain, opA)).status).toBe(200);
    expect((await pair(unitMain, opB)).status).toBe(201);

    const rows = await historyOf(unitMain);
    expect(rows.map((r) => [r.action, r.nik])).toEqual([
      ["assigned", opB.nik],
      ["released", opA.nik],
      ["assigned", opA.nik],
    ]);
    expect(rows[1]!.actorName).toBe(admin.name);
  });

  test("a refused assignment writes nothing", async () => {
    expect((await pair(unitFull, opC)).status).toBe(201);
    expect((await pair(unitFull, opA)).status).toBe(201);
    const before = await historyOf(unitFull);

    // Third operator on a two-operator unit.
    const refused = await pair(unitFull, opGone);
    expect(refused.status).toBe(409);

    expect(await historyOf(unitFull)).toEqual(before);
  });

  test("a release of a pairing that does not exist writes nothing", async () => {
    const response = await release(unitQuiet, opA);
    expect(response.status).toBe(404);
    expect(await historyOf(unitQuiet)).toEqual([]);
  });

  test("the operator's name outlives their employee record", async () => {
    expect((await pair(unitGone, opGone)).status).toBe(201);
    expect((await release(unitGone, opGone)).status).toBe(200);

    await db.delete(schema.employees).where(eq(schema.employees.id, opGone.id));
    made.employees = made.employees.filter((id) => id !== opGone.id);

    const rows = await historyOf(unitGone);
    expect(rows.map((r) => [r.action, r.nik, r.name])).toEqual([
      ["released", opGone.nik, opGone.name],
      ["assigned", opGone.nik, opGone.name],
    ]);
  });
});

/* ------------------------------------------------------------------ read */

describe("reading a unit's pairing history", () => {
  test("a unit with no history has none, not an error", async () => {
    expect(await historyOf(unitQuiet)).toEqual([]);
  });

  test("a deactivated unit keeps its history readable", async () => {
    // Deactivating is how a unit with a past leaves service — its history
    // blocks deletion — so the trail has to stay reachable afterwards.
    await db
      .update(schema.units)
      .set({ active: false })
      .where(eq(schema.units.id, unitGone.id));
    try {
      const rows = await historyOf(unitGone);
      expect(rows.map((r) => r.action)).toEqual(["released", "assigned"]);
    } finally {
      await db
        .update(schema.units)
        .set({ active: true })
        .where(eq(schema.units.id, unitGone.id));
    }
  });

  test("an unknown unit is a 404", async () => {
    const response = await send(
      "GET",
      historyPath("ZZ-NO-SUCH-UNIT"),
      admin.cookie
    );
    expect(response.status).toBe(404);
  });

  test("view access may read it", async () => {
    const rows = await historyOf(unitMain, viewer.cookie);
    expect(rows.length).toBeGreaterThan(0);
  });

  test("an anonymous caller is told to log in", async () => {
    const response = await app.handle(
      new Request(`http://localhost${historyPath(unitMain.code)}`)
    );
    expect(response.status).toBe(401);
  });
});
