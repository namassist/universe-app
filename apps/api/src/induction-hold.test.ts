/**
 * The first day back from leave: held on standby, released the day after.
 *
 * Against the test database, like the roster mirror's suite. Dates are 1999 so
 * no real roster covers them, and every reconcile here runs for a 1999 date —
 * which also means it releases nothing a real hold depends on.
 *
 *   bun --env-file=.env test ./src/induction-hold.test.ts
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { EmployeeStatus, RosterCode } from "@universe/contracts";

import { db, schema } from "./db";
import { reconcileInductionHolds } from "./induction-hold";

const tag = "ZZ Induction Hold";

let companyId: string, deptId: string, operatorPos: string, officePos: string;
const employees: string[] = [];

const uid = () => Math.random().toString(36).slice(2, 8);

async function addEmployee(
  status: EmployeeStatus = "aktif",
  positionId = operatorPos
) {
  const [row] = await db
    .insert(schema.employees)
    .values({
      nik: `99ih${uid()}`,
      name: tag,
      companyId,
      departmentId: deptId,
      positionId,
      status,
    })
    .returning({ id: schema.employees.id });
  employees.push(row!.id);
  return row!.id;
}

/** The department's document for a month, created on first use. */
async function documentFor(month: string, status: "aktif" | "arsip") {
  const [existing] = await db
    .select({ id: schema.rosterDocuments.id })
    .from(schema.rosterDocuments)
    .where(
      and(
        eq(schema.rosterDocuments.departmentId, deptId),
        eq(schema.rosterDocuments.month, month),
        eq(schema.rosterDocuments.status, status)
      )
    );
  if (existing) return existing.id;
  const [row] = await db
    .insert(schema.rosterDocuments)
    .values({
      departmentId: deptId,
      month,
      fileName: tag,
      status,
      source: "unggul",
    })
    .returning({ id: schema.rosterDocuments.id });
  return row!.id;
}

/** Roster `employeeId` from `date` onwards, one code a day. */
async function roster(
  employeeId: string,
  date: string,
  codes: RosterCode[],
  status: "aktif" | "arsip" = "aktif"
) {
  const start = new Date(`${date}T00:00:00Z`);
  for (const [i, code] of codes.entries()) {
    const day = new Date(start.getTime() + i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const documentId = await documentFor(`${day.slice(0, 8)}01`, status);
    await db
      .insert(schema.rosterDays)
      .values({ documentId, employeeId, date: day, code });
  }
}

async function statusOf(employeeId: string) {
  const [row] = await db
    .select({ status: schema.employees.status })
    .from(schema.employees)
    .where(eq(schema.employees.id, employeeId));
  return row!.status;
}

async function holdsOf(employeeId: string) {
  return db
    .select({
      date: schema.inductionHolds.date,
      released: schema.inductionHolds.releasedAt,
    })
    .from(schema.inductionHolds)
    .where(eq(schema.inductionHolds.employeeId, employeeId));
}

async function setStatus(employeeId: string, status: EmployeeStatus) {
  await db
    .update(schema.employees)
    .set({ status })
    .where(eq(schema.employees.id, employeeId));
}

async function wipe() {
  if (employees.length) {
    await db
      .delete(schema.inductionHolds)
      .where(inArray(schema.inductionHolds.employeeId, employees));
    await db
      .delete(schema.rosterDays)
      .where(inArray(schema.rosterDays.employeeId, employees));
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, employees));
    employees.length = 0;
  }
  await db
    .delete(schema.rosterDocuments)
    .where(eq(schema.rosterDocuments.departmentId, deptId));
}

beforeAll(async () => {
  const [company] = await db
    .insert(schema.companies)
    .values({ name: `${tag} PT`, code: `ZI${uid()}` })
    .returning({ id: schema.companies.id });
  companyId = company!.id;
  const [dept] = await db
    .insert(schema.departments)
    .values({ name: `${tag} Dept`, companyId })
    .returning({ id: schema.departments.id });
  deptId = dept!.id;
  const positions = await db
    .insert(schema.positions)
    .values([
      { name: `${tag} Operator`, departmentId: deptId, fleetAllocation: true },
      { name: `${tag} Admin`, departmentId: deptId, fleetAllocation: false },
    ])
    .returning({ id: schema.positions.id });
  [operatorPos, officePos] = positions.map((p) => p.id) as [string, string];
});

beforeEach(wipe);

afterAll(async () => {
  await wipe();
  await db
    .delete(schema.positions)
    .where(inArray(schema.positions.id, [operatorPos, officePos]));
  await db.delete(schema.departments).where(eq(schema.departments.id, deptId));
  await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
});

describe("reconcileInductionHolds", () => {
  test.each([
    ["CR", "D"],
    ["TRV", "D"],
    ["AL", "D"],
    ["TRV", "N"],
  ] as const)(
    "%s then %s puts the operator on standby",
    async (before, today) => {
      const id = await addEmployee();
      await roster(id, "1999-06-09", [before, today]);

      const result = await reconcileInductionHolds("1999-06-10");

      expect(result.held).toBe(1);
      expect(await statusOf(id)).toBe("standby");
      expect(await holdsOf(id)).toEqual([
        { date: "1999-06-10", released: null },
      ]);
    }
  );

  test.each([
    ["OFF", "D"],
    ["D", "D"],
    ["S", "D"],
    ["LWP", "D"],
    ["CR", "OFF"],
    ["TRV", "CR"],
  ] as const)("%s then %s is not a first day back", async (before, today) => {
    const id = await addEmployee();
    await roster(id, "1999-06-09", [before, today]);

    await reconcileInductionHolds("1999-06-10");

    expect(await statusOf(id)).toBe("aktif");
    expect(await holdsOf(id)).toEqual([]);
  });

  test("leaves nonaktif and a hand-set standby alone, and records neither", async () => {
    const gone = await addEmployee("nonaktif");
    const light = await addEmployee("standby");
    await roster(gone, "1999-06-09", ["CR", "D"]);
    await roster(light, "1999-06-09", ["CR", "D"]);

    await reconcileInductionHolds("1999-06-10");

    expect(await statusOf(gone)).toBe("nonaktif");
    expect(await statusOf(light)).toBe("standby");
    expect(await holdsOf(gone)).toEqual([]);
    expect(await holdsOf(light)).toEqual([]);
  });

  test("ignores a position that never enters allocation", async () => {
    const id = await addEmployee("aktif", officePos);
    await roster(id, "1999-06-09", ["CR", "D"]);

    await reconcileInductionHolds("1999-06-10");

    expect(await statusOf(id)).toBe("aktif");
  });

  test("the next day's run puts them back to aktif", async () => {
    const id = await addEmployee();
    await roster(id, "1999-06-09", ["CR", "D", "D"]);
    await reconcileInductionHolds("1999-06-10");

    const result = await reconcileInductionHolds("1999-06-11");

    expect(result.released).toBe(1);
    expect(await statusOf(id)).toBe("aktif");
    const [hold] = await holdsOf(id);
    expect(hold?.released).not.toBeNull();
  });

  test("a status an admin changed in between is kept on release", async () => {
    const id = await addEmployee();
    await roster(id, "1999-06-09", ["CR", "D", "D"]);
    await reconcileInductionHolds("1999-06-10");
    await setStatus(id, "nonaktif");

    await reconcileInductionHolds("1999-06-11");

    expect(await statusOf(id)).toBe("nonaktif");
    const [hold] = await holdsOf(id);
    expect(hold?.released).not.toBeNull();
  });

  test("an admin who reactivates them the same day is not overruled by the night run", async () => {
    const id = await addEmployee();
    await roster(id, "1999-06-09", ["CR", "D"]);
    await reconcileInductionHolds("1999-06-10");
    await setStatus(id, "aktif");

    await reconcileInductionHolds("1999-06-10");

    expect(await statusOf(id)).toBe("aktif");
  });

  test("running twice for one date changes nothing the second time", async () => {
    const id = await addEmployee();
    await roster(id, "1999-06-09", ["AL", "D"]);
    await reconcileInductionHolds("1999-06-10");

    const again = await reconcileInductionHolds("1999-06-10");

    expect(again).toEqual({ held: 0, released: 0, refused: 0 });
    expect(await statusOf(id)).toBe("standby");
    expect(await holdsOf(id)).toHaveLength(1);
  });

  test("a roster revised away from the return releases the hold", async () => {
    const id = await addEmployee();
    await roster(id, "1999-06-09", ["CR", "D"]);
    await reconcileInductionHolds("1999-06-10");
    await db
      .update(schema.rosterDays)
      .set({ code: "CR" })
      .where(
        and(
          eq(schema.rosterDays.employeeId, id),
          eq(schema.rosterDays.date, "1999-06-10")
        )
      );

    const result = await reconcileInductionHolds("1999-06-10");

    expect(result.released).toBe(1);
    expect(await statusOf(id)).toBe("aktif");
  });

  test("reads only the document in force, not an archived one", async () => {
    const id = await addEmployee();
    await roster(id, "1999-06-09", ["CR"], "arsip");
    await roster(id, "1999-06-09", ["D", "D"]);

    await reconcileInductionHolds("1999-06-10");

    expect(await statusOf(id)).toBe("aktif");
  });

  test("the first of the month reads yesterday from last month's document", async () => {
    const id = await addEmployee();
    await roster(id, "1999-06-30", ["TRV", "D"]);

    await reconcileInductionHolds("1999-07-01");

    expect(await statusOf(id)).toBe("standby");
  });
});

/**
 * What keeps the check from reaching further into the engine than the people
 * it holds: a run that would bench a crowd holds nobody, and switching it off
 * hands every held seat back.
 */
describe("reconcileInductionHolds — guard rails", () => {
  async function returners(count: number) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = await addEmployee();
      await roster(id, "1999-06-09", ["CR", "D"]);
      ids.push(id);
    }
    return ids;
  }

  test("holds thirty back from leave — the floor of the cap", async () => {
    const ids = await returners(30);

    const result = await reconcileInductionHolds("1999-06-10");

    expect(result).toEqual({ held: 30, released: 0, refused: 0 });
    expect(await statusOf(ids[0]!)).toBe("standby");
  });

  test("holds nobody when more come back than the cap allows", async () => {
    const ids = await returners(31);

    const result = await reconcileInductionHolds("1999-06-10");

    expect(result).toEqual({ held: 0, released: 0, refused: 31 });
    for (const id of ids) expect(await statusOf(id)).toBe("aktif");
    expect(await holdsOf(ids[0]!)).toEqual([]);
  });

  test("switched off, it holds nobody and releases every open hold", async () => {
    const held = await addEmployee();
    await roster(held, "1999-06-09", ["CR", "D"]);
    await reconcileInductionHolds("1999-06-10");
    const fresh = await addEmployee();
    await roster(fresh, "1999-06-09", ["AL", "D"]);

    const result = await reconcileInductionHolds("1999-06-10", {
      enabled: false,
    });

    expect(result).toEqual({ held: 0, released: 1, refused: 0 });
    expect(await statusOf(held)).toBe("aktif");
    expect(await statusOf(fresh)).toBe("aktif");
  });

  test("gives up rather than wait on a row an admin is editing", async () => {
    const id = await addEmployee();
    await roster(id, "1999-06-09", ["CR", "D"]);

    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const editing = db.transaction(async (tx) => {
      await tx.execute(
        sql`select 1 from ${schema.employees} where ${schema.employees.id} = ${id} for update`
      );
      locked();
      await released;
    });
    await isLocked;

    const started = Date.now();
    await expect(reconcileInductionHolds("1999-06-10")).rejects.toThrow();
    const waited = Date.now() - started;
    release();
    await editing;

    expect(waited).toBeLessThan(8_000);
    expect(await statusOf(id)).toBe("aktif");
  }, 15_000);
});
