/**
 * The engine, over a fixture site built row by row.
 *
 * Every assertion here is about a decision that costs something in the yard:
 * a unit left without an operator, a spare who should have filled it and did
 * not, or one placed on a machine they may not drive. The pass rule itself is
 * pinned in `readiness.test.ts`; what this file tests is what the engine does
 * with the verdict.
 *
 *   bun --env-file=.env test src/allocation.test.ts
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { buildBoard, storeBoard } from "./allocation";
import { db, schema } from "./db";
import { redis } from "./redis";

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Alokasi ${uid()}`;
const FTW_CLOSE = "04:45:00";
const DEADLINE = "05:15:00";

/**
 * A date per test, not one shared by all of them.
 *
 * The engine reads the whole site: every candidate rostered to the shift is in
 * the pool, including the ones an earlier test created. Sharing a date made
 * three tests pass or fail on the order they happened to run in — a spare left
 * behind by an earlier case took the vacancy this one was about. Isolation
 * here is a date, because a date is what the engine keys on.
 */
const dates: string[] = [];
function nextDate(): string {
  const date = `1999-03-${String(dates.length + 1).padStart(2, "0")}`;
  dates.push(date);
  return date;
}

const made = {
  employees: [] as string[],
  units: [] as string[],
  docs: [] as string[],
  positions: [] as string[],
  departments: [] as string[],
  companies: [] as string[],
  simperCodes: [] as string[],
  catalogues: [] as string[],
};

/** unit_class / type / model / brand — required, and uninteresting here. */
let cls: string, typ: string, mdl: string, brd: string;

let deptA: string, deptB: string, posAlloc: string, posOther: string;
let codeA: string;

/** NIKs are the join key to the snapshots; keep them digits-only and unique. */
let nextNik = 990000001;
const newNik = () => String(nextNik++);

async function addEmployee(input: {
  nik: string;
  departmentId?: string;
  positionId?: string;
  simperExp?: string | null;
  status?: "aktif" | "nonaktif";
}) {
  const [row] = await db
    .insert(schema.employees)
    .values({
      nik: input.nik,
      name: `${tag} ${input.nik}`,
      companyId: made.companies[0]!,
      departmentId: input.departmentId ?? deptA,
      positionId: input.positionId ?? posAlloc,
      simperExp: input.simperExp ?? null,
      status: input.status ?? "aktif",
    })
    .returning({ id: schema.employees.id });
  made.employees.push(row!.id);
  return row!.id;
}

async function addUnit(input: {
  code: string;
  ftw?: boolean;
  departmentId?: string | null;
  simperCodeId?: string | null;
  breakdown?: boolean;
  standby?: boolean;
}) {
  const [row] = await db
    .insert(schema.units)
    .values({
      code: input.code,
      classId: cls,
      typeId: typ,
      modelId: mdl,
      brandId: brd,
      ftw: input.ftw ?? false,
      departmentId: input.departmentId ?? null,
      simperCodeId: input.simperCodeId ?? null,
      breakdown: input.breakdown ?? false,
      standby: input.standby ?? false,
    })
    .returning({ id: schema.units.id });
  made.units.push(row!.id);
  /* Allocation is scoped to units Fleet Setting configured, so a fixture unit
     joins the no-fleet entry — the same way a real grader with no formation
     gets on the board. Scoping itself is pinned separately. */
  await db.insert(schema.noFleetUnits).values({ unitId: row!.id });
  return row!.id;
}

const roster = (date: string, employeeId: string, code: "D" | "N") =>
  db
    .insert(schema.rosterDays)
    .values({ documentId: rosterDoc, employeeId, date, code });

const plan = (unitId: string, employeeId: string) =>
  db.insert(schema.fleetPlanSlots).values({ unitId, employeeId });

const tapAt = (date: string, nik: string, time: string | null) =>
  db
    .insert(schema.fingerReadings)
    .values({ nik, date, firstInAt: time ? `${date} ${time}` : null });

const ftwOk = (date: string, nik: string) =>
  db.insert(schema.ftwReadings).values({
    nik,
    date,
    name: tag,
    sleepMinutes: 400,
    sleepCategory: "Dapat Bekerja",
    ftwDecision: "FTW aman",
  });

let rosterDoc: string;
let rosterDocUser: string;

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();

  const [company] = await db
    .insert(schema.companies)
    .values({ name: `${tag} PT`, code: `ZZ${uid()}` })
    .returning({ id: schema.companies.id });
  made.companies.push(company!.id);

  const depts = await db
    .insert(schema.departments)
    .values([
      { name: `${tag} Dept A`, companyId: company!.id },
      { name: `${tag} Dept B`, companyId: company!.id },
    ])
    .returning({ id: schema.departments.id });
  [deptA, deptB] = depts.map((d) => d.id) as [string, string];
  made.departments.push(deptA, deptB);

  const positions = await db
    .insert(schema.positions)
    .values([
      { name: `${tag} Operator`, departmentId: deptA, fleetAllocation: true },
      { name: `${tag} Admin`, departmentId: deptA, fleetAllocation: false },
    ])
    .returning({ id: schema.positions.id });
  [posAlloc, posOther] = positions.map((p) => p.id) as [string, string];
  made.positions.push(posAlloc, posOther);

  const [c] = await db
    .insert(schema.unitClasses)
    .values({ name: `${tag} K` })
    .returning({ id: schema.unitClasses.id });
  const [ty] = await db
    .insert(schema.unitTypes)
    .values({ name: `${tag} T` })
    .returning({ id: schema.unitTypes.id });
  const [mo] = await db
    .insert(schema.unitModels)
    .values({ name: `${tag} M` })
    .returning({ id: schema.unitModels.id });
  const [br] = await db
    .insert(schema.unitBrands)
    .values({ name: `${tag} B` })
    .returning({ id: schema.unitBrands.id });
  cls = c!.id;
  typ = ty!.id;
  mdl = mo!.id;
  brd = br!.id;

  const [code] = await db
    .insert(schema.simperCodes)
    .values({ name: `${tag} A2B` })
    .returning({ id: schema.simperCodes.id });
  codeA = code!.id;
  made.simperCodes.push(codeA);

  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-alok-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId: (
        await db.select({ id: schema.roles.id }).from(schema.roles).limit(1)
      )[0]!.id,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  rosterDocUser = user!.id;

  const [doc] = await db
    .insert(schema.rosterDocuments)
    .values({
      departmentId: deptA,
      month: "1999-03-01",
      fileName: `${tag}.xlsx`,
      uploadedBy: rosterDocUser,
    })
    .returning({ id: schema.rosterDocuments.id });
  rosterDoc = doc!.id;
});

afterAll(async () => {
  for (const id of made.docs)
    await db
      .delete(schema.fleetActualDocuments)
      .where(eq(schema.fleetActualDocuments.id, id));
  if (dates.length)
    await db
      .delete(schema.fleetActualDocuments)
      .where(inArray(schema.fleetActualDocuments.date, dates));
  if (made.employees.length) {
    await db
      .delete(schema.fleetPlanSlots)
      .where(inArray(schema.fleetPlanSlots.employeeId, made.employees));
    await db
      .delete(schema.rosterDays)
      .where(inArray(schema.rosterDays.employeeId, made.employees));
  }
  if (dates.length) {
    await db
      .delete(schema.ftwReadings)
      .where(inArray(schema.ftwReadings.date, dates));
    await db
      .delete(schema.fingerReadings)
      .where(inArray(schema.fingerReadings.date, dates));
  }
  if (rosterDoc)
    await db
      .delete(schema.rosterDocuments)
      .where(eq(schema.rosterDocuments.id, rosterDoc));
  if (rosterDocUser)
    await db.delete(schema.users).where(eq(schema.users.id, rosterDocUser));
  if (made.employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
  if (made.simperCodes.length)
    await db
      .delete(schema.simperCodes)
      .where(inArray(schema.simperCodes.id, made.simperCodes));
  if (cls)
    await db.delete(schema.unitClasses).where(eq(schema.unitClasses.id, cls));
  if (typ)
    await db.delete(schema.unitTypes).where(eq(schema.unitTypes.id, typ));
  if (mdl)
    await db.delete(schema.unitModels).where(eq(schema.unitModels.id, mdl));
  if (brd)
    await db.delete(schema.unitBrands).where(eq(schema.unitBrands.id, brd));
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

/**
 * Each test's units and plan slots, torn down after it.
 *
 * `fleet_plan_slots` carries no date — the plan is *standing*, so every unit in
 * it appears on every board, on every date. Giving each test its own date
 * therefore isolates the people but not the units: a vacancy left by an earlier
 * test sorts ahead by unit code and takes the spare this test is about. That is
 * the engine behaving correctly; it is the fixture that has to clean up.
 */
afterEach(async () => {
  if (!made.units.length) return;
  await db
    .delete(schema.fleetActualSlots)
    .where(inArray(schema.fleetActualSlots.unitId, made.units));
  await db
    .delete(schema.fleetPlanSlots)
    .where(inArray(schema.fleetPlanSlots.unitId, made.units));
  await db
    .delete(schema.noFleetUnits)
    .where(inArray(schema.noFleetUnits.unitId, made.units));
  await db.delete(schema.units).where(inArray(schema.units.id, made.units));
  made.units.length = 0;
});

/** Only the units this test built — the dev database holds a real fleet too. */
const mine = async (date: string, shift: "day" | "night" = "day") => {
  const board = await buildBoard(date, shift, DEADLINE, FTW_CLOSE);
  return board.slots.filter((s) => made.units.includes(s.unitId));
};

describe("the planned operator", () => {
  test("keeps the unit when they pass", async () => {
    const date = nextDate();
    const nik = newNik();
    const person = await addEmployee({ nik });
    const unit = await addUnit({ code: `${tag}-U1` });
    await roster(date, person, "D");
    await plan(unit, person);
    await tapAt(date, nik, "05:01:00");

    const slot = (await mine(date)).find((s) => s.unitId === unit);
    expect(slot?.employeeId).toBe(person);
    expect(slot?.source).toBe("plan");
    expect(slot?.tappedAt).toBe("05:01:00");
  });

  test("loses it when they tap after the deadline, and the unit stands empty", async () => {
    const date = nextDate();
    const nik = newNik();
    const person = await addEmployee({ nik });
    const unit = await addUnit({ code: `${tag}-U2` });
    await roster(date, person, "D");
    await plan(unit, person);
    await tapAt(date, nik, "05:40:00");

    const slot = (await mine(date)).find((s) => s.unitId === unit);
    expect(slot?.employeeId).toBeNull();
    expect(slot?.readiness?.finger).toBe("late");
  });

  test("is not considered when the roster puts them on the other shift", async () => {
    const date = nextDate();
    const nik = newNik();
    const person = await addEmployee({ nik });
    const unit = await addUnit({ code: `${tag}-U3` });
    await roster(date, person, "N");
    await plan(unit, person);
    await tapAt(date, nik, "05:01:00");

    const slot = (await mine(date, "day")).find((s) => s.unitId === unit);
    expect(slot?.employeeId).toBeNull();
  });
});

describe("a unit the plan says nothing about", () => {
  test("is on the board as a vacancy — PLAN says who usually drives a unit, not which units exist", async () => {
    const date = nextDate();
    // No plan slot at all. Building the board from `fleet_plan_slots` hid
    // exactly these units, and they are the ones most in need of a spare: a
    // unit with no standing operator is idle by default, not by accident.
    const unit = await addUnit({ code: `${tag}-U14` });

    const slot = (await mine(date)).find((s) => s.unitId === unit);
    expect(slot).toBeDefined();
    expect(slot!.employeeId).toBeNull();
  });

  test("is crewed from the spare pool like any other vacancy", async () => {
    const date = nextDate();
    const unit = await addUnit({ code: `${tag}-U15` });
    const nik = newNik();
    const spare = await addEmployee({ nik });
    await roster(date, spare, "D");
    await tapAt(date, nik, "04:20:00");

    const slot = (await mine(date)).find((s) => s.unitId === unit);
    expect(slot?.employeeId).toBe(spare);
    expect(slot?.source).toBe("spare");
  });
});

describe("units that need no operator", () => {
  test("a unit in breakdown is not on the board at all", async () => {
    const date = nextDate();
    const nik = newNik();
    const person = await addEmployee({ nik });
    const unit = await addUnit({ code: `${tag}-U4`, breakdown: true });
    await roster(date, person, "D");
    await plan(unit, person);
    await tapAt(date, nik, "05:01:00");

    expect((await mine(date)).find((s) => s.unitId === unit)).toBeUndefined();
  });

  test("nor a unit on standby", async () => {
    const date = nextDate();
    const nik = newNik();
    const person = await addEmployee({ nik });
    const unit = await addUnit({ code: `${tag}-U5`, standby: true });
    await roster(date, person, "D");
    await plan(unit, person);
    await tapAt(date, nik, "05:01:00");

    expect((await mine(date)).find((s) => s.unitId === unit)).toBeUndefined();
  });
});

describe("FTW, where the unit asks for it", () => {
  test("a unit requiring FTW refuses an operator with no FTW row", async () => {
    const date = nextDate();
    const nik = newNik();
    const person = await addEmployee({ nik });
    const unit = await addUnit({ code: `${tag}-U6`, ftw: true });
    await roster(date, person, "D");
    await plan(unit, person);
    await tapAt(date, nik, "05:01:00");

    const slot = (await mine(date)).find((s) => s.unitId === unit);
    expect(slot?.employeeId).toBeNull();
    expect(slot?.readiness?.ftw).toBe("missing");
  });

  test("and accepts them once it is there", async () => {
    const date = nextDate();
    const nik = newNik();
    const person = await addEmployee({ nik });
    const unit = await addUnit({ code: `${tag}-U7`, ftw: true });
    await roster(date, person, "D");
    await plan(unit, person);
    await tapAt(date, nik, "05:01:00");
    await ftwOk(date, nik);

    expect((await mine(date)).find((s) => s.unitId === unit)?.employeeId).toBe(
      person
    );
  });

  test("a unit not requiring FTW takes the same person without one", async () => {
    const date = nextDate();
    const nik = newNik();
    const person = await addEmployee({ nik });
    const unit = await addUnit({ code: `${tag}-U8`, ftw: false });
    await roster(date, person, "D");
    await plan(unit, person);
    await tapAt(date, nik, "05:01:00");

    expect((await mine(date)).find((s) => s.unitId === unit)?.employeeId).toBe(
      person
    );
  });
});

describe("the spare pool", () => {
  test("fills a vacancy, first come first served", async () => {
    const date = nextDate();
    const absentNik = newNik();
    const absent = await addEmployee({ nik: absentNik });
    const unit = await addUnit({ code: `${tag}-U9` });
    await roster(date, absent, "D");
    await plan(unit, absent);
    await tapAt(date, absentNik, null);

    // Two spares, the later tap first in the table — order must come from the
    // tap, not from whatever the database hands back.
    const lateNik = newNik();
    const late = await addEmployee({ nik: lateNik });
    await roster(date, late, "D");
    await tapAt(date, lateNik, "05:10:00");

    const earlyNik = newNik();
    const early = await addEmployee({ nik: earlyNik });
    await roster(date, early, "D");
    await tapAt(date, earlyNik, "04:30:00");

    const slot = (await mine(date)).find((s) => s.unitId === unit);
    expect(slot?.employeeId).toBe(early);
    expect(slot?.source).toBe("spare");
    expect(slot?.tappedAt).toBe("04:30:00");
  });

  test("a spare without the unit's SIMPER code is passed over for one with it", async () => {
    const date = nextDate();
    const absentNik = newNik();
    const absent = await addEmployee({ nik: absentNik });
    const unit = await addUnit({ code: `${tag}-U10`, simperCodeId: codeA });
    await roster(date, absent, "D");
    await plan(unit, absent);
    await tapAt(date, absentNik, null);

    const unskilledNik = newNik();
    const unskilled = await addEmployee({ nik: unskilledNik });
    await roster(date, unskilled, "D");
    await tapAt(date, unskilledNik, "04:00:00");

    const skilledNik = newNik();
    const skilled = await addEmployee({ nik: skilledNik });
    await db
      .insert(schema.employeeSkills)
      .values({ employeeId: skilled, simperCodeId: codeA });
    await roster(date, skilled, "D");
    await tapAt(date, skilledNik, "04:50:00");

    // The unskilled spare tapped first and still does not get it.
    expect((await mine(date)).find((s) => s.unitId === unit)?.employeeId).toBe(
      skilled
    );
  });

  test("a spare from another department cannot take a departmental unit", async () => {
    const date = nextDate();
    const absentNik = newNik();
    const absent = await addEmployee({ nik: absentNik });
    const unit = await addUnit({ code: `${tag}-U11`, departmentId: deptB });
    await roster(date, absent, "D");
    await plan(unit, absent);
    await tapAt(date, absentNik, null);

    const outsiderNik = newNik();
    const outsider = await addEmployee({
      nik: outsiderNik,
      departmentId: deptA,
    });
    await roster(date, outsider, "D");
    await tapAt(date, outsiderNik, "04:00:00");

    expect(
      (await mine(date)).find((s) => s.unitId === unit)?.employeeId
    ).toBeNull();
  });

  test("someone whose position is outside fleet allocation is never a spare", async () => {
    const date = nextDate();
    const absentNik = newNik();
    const absent = await addEmployee({ nik: absentNik });
    const unit = await addUnit({ code: `${tag}-U12` });
    await roster(date, absent, "D");
    await plan(unit, absent);
    await tapAt(date, absentNik, null);

    const clerkNik = newNik();
    const clerk = await addEmployee({ nik: clerkNik, positionId: posOther });
    await roster(date, clerk, "D");
    await tapAt(date, clerkNik, "04:00:00");

    expect(
      (await mine(date)).find((s) => s.unitId === unit)?.employeeId
    ).toBeNull();
  });

  test("one spare fills one unit, not two", async () => {
    const date = nextDate();
    const a = await addUnit({ code: `${tag}-U13a` });
    const b = await addUnit({ code: `${tag}-U13b` });
    for (const unit of [a, b]) {
      const nik = newNik();
      const absent = await addEmployee({ nik });
      await roster(date, absent, "D");
      await plan(unit, absent);
      await tapAt(date, nik, null);
    }
    const spareNik = newNik();
    const spare = await addEmployee({ nik: spareNik });
    await roster(date, spare, "D");
    await tapAt(date, spareNik, "04:05:00");

    const slots = (await mine(date)).filter(
      (s) => s.unitId === a || s.unitId === b
    );
    expect(slots.filter((s) => s.employeeId === spare)).toHaveLength(1);
    expect(slots.filter((s) => s.employeeId === null)).toHaveLength(1);
  });
});

describe("storing it", () => {
  test("writes the board and replaces it on a regeneration", async () => {
    const date = nextDate();
    const board = await buildBoard(date, "day", DEADLINE, FTW_CLOSE);
    const first = await storeBoard(board);
    made.docs.push(first);
    const second = await storeBoard(
      await buildBoard(date, "day", DEADLINE, FTW_CLOSE)
    );
    made.docs.push(second);

    const docs = await db
      .select({ id: schema.fleetActualDocuments.id })
      .from(schema.fleetActualDocuments)
      .where(eq(schema.fleetActualDocuments.date, date));
    // One document per date × shift: regenerating re-answers the same morning
    // rather than filing a second opinion about it.
    expect(docs).toHaveLength(1);
    expect(docs[0]!.id).toBe(second);

    const stored = await db
      .select()
      .from(schema.fleetActualSlots)
      .where(eq(schema.fleetActualSlots.documentId, second));
    expect(stored.length).toBe(board.slots.length);
  });

  test("a regenerated board is identical — placement is deterministic", async () => {
    const date = nextDate();
    const a = await buildBoard(date, "day", DEADLINE, FTW_CLOSE);
    const b = await buildBoard(date, "day", DEADLINE, FTW_CLOSE);
    expect(b.slots.map((s) => [s.unitId, s.employeeId])).toEqual(
      a.slots.map((s) => [s.unitId, s.employeeId])
    );
  });
});
