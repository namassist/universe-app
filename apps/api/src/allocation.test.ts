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
import { and, eq, inArray } from "drizzle-orm";

import type { EmployeeStatus } from "@universe/contracts";

import { buildBoard, storeBoard } from "./allocation";
import { pairingRefusal } from "./routes/fleet-allocation";
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

/**
 * One formation every fixture unit hauls for.
 *
 * Allocation is scoped to units that belong to a formation, so a unit created
 * outside one is invisible to the engine — correctly, and unhelpfully for a
 * test about the engine. The digger and the area live for the whole suite
 * because they are scaffolding rather than subject matter; the haulers come
 * and go with each test.
 */
let fleetId: string, fleetLeader: string;

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
  status?: EmployeeStatus;
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
  /* Allocation is scoped to formations, so a fixture unit hauls for the
     suite's fleet. Without this it is simply not on any board and every
     assertion below would be about an empty list. Scoping itself is pinned
     separately. */
  await db.insert(schema.fleetUnits).values({ fleetId, unitId: row!.id });
  /* Members carry their formation's area, because the area lives on the unit
     since 2026-09-04 and a formation's is its leader's. */
  await db
    .update(schema.units)
    .set({ workArea: `${tag} Pit` })
    .where(eq(schema.units.id, row!.id));
  return row!.id;
}

/**
 * A unit that belongs to no formation — Fleet Setting's no-fleet entry.
 *
 * Deliberately not a hauler: what these tests pin is that such a unit gets no
 * slot of its own, while the operator who holds it standing is still useful.
 */
async function addLooseUnit(code: string) {
  const [row] = await db
    .insert(schema.units)
    .values({ code, classId: cls, typeId: typ, modelId: mdl, brandId: brd })
    .returning({ id: schema.units.id });
  made.units.push(row!.id);
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

  /* The suite's formation. Its digger is a unit like any other, but it is not
     in `made.units` — that list is emptied after every test, and the fleet
     that references the digger would block its deletion. */
  const [digger] = await db
    .insert(schema.units)
    .values({
      code: `${tag}-EX`,
      classId: cls,
      typeId: typ,
      modelId: mdl,
      brandId: brd,
      /* Standby, so the scaffolding never becomes a competitor: the engine
         skips standby units, and without this the digger is an unplanned
         vacancy that sorts ahead of `-U1` by code and takes the spare the test
         is actually about. */
      standby: true,
    })
    .returning({ id: schema.units.id });
  fleetLeader = digger!.id;
  const [fleet] = await db
    .insert(schema.fleets)
    .values({ leaderUnitId: fleetLeader })
    .returning({ id: schema.fleets.id });
  fleetId = fleet!.id;
  await db
    .update(schema.units)
    .set({ workArea: `${tag} Pit` })
    .where(eq(schema.units.id, fleetLeader));
});

afterAll(async () => {
  /* The formation first: the fleet references the digger with `restrict`, and
     the digger references the catalogues this block goes on to delete. */
  if (fleetId)
    await db.delete(schema.fleets).where(eq(schema.fleets.id, fleetId));
  if (fleetLeader) {
    await db
      .delete(schema.fleetActualSlots)
      .where(eq(schema.fleetActualSlots.unitId, fleetLeader));
    await db.delete(schema.units).where(eq(schema.units.id, fleetLeader));
  }

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
  // Before the units: `fleet_units.unit_id` is `restrict`.
  await db
    .delete(schema.fleetUnits)
    .where(inArray(schema.fleetUnits.unitId, made.units));
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

describe("employment status is the first gate", () => {
  /*
   * Only `aktif` is allocatable (owner, 2026-09-03). `standby` is on the
   * payroll but not to be given a unit, and the roster does not know that —
   * these two pin that a full day's evidence (rostered, tapped in time, FTW
   * filed) still does not put such a person on a machine.
   */
  for (const status of ["standby", "nonaktif"] as const) {
    test(`a ${status} operator loses their own unit, however well they tapped`, async () => {
      const date = nextDate();
      const nik = newNik();
      const person = await addEmployee({ nik, status });
      const unit = await addUnit({ code: `${tag}-S${status[0]!}1` });
      await roster(date, person, "D");
      await plan(unit, person);
      await tapAt(date, nik, "05:01:00");

      const slot = (await mine(date)).find((s) => s.unitId === unit);
      expect(slot?.employeeId).toBeNull();
      // Not "late", not "missing" — they were never judged. The status gate
      // runs before readiness, so there is no readiness to report.
      expect(slot?.readiness).toBeNull();
    });

    test(`nor can a ${status} operator fill a vacancy as a spare`, async () => {
      const date = nextDate();
      const unit = await addUnit({ code: `${tag}-S${status[0]!}2` });

      const nik = newNik();
      const person = await addEmployee({ nik, status });
      await roster(date, person, "D");
      await tapAt(date, nik, "04:00:00");

      expect(
        (await mine(date)).find((s) => s.unitId === unit)?.employeeId
      ).toBeNull();
    });
  }

  test("a standby operator is refused by name when assigned by hand", async () => {
    const person = {
      id: "x",
      nik: "1",
      name: "x",
      statusValue: "standby" as const,
      departmentId: deptA,
      simperExp: null,
      positionName: "Driver OHT",
      fleetAllocation: true,
    };
    const refusal = pairingRefusal(
      {
        id: "u",
        code: "U",
        departmentId: null,
        departmentName: null,
        simperCodeId: null,
        simperCodeName: null,
      },
      person,
      { holdsCode: false, today: "2026-09-03" }
    );
    // The message names the status: "standby" and "nonaktif" call for
    // different follow-ups, and "sudah tidak aktif" would misreport the first.
    expect(refusal).toContain("standby");
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

describe("an unattached spare outranks a standing operator", () => {
  test("even when the standing operator tapped first", async () => {
    /* Owner, 2026-09-01. Both are unattached today, but not for the same
       reason: A holds 4090 (broken down), B holds nothing anywhere. Seating A
       on someone else's unit is the expensive placement — when 4090 comes
       back, taking it means pulling A off a seat and opening a fresh vacancy
       mid-shift, which nothing here handles. So B goes first, despite tapping
       22 minutes later. */
    const date = nextDate();

    const nikA = newNik();
    const opA = await addEmployee({ nik: nikA });
    const broken = await addUnit({ code: `${tag}-B90`, breakdown: true });
    await plan(broken, opA);
    await roster(date, opA, "D");
    await tapAt(date, nikA, "04:48:00");

    const nikB = newNik();
    const opB = await addEmployee({ nik: nikB });
    await roster(date, opB, "D");
    await tapAt(date, nikB, "05:10:00");

    const onLeave = await addEmployee({ nik: newNik() });
    const vacant = await addUnit({ code: `${tag}-B28` });
    await plan(vacant, onLeave);

    const slots = await mine(date);
    // The broken unit is not a slot at all: it needs no operator, so it is not
    // a vacancy either — which is exactly why its holder is loose.
    expect(slots.find((s) => s.unitId === broken)).toBeUndefined();

    const seat = slots.find((s) => s.unitId === vacant);
    expect(seat?.employeeId).toBe(opB);
    expect(seat?.source).toBe("spare");
  });

  test("but a standing operator still takes a seat nobody else can", async () => {
    /* Ordering, never filtering. The unattached spare here lacks the SIMPER
       the unit demands, so the seat falls to the standing operator rather than
       standing empty — which would cost far more than the reshuffle the rule
       is avoiding. */
    const date = nextDate();
    const [code] = await db
      .insert(schema.simperCodes)
      .values({ name: `${tag} SKILL` })
      .returning({ id: schema.simperCodes.id });
    made.simperCodes.push(code!.id);

    const nikA = newNik();
    const opA = await addEmployee({ nik: nikA });
    await db
      .insert(schema.employeeSkills)
      .values({ employeeId: opA, simperCodeId: code!.id });
    const broken = await addUnit({ code: `${tag}-B91`, breakdown: true });
    await plan(broken, opA);
    await roster(date, opA, "D");
    await tapAt(date, nikA, "04:48:00");

    // Unattached, earlier tap, and still not a candidate: no such skill.
    const nikB = newNik();
    const opB = await addEmployee({ nik: nikB });
    await roster(date, opB, "D");
    await tapAt(date, nikB, "04:10:00");

    const onLeave = await addEmployee({ nik: newNik() });
    const vacant = await addUnit({
      code: `${tag}-B29`,
      simperCodeId: code!.id,
    });
    await plan(vacant, onLeave);

    const seat = (await mine(date)).find((s) => s.unitId === vacant);
    expect(seat?.employeeId).toBe(opA);
  });
});

describe("a unit outside every formation", () => {
  test("gets no slot of its own", async () => {
    const date = nextDate();
    const nik = newNik();
    const person = await addEmployee({ nik });
    const loose = await addLooseUnit(`${tag}-NF1`);
    await roster(date, person, "D");
    await plan(loose, person);
    await tapAt(date, nik, "04:05:00");

    // The engine allocates formations. A machine in none of them is not on
    // the board at all — not as a filled slot, and not as an idle one.
    expect((await mine(date)).find((s) => s.unitId === loose)).toBeUndefined();
  });

  test("leaves its standing operator free to fill a formation's vacancy", async () => {
    /* The reason the two scopes differ. A standing pairing on a unit with no
       formation is still a real fact, but it holds nobody back: the operator
       is a spare, and a spare is exactly what an empty seat in a fleet
       needs. */
    const date = nextDate();
    const looseNik = newNik();
    const looseOp = await addEmployee({ nik: looseNik });
    const loose = await addLooseUnit(`${tag}-NF2`);
    await roster(date, looseOp, "D");
    await plan(loose, looseOp);
    await tapAt(date, looseNik, "04:02:00");

    // A fleet unit whose own planned operator never turned up.
    const absentNik = newNik();
    const absent = await addEmployee({ nik: absentNik });
    const inFleet = await addUnit({ code: `${tag}-NF3` });
    await roster(date, absent, "D");
    await plan(inFleet, absent);
    await tapAt(date, absentNik, null);

    const slot = (await mine(date)).find((s) => s.unitId === inFleet);
    expect(slot?.employeeId).toBe(looseOp);
    expect(slot?.source).toBe("spare");
  });

  test("its operator still has to be on the roster", async () => {
    // Being a spare is not a way around the roster: someone not rostered to
    // this shift is not a candidate at all, however free their unit leaves
    // them.
    const date = nextDate();
    const offNik = newNik();
    const offToday = await addEmployee({ nik: offNik });
    const loose = await addLooseUnit(`${tag}-NF4`);
    await plan(loose, offToday);
    await tapAt(date, offNik, "04:01:00");

    const absentNik = newNik();
    const absent = await addEmployee({ nik: absentNik });
    const inFleet = await addUnit({ code: `${tag}-NF5` });
    await roster(date, absent, "D");
    await plan(inFleet, absent);
    await tapAt(date, absentNik, null);

    const slot = (await mine(date)).find((s) => s.unitId === inFleet);
    expect(slot?.employeeId).toBeNull();
  });

  test("a formation's own operator is served before any spare", async () => {
    const date = nextDate();
    const looseNik = newNik();
    const looseOp = await addEmployee({ nik: looseNik });
    const loose = await addLooseUnit(`${tag}-NF6`);
    await roster(date, looseOp, "D");
    await plan(loose, looseOp);
    // Tapped first, so first-come-first-served would hand them the unit if
    // the planned holder were not privileged over spares.
    await tapAt(date, looseNik, "04:00:00");

    const heldNik = newNik();
    const holder = await addEmployee({ nik: heldNik });
    const inFleet = await addUnit({ code: `${tag}-NF7` });
    await roster(date, holder, "D");
    await plan(inFleet, holder);
    await tapAt(date, heldNik, "04:30:00");

    const slot = (await mine(date)).find((s) => s.unitId === inFleet);
    expect(slot?.employeeId).toBe(holder);
    expect(slot?.source).toBe("plan");
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

  /**
   * A board records a shift that has already happened; Fleet Setting records
   * today. Reading the second through the first is what let an evening
   * reshuffle erase the morning board from the wall and relabel it with an
   * evening work area — a board that reads as correct and is not.
   */
  test("copies the formation onto the board rather than referencing it", async () => {
    const date = nextDate();
    await addUnit({ code: `${tag}-S1` });
    const doc = await storeBoard(
      await buildBoard(date, "day", DEADLINE, FTW_CLOSE)
    );
    made.docs.push(doc);

    const [snap] = await db
      .select()
      .from(schema.fleetActualFleets)
      .where(
        and(
          eq(schema.fleetActualFleets.documentId, doc),
          eq(schema.fleetActualFleets.leaderCode, `${tag}-EX`)
        )
      );
    // The words, not a pointer to where the words currently live.
    expect(snap?.workArea).toBe(`${tag} Pit`);
    expect(snap?.sourceFleetId).toBe(fleetId);

    const stored = await db
      .select()
      .from(schema.fleetActualSlots)
      .where(eq(schema.fleetActualSlots.documentId, doc));
    const mineOnly = stored.filter((r) => made.units.includes(r.unitId));
    expect(mineOnly.length).toBeGreaterThan(0);
    // Every unit on the board is filed under a formation of *this* board.
    for (const row of mineOnly) expect(row.boardFleetId).toBe(snap!.id);
  });

  test("keeps the formation after Fleet Setting disbands it", async () => {
    const date = nextDate();
    /* A formation of its own, disbanded mid-test — the admin who sets up five
       fleets in the morning and three different ones at night. */
    const [digger] = await db
      .insert(schema.units)
      .values({
        code: `${tag}-EVE`,
        classId: cls,
        typeId: typ,
        modelId: mdl,
        brandId: brd,
      })
      .returning({ id: schema.units.id });
    made.units.push(digger!.id);
    await db
      .update(schema.units)
      .set({ workArea: `${tag} Panel Malam` })
      .where(eq(schema.units.id, digger!.id));
    const [evening] = await db
      .insert(schema.fleets)
      .values({ leaderUnitId: digger!.id })
      .returning({ id: schema.fleets.id });

    const doc = await storeBoard(
      await buildBoard(date, "day", DEADLINE, FTW_CLOSE)
    );
    made.docs.push(doc);
    await db.delete(schema.fleets).where(eq(schema.fleets.id, evening!.id));

    const [snap] = await db
      .select()
      .from(schema.fleetActualFleets)
      .where(
        and(
          eq(schema.fleetActualFleets.documentId, doc),
          eq(schema.fleetActualFleets.leaderCode, `${tag}-EVE`)
        )
      );
    /* The formation is gone from Fleet Setting and the board still knows where
       that unit worked. `source_fleet_id` is `set null`, so the breadcrumb
       goes and the record does not. */
    expect(snap).toBeDefined();
    expect(snap!.workArea).toBe(`${tag} Panel Malam`);
    expect(snap!.sourceFleetId).toBeNull();

    const [slot] = await db
      .select()
      .from(schema.fleetActualSlots)
      .where(
        and(
          eq(schema.fleetActualSlots.documentId, doc),
          eq(schema.fleetActualSlots.unitId, digger!.id)
        )
      );
    expect(slot?.boardFleetId).toBe(snap!.id);
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
