/**
 * Settling a shift's points onto the ledger.
 *
 * The scoring itself is `points-rules.test.ts`; this is what surrounds it —
 * which unit type a shift is credited to, how the streak carries from one
 * shift to the next, and that settling twice leaves one answer.
 *
 * The ledger half runs against the test database. Dates are 1999, so no real
 * board or roster covers them.
 *
 *   bun --env-file=.env test ./src/points-settle.test.ts
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { eq, inArray } from "drizzle-orm";

import type { AuditLine, AuditRow } from "./board-audit";
import { db, schema } from "./db";
import {
  pointRows,
  previousShift,
  previousStreaks,
  replaceShift,
  settleShift,
  type PointContext,
} from "./points-settle";

function line(
  over: Partial<AuditRow> & Partial<Omit<AuditLine, "row">> = {}
): AuditLine {
  const {
    employeeId = "e-1",
    departmentId = "d-1",
    positionName = "Operator",
    rosterCode = "D",
    busCode = null,
    area = null,
    ...row
  } = over;
  return {
    row: {
      fleetLeaderCode: null,
      fleetSupport: false,
      planUnitCode: null,
      nik: "0501000001",
      name: "Operator",
      skills: [],
      ftw: "pass",
      sentAt: null,
      finger: "pass",
      tappedAt: "05:01:00",
      actualUnitCode: null,
      decision: "kept",
      ...row,
    },
    employeeId,
    departmentId,
    positionName,
    rosterCode,
    busCode,
    area,
  };
}

const context = (over: Partial<PointContext> = {}): PointContext => ({
  sleepByNik: new Map([["501000001", 400]]),
  streakByEmployee: new Map(),
  unitTypeByCode: new Map([
    ["DT1", "t-dump"],
    ["EX1", "t-exca"],
  ]),
  ...over,
});

const KEY = { date: "1999-03-02", shift: "day" } as const;

describe("previousShift: the one a shift-start closes", () => {
  test("the night's start closes that day's day shift", () => {
    expect(previousShift("2026-10-31", "night")).toEqual({
      date: "2026-10-31",
      shift: "day",
    });
  });

  test("the day's start closes the night that began the day before", () => {
    expect(previousShift("2026-11-01", "day")).toEqual({
      date: "2026-10-31",
      shift: "night",
    });
  });

  test("across a month and a year", () => {
    expect(previousShift("2027-01-01", "day")).toEqual({
      date: "2026-12-31",
      shift: "night",
    });
  });
});

describe("pointRows", () => {
  test("a seat is credited to the type of the unit operated", () => {
    const [row] = pointRows(
      KEY,
      [line({ actualUnitCode: "EX1", planUnitCode: "DT1" })],
      context()
    );
    expect(row).toMatchObject({
      date: "1999-03-02",
      shift: "day",
      employeeId: "e-1",
      departmentId: "d-1",
      nik: "0501000001",
      unitCode: "EX1",
      unitTypeId: "t-exca",
      outcome: "operated",
      total: 15,
      streak: 1,
    });
  });

  test("no seat is credited to the standing unit's type", () => {
    const [row] = pointRows(
      KEY,
      [line({ decision: "not-ready", finger: "missing", planUnitCode: "DT1" })],
      context()
    );
    expect(row).toMatchObject({
      unitCode: "DT1",
      unitTypeId: "t-dump",
      outcome: "not-ready",
      total: -15,
    });
  });

  test("no seat and no standing unit: stored with no type", () => {
    /* The leaderboard credits it to the type they operated most that month. */
    const [row] = pointRows(KEY, [line({ decision: "no-seat" })], context());
    expect(row).toMatchObject({
      unitCode: null,
      unitTypeId: null,
      outcome: "stood-down",
    });
  });

  test("sleep is looked up by the normalized NIK", () => {
    const [rested, tired] = pointRows(
      KEY,
      [
        line({ actualUnitCode: "DT1" }),
        line({ employeeId: "e-2", nik: "0501000002", actualUnitCode: "DT1" }),
      ],
      context({
        sleepByNik: new Map([
          ["501000001", 400],
          ["501000002", 340],
        ]),
      })
    );
    expect(rested!.sleep).toBe(3);
    expect(tired!.sleep).toBe(0);
  });

  test("attendance is any IN tap, on time or late; sleep is kept as read", () => {
    const [onTime, late, absent] = pointRows(
      KEY,
      [
        line({ actualUnitCode: "DT1" }),
        line({ employeeId: "e-2", finger: "late", actualUnitCode: "DT1" }),
        line({
          employeeId: "e-3",
          nik: "0501000003",
          finger: "missing",
          decision: "not-ready",
        }),
      ],
      context()
    );
    expect(onTime).toMatchObject({ attended: true, sleepMinutes: 400 });
    expect(late).toMatchObject({ attended: true });
    /* No reading for this NIK: null, not a zero that would drag an average. */
    expect(absent).toMatchObject({ attended: false, sleepMinutes: null });
  });

  test("the streak carries on from the person's previous shift", () => {
    const [row] = pointRows(
      KEY,
      [line({ actualUnitCode: "DT1" })],
      context({ streakByEmployee: new Map([["e-1", 5]]) })
    );
    expect(row).toMatchObject({ streak: 6, streakBonus: 10, total: 25 });
  });

  test("a PLAN holder and a spare who did the same score the same", () => {
    const [kept, spare] = pointRows(
      KEY,
      [
        line({ actualUnitCode: "DT1", planUnitCode: "DT1", decision: "kept" }),
        line({
          employeeId: "e-2",
          actualUnitCode: "DT1",
          planUnitCode: null,
          decision: "substitute",
        }),
      ],
      context()
    );
    expect(spare!.total).toBe(kept!.total);
  });
});

/* ------------------------------------------------------------ the ledger */

const tag = "ZZ Points Settle";
let companyId: string, deptId: string, positionId: string;
const employees: string[] = [];
const uid = () => Math.random().toString(36).slice(2, 8);

async function addEmployee() {
  const [row] = await db
    .insert(schema.employees)
    .values({
      nik: `99ps${uid()}`,
      name: tag,
      companyId,
      departmentId: deptId,
      positionId,
      status: "aktif",
    })
    .returning({ id: schema.employees.id, nik: schema.employees.nik });
  employees.push(row!.id);
  return row!;
}

async function ledgerOf(employeeId: string) {
  return db
    .select()
    .from(schema.operatorPoints)
    .where(eq(schema.operatorPoints.employeeId, employeeId));
}

async function wipe() {
  if (!employees.length) return;
  await db
    .delete(schema.operatorPoints)
    .where(inArray(schema.operatorPoints.employeeId, employees));
  await db
    .delete(schema.employees)
    .where(inArray(schema.employees.id, employees));
  employees.length = 0;
}

beforeAll(async () => {
  const [company] = await db
    .insert(schema.companies)
    .values({ name: `${tag} PT`, code: `ZP${uid()}` })
    .returning({ id: schema.companies.id });
  companyId = company!.id;
  const [dept] = await db
    .insert(schema.departments)
    .values({ name: `${tag} Dept`, companyId })
    .returning({ id: schema.departments.id });
  deptId = dept!.id;
  const [position] = await db
    .insert(schema.positions)
    .values({
      name: `${tag} Operator`,
      departmentId: deptId,
      fleetAllocation: true,
    })
    .returning({ id: schema.positions.id });
  positionId = position!.id;
});

beforeEach(wipe);

afterAll(async () => {
  await wipe();
  await db.delete(schema.positions).where(eq(schema.positions.id, positionId));
  await db.delete(schema.departments).where(eq(schema.departments.id, deptId));
  await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
});

const rowsFor = (
  key: { date: string; shift: "day" | "night" },
  person: { id: string; nik: string },
  over: Partial<AuditRow> = {},
  streak = 0
) =>
  pointRows(
    key,
    [
      line({
        employeeId: person.id,
        departmentId: deptId,
        nik: person.nik,
        ...over,
      }),
    ],
    {
      sleepByNik: new Map(),
      streakByEmployee: new Map([[person.id, streak]]),
      unitTypeByCode: new Map(),
    }
  );

describe("the ledger", () => {
  test("settling a shift twice leaves one row per person", async () => {
    const person = await addEmployee();
    await replaceShift(KEY, rowsFor(KEY, person, { actualUnitCode: "DT1" }));
    await replaceShift(
      KEY,
      rowsFor(KEY, person, { decision: "not-ready", finger: "missing" })
    );
    const rows = await ledgerOf(person.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "not-ready", total: -15 });
  });

  test("the previous streak is the last shift before this one", async () => {
    const person = await addEmployee();
    const day1 = { date: "1999-03-01", shift: "day" } as const;
    const night1 = { date: "1999-03-01", shift: "night" } as const;
    const day2 = { date: "1999-03-02", shift: "day" } as const;
    await replaceShift(
      day1,
      rowsFor(day1, person, { actualUnitCode: "DT1" }, 2)
    );
    await replaceShift(
      night1,
      rowsFor(night1, person, { actualUnitCode: "DT1" }, 3)
    );
    await replaceShift(
      day2,
      rowsFor(day2, person, { actualUnitCode: "DT1" }, 4)
    );

    /* The day shift's predecessor is the night before it, never itself. */
    expect((await previousStreaks([person.id], day2)).get(person.id)).toBe(4);
    expect((await previousStreaks([person.id], night1)).get(person.id)).toBe(3);
    expect((await previousStreaks([person.id], day1)).has(person.id)).toBe(
      false
    );
  });

  test("a shift with no board settles nothing", async () => {
    const person = await addEmployee();
    const result = await settleShift("1999-03-05", "day");
    expect(result.kind).not.toBe("settled");
    expect(await ledgerOf(person.id)).toHaveLength(0);
  });
});
