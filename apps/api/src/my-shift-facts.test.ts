/**
 * The facts "Unit saya" is built from, read from a real register. `standing`
 * orders them (`my-shift.test.ts`); these pin that each one is read the way
 * the board reads it: a broken-down unit, a unit in no formation, a SIMPER
 * the person does not hold, a partner rostered to the same shift, and a
 * seat on a board that exists.
 *
 *   bun --env-file=.env test src/my-shift-facts.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db, schema } from "./db";
import { boardFacts, planFacts, standing } from "./my-shift";
import { personByNik } from "./routes/fleet-allocation";

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji MyShift ${uid()}`;
const DAY = "1998-03-02";
const BOARD_DAY = "1998-03-03";
const TODAY = "1998-03-02";

/** NIKs in a range no real register uses. */
const HOLDER = "99080001";
const PARTNER = "99080002";
const NO_SKILL = "99080003";
const BROKEN = "99080004";
const LOOSE = "99080005";
const NIKS = [HOLDER, PARTNER, NO_SKILL, BROKEN, LOOSE];

const made = {
  company: "",
  department: "",
  position: "",
  employees: [] as string[],
  masters: [] as {
    table: "unitClasses" | "unitTypes" | "unitModels" | "unitBrands";
    id: string;
  }[],
  simperCode: "",
  units: [] as string[],
  leader: "",
  fleet: "",
  rosterDoc: "",
  boardDoc: "",
};
let leaderCode = "";

beforeAll(async () => {
  const [company] = await db
    .insert(schema.companies)
    .values({ name: `${tag} PT`, code: `ZM${uid().slice(0, 4)}` })
    .returning({ id: schema.companies.id });
  made.company = company!.id;
  const [department] = await db
    .insert(schema.departments)
    .values({ name: `${tag} Dept`, companyId: made.company })
    .returning({ id: schema.departments.id });
  made.department = department!.id;
  const [position] = await db
    .insert(schema.positions)
    .values({
      name: `${tag} Operator`,
      departmentId: made.department,
      fleetAllocation: true,
    })
    .returning({ id: schema.positions.id });
  made.position = position!.id;

  const employees = await db
    .insert(schema.employees)
    .values(
      NIKS.map((nik) => ({
        nik,
        name: `${tag} ${nik}`,
        companyId: made.company,
        departmentId: made.department,
        positionId: made.position,
        status: "aktif" as const,
      }))
    )
    .returning({ id: schema.employees.id, nik: schema.employees.nik });
  made.employees.push(...employees.map((e) => e.id));
  const idOf = (nik: string) => employees.find((e) => e.nik === nik)!.id;

  const master = async (
    table: "unitClasses" | "unitTypes" | "unitModels" | "unitBrands"
  ) => {
    const [row] = await db
      .insert(schema[table])
      .values({ name: `${tag} ${table}` })
      .returning({ id: schema[table].id });
    made.masters.push({ table, id: row!.id });
    return row!.id;
  };
  const kinds = {
    classId: await master("unitClasses"),
    typeId: await master("unitTypes"),
    modelId: await master("unitModels"),
    brandId: await master("unitBrands"),
  };
  const [code] = await db
    .insert(schema.simperCodes)
    .values({ name: `${tag} A2B` })
    .returning({ id: schema.simperCodes.id });
  made.simperCode = code!.id;

  const unit = async (suffix: string, over: Record<string, unknown> = {}) => {
    const [row] = await db
      .insert(schema.units)
      .values({
        code: `ZZM-${suffix}-${uid()}`,
        ...kinds,
        simperCodeId: made.simperCode,
        workArea: `${tag} Pit`,
        ...over,
      })
      .returning({ id: schema.units.id, code: schema.units.code });
    return row!;
  };

  const leader = await unit("EX", { breakdown: true, simperCodeId: null });
  made.leader = leader.id;
  leaderCode = leader.code;
  const [fleet] = await db
    .insert(schema.fleets)
    .values({ leaderUnitId: leader.id })
    .returning({ id: schema.fleets.id });
  made.fleet = fleet!.id;

  const ok = await unit("OK");
  const ok2 = await unit("OK2");
  const broken = await unit("BRK", { breakdown: true });
  const loose = await unit("LOOSE");
  made.units.push(ok.id, ok2.id, broken.id, loose.id);
  await db
    .insert(schema.fleetUnits)
    .values(
      [ok, ok2, broken].map((u) => ({ fleetId: made.fleet, unitId: u.id }))
    );

  await db.insert(schema.fleetPlanSlots).values([
    { unitId: ok.id, employeeId: idOf(HOLDER) },
    { unitId: ok.id, employeeId: idOf(PARTNER) },
    { unitId: ok2.id, employeeId: idOf(NO_SKILL) },
    { unitId: broken.id, employeeId: idOf(BROKEN) },
    { unitId: loose.id, employeeId: idOf(LOOSE) },
  ]);
  await db.insert(schema.employeeSkills).values(
    [HOLDER, PARTNER, BROKEN, LOOSE].map((nik) => ({
      employeeId: idOf(nik),
      simperCodeId: made.simperCode,
    }))
  );

  const [rosterDoc] = await db
    .insert(schema.rosterDocuments)
    .values({
      departmentId: made.department,
      month: "1998-03-01",
      fileName: `${tag}.xlsx`,
    })
    .returning({ id: schema.rosterDocuments.id });
  made.rosterDoc = rosterDoc!.id;
  await db.insert(schema.rosterDays).values(
    [HOLDER, PARTNER].map((nik) => ({
      documentId: made.rosterDoc,
      employeeId: idOf(nik),
      date: DAY,
      code: "D" as const,
    }))
  );

  const [boardDoc] = await db
    .insert(schema.fleetActualDocuments)
    .values({ date: BOARD_DAY, shift: "night" })
    .returning({ id: schema.fleetActualDocuments.id });
  made.boardDoc = boardDoc!.id;
  await db.insert(schema.fleetActualSlots).values({
    documentId: made.boardDoc,
    unitId: ok2.id,
    employeeId: idOf(HOLDER),
    source: "spare",
    workArea: `${tag} Pit 2`,
  });
});

afterAll(async () => {
  if (made.boardDoc)
    await db
      .delete(schema.fleetActualDocuments)
      .where(eq(schema.fleetActualDocuments.id, made.boardDoc));
  if (made.rosterDoc)
    await db
      .delete(schema.rosterDocuments)
      .where(eq(schema.rosterDocuments.id, made.rosterDoc));
  if (made.employees.length) {
    await db
      .delete(schema.fleetPlanSlots)
      .where(inArray(schema.fleetPlanSlots.employeeId, made.employees));
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
  }
  if (made.fleet)
    await db.delete(schema.fleets).where(eq(schema.fleets.id, made.fleet));
  if (made.units.length)
    await db.delete(schema.units).where(inArray(schema.units.id, made.units));
  if (made.leader)
    await db.delete(schema.units).where(eq(schema.units.id, made.leader));
  if (made.simperCode)
    await db
      .delete(schema.simperCodes)
      .where(eq(schema.simperCodes.id, made.simperCode));
  for (const { table, id } of made.masters)
    await db.delete(schema[table]).where(eq(schema[table].id, id));
  if (made.position)
    await db
      .delete(schema.positions)
      .where(eq(schema.positions.id, made.position));
  if (made.department)
    await db
      .delete(schema.departments)
      .where(eq(schema.departments.id, made.department));
  if (made.company)
    await db
      .delete(schema.companies)
      .where(eq(schema.companies.id, made.company));
});

const factsFor = async (nik: string, shift: "day" | "night" = "day") =>
  planFacts((await personByNik(nik))!, { date: DAY, shift }, TODAY);

describe("the plan's facts", () => {
  test("a holder on a unit in a formation, with the formation's seat", async () => {
    expect(await factsFor(HOLDER)).toMatchObject({
      active: true,
      breakdown: false,
      inAllocation: true,
      refusal: null,
      seat: { area: `${tag} Pit`, fleet: leaderCode },
    });
  });

  test("a partner rostered to the same shift is seen, and only on that shift", async () => {
    expect((await factsFor(HOLDER, "day"))!.partnerRostered).toBe(true);
    expect((await factsFor(HOLDER, "night"))!.partnerRostered).toBe(false);
  });

  test("a SIMPER the person does not hold is the board's own refusal", async () => {
    const facts = await factsFor(NO_SKILL);
    expect(facts!.refusal).toContain("SIMPER");
    expect(
      standing({
        allocatable: true,
        rostered: true,
        plan: facts,
        board: null,
        secondFingerOpen: false,
      }).reason
    ).toBe("ineligible");
  });

  test("a broken-down unit is read as broken down", async () => {
    expect((await factsFor(BROKEN))!.breakdown).toBe(true);
  });

  test("a unit in no formation and not support is outside allocation", async () => {
    expect((await factsFor(LOOSE))!.inAllocation).toBe(false);
  });
});

describe("the board's facts", () => {
  test("no board for the shift is no board, not an empty one", async () => {
    expect(await boardFacts(HOLDER, { date: DAY, shift: "day" })).toBeNull();
  });

  test("a seat on a board that exists, with how it was given", async () => {
    expect(
      await boardFacts(HOLDER, { date: BOARD_DAY, shift: "night" })
    ).toEqual({
      seat: expect.objectContaining({ area: `${tag} Pit 2`, source: "spare" }),
    });
  });

  test("somebody the board did not seat has no seat on it", async () => {
    expect(
      await boardFacts(PARTNER, { date: BOARD_DAY, shift: "night" })
    ).toEqual({ seat: null });
  });
});
