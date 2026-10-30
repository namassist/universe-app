/**
 * PLAN Generate, driven through the real routes.
 *
 * Generate reads the whole register, so every assertion is about this file's
 * own units, which a department of their own and a SIMPER code of their own
 * keep apart from anything else in the database. The commit writes for every
 * empty unit, so those tests run only against the test database.
 *
 *   bun test src/routes/fleet-allocation-generate.test.ts
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
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  shiftCode,
  type PlanGeneratePreview,
  type PlanGenerateResult,
  type RosterCode,
} from "@universe/contracts";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { generateShiftAt } from "../plan-generate";
import { redis } from "../redis";
import { localDate } from "../scheduler";
import { planGenerateRoutes } from "./fleet-allocation-generate";

const app = new Elysia().use(planGenerateRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji AllocGen ${uid()}`;
const run = uid().toUpperCase();

const [{ name: dbName }] = (await db.execute(
  sql`select current_database() as name`
)) as unknown as [{ name: string }];
const onTestDb = dbName.endsWith("_test");

const shift = generateShiftAt(new Date());
const other = shift === "day" ? "night" : "day";
const today = localDate(new Date());

const made = {
  users: [] as string[],
  roles: [] as string[],
  employees: [] as string[],
  units: [] as string[],
  unitCodes: [] as string[],
  positions: [] as string[],
  departments: [] as string[],
  companies: [] as string[],
  simperCodes: [] as string[],
  catalogues: [] as string[],
  priorities: [] as string[],
  rosterDocs: [] as string[],
};

let admin: { cookie: string };
let viewer: { cookie: string };

type Person = { id: string; nik: string; name: string };
type Unit = { id: string; code: string };

/* Spares A, B, C sort by NIK in that order. */
let spareA: Person;
let spareB: Person;
let spareC: Person;
let spareOff: Person; //     works the other shift
let spareStandby: Person; // on shift, on light duty
let spareNoCode: Person; //  on shift, lacks the code
let holderLeave: Person; //  CR today, on uFull
let holderOther: Person; //  works the other shift, on uFull
let holderOn: Person; //     works the shift, on uCovered
let spareElsewhere: Person; // on shift, holds a unit outside allocation

let uRank1: Unit;
let uRank2: Unit;
let uFull: Unit; //    rank 3, two holders, neither on the shift
let uCovered: Unit;
let uUnranked: Unit; // nobody left for it
let uOutside: Unit; //  in no formation and not support

async function makeUser(mode: "view" | "manage") {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-agen-${uid()}`, name: tag, scope: "all" })
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

const preview = async (cookie = admin.cookie) => {
  const response = await app.handle(
    new Request("http://localhost/fleet-allocation/plan/generate/preview", {
      headers: { cookie },
    })
  );
  expect(response.status).toBe(200);
  return (await response.json()) as PlanGeneratePreview;
};

const commit = (body: unknown, cookie = admin.cookie) =>
  app.handle(
    new Request("http://localhost/fleet-allocation/plan/generate", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

/** Commit exactly what a fresh preview shows. */
const commitPreviewed = async () => {
  const p = await preview();
  return commit({ shift: p.shift, token: p.token });
};

const mine = (p: PlanGeneratePreview) => {
  const codes = new Set(made.unitCodes);
  return {
    assign: p.assign.filter((a) => codes.has(a.unit)),
    unfilled: p.unfilled.filter((u) => codes.has(u.unit)),
  };
};

/** unit code → NIKs holding it, among this file's units. */
async function liveOf() {
  const rows = await db
    .select({ unit: schema.units.code, nik: schema.employees.nik })
    .from(schema.fleetPlanSlots)
    .innerJoin(schema.units, eq(schema.units.id, schema.fleetPlanSlots.unitId))
    .innerJoin(
      schema.employees,
      eq(schema.employees.id, schema.fleetPlanSlots.employeeId)
    )
    .where(inArray(schema.fleetPlanSlots.unitId, made.units));
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.unit] ??= []).push(r.nik);
  for (const list of Object.values(out)) list.sort();
  return out;
}

/** The live plan `seedPlan` lays down, as `liveOf` reads it. */
const seeded = () => ({
  [uFull.code]: [holderLeave.nik, holderOther.nik].sort(),
  [uCovered.code]: [holderOn.nik],
  [uOutside.code]: [spareElsewhere.nik],
});

async function seedPlan() {
  await db
    .delete(schema.fleetPlanHistory)
    .where(inArray(schema.fleetPlanHistory.unitId, made.units));
  await db
    .delete(schema.fleetPlanSlots)
    .where(inArray(schema.fleetPlanSlots.unitId, made.units));
  await db.insert(schema.fleetPlanSlots).values([
    { unitId: uFull.id, employeeId: holderLeave.id },
    { unitId: uFull.id, employeeId: holderOther.id },
    { unitId: uCovered.id, employeeId: holderOn.id },
    { unitId: uOutside.id, employeeId: spareElsewhere.id },
  ]);
}

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
  admin = await makeUser("manage");
  viewer = await makeUser("view");

  const [company] = await db
    .insert(schema.companies)
    .values({ name: tag, code: `ZG${uid()}` })
    .returning({ id: schema.companies.id });
  made.companies.push(company!.id);
  const [dept] = await db
    .insert(schema.departments)
    .values({ name: `${tag} Dept`, companyId: company!.id })
    .returning({ id: schema.departments.id });
  made.departments.push(dept!.id);
  const [pos] = await db
    .insert(schema.positions)
    .values({
      name: `${tag} Op`,
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

  const [doc] = await db
    .insert(schema.rosterDocuments)
    .values({
      departmentId: dept!.id,
      month: `${today.slice(0, 7)}-01`,
      fileName: `${tag}.xlsx`,
      uploadedBy: (await makeUser("view")).id,
    })
    .returning({ id: schema.rosterDocuments.id });
  made.rosterDocs.push(doc!.id);

  const employee = async (
    suffix: string,
    roster: RosterCode | null,
    extra: { skilled?: boolean; status?: "aktif" | "standby" } = {}
  ): Promise<Person> => {
    const nik = `ZZG${run}${suffix}`;
    const name = `${tag} ${suffix}`;
    const [row] = await db
      .insert(schema.employees)
      .values({
        nik,
        name,
        companyId: company!.id,
        departmentId: dept!.id,
        positionId: pos!.id,
        simperExp: "2099-01-01",
        status: extra.status ?? "aktif",
      })
      .returning({ id: schema.employees.id });
    made.employees.push(row!.id);
    if (extra.skilled !== false)
      await db
        .insert(schema.employeeSkills)
        .values({ employeeId: row!.id, simperCodeId: code!.id });
    if (roster)
      await db.insert(schema.rosterDays).values({
        documentId: doc!.id,
        employeeId: row!.id,
        date: today,
        code: roster,
      });
    return { id: row!.id, nik, name };
  };
  const on = shiftCode(shift);
  const off = shiftCode(other);
  spareA = await employee("A", on);
  spareB = await employee("B", on);
  spareC = await employee("C", on);
  spareOff = await employee("D", off);
  spareStandby = await employee("E", on, { status: "standby" });
  spareNoCode = await employee("F", on, { skilled: false });
  holderLeave = await employee("H1", "CR");
  holderOther = await employee("H2", off);
  holderOn = await employee("H3", on);
  spareElsewhere = await employee("0", on);

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
    label: string,
    rank: number | null,
    inAllocation = true
  ): Promise<Unit> => {
    const description = `${tag} ${label}`;
    if (rank !== null) {
      const [p] = await db
        .insert(schema.allocationPriorities)
        .values({ description, rank })
        .returning({ id: schema.allocationPriorities.id });
      made.priorities.push(p!.id);
    }
    const [row] = await db
      .insert(schema.units)
      .values({
        code: `ZZGU${uid()}`,
        classId: cls!.id,
        typeId: typ!.id,
        modelId: mdl!.id,
        brandId: brd!.id,
        simperCodeId: code!.id,
        departmentId: dept!.id,
        description,
        fleetSupport: inAllocation,
      })
      .returning({ id: schema.units.id, code: schema.units.code });
    made.units.push(row!.id);
    made.unitCodes.push(row!.code);
    return { id: row!.id, code: row!.code };
  };
  uUnranked = await unit("UNRANKED", null);
  uFull = await unit("R3", 3);
  uRank2 = await unit("R2", 2);
  uRank1 = await unit("R1", 1);
  uCovered = await unit("COVERED", 1);
  uOutside = await unit("OUTSIDE", null, false);
});

beforeEach(seedPlan);

afterAll(async () => {
  await db
    .delete(schema.fleetPlanHistory)
    .where(inArray(schema.fleetPlanHistory.unitId, made.units));
  await db
    .delete(schema.fleetPlanSlots)
    .where(inArray(schema.fleetPlanSlots.unitId, made.units));
  await db
    .delete(schema.rosterDays)
    .where(inArray(schema.rosterDays.documentId, made.rosterDocs));
  await db
    .delete(schema.rosterDocuments)
    .where(inArray(schema.rosterDocuments.id, made.rosterDocs));
  await db
    .delete(schema.employeeSkills)
    .where(inArray(schema.employeeSkills.employeeId, made.employees));
  await db
    .delete(schema.employees)
    .where(inArray(schema.employees.id, made.employees));
  await db.delete(schema.units).where(inArray(schema.units.id, made.units));
  if (made.priorities.length)
    await db
      .delete(schema.allocationPriorities)
      .where(inArray(schema.allocationPriorities.id, made.priorities));
  await db
    .delete(schema.positions)
    .where(inArray(schema.positions.id, made.positions));
  await db
    .delete(schema.departments)
    .where(inArray(schema.departments.id, made.departments));
  await db
    .delete(schema.companies)
    .where(inArray(schema.companies.id, made.companies));
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
  await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

/* -------------------------------------------------------------- preview */

describe("GET /plan/generate/preview", () => {
  test("states the clock's shift and today's date", async () => {
    const p = await preview();
    expect(p.shift).toBe(shift);
    expect(p.date).toBe(today);
  });

  test("fills the empty units by rank, releasing on the full one", async () => {
    const { assign, unfilled } = mine(await preview());

    expect(assign.map((a) => [a.unit, a.nik])).toEqual([
      [uRank1.code, spareA.nik],
      [uRank2.code, spareB.nik],
      [uFull.code, spareC.nik],
    ]);
    expect(assign[2]!.released).toEqual({
      nik: holderLeave.nik,
      name: holderLeave.name,
      rosterCode: "CR",
      standby: false,
    });
    expect(assign[0]!.priority).toBe(1);
    expect(unfilled.map((u) => u.unit)).toEqual([uUnranked.code]);
  });

  test("never offers the off-shift, standby, unskilled or paired spare", async () => {
    const { assign } = mine(await preview());
    const niks = assign.map((a) => a.nik);
    for (const p of [spareOff, spareStandby, spareNoCode, spareElsewhere])
      expect(niks).not.toContain(p.nik);
  });

  test("carries a token for the commit", async () => {
    expect((await preview()).token).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is readable with view permission", async () => {
    await preview(viewer.cookie);
  });
});

/* --------------------------------------------------------------- commit */

describe("POST /plan/generate", () => {
  test("needs manage permission", async () => {
    const response = await commit({ shift, token: "x" }, viewer.cookie);
    expect(response.status).toBe(403);
  });

  test("refuses a shift other than the clock's", async () => {
    const response = await commit({
      shift: other,
      token: (await preview()).token,
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe(
      "shift_changed"
    );
    expect(await liveOf()).toEqual(seeded());
  });

  test("refuses when the PLAN changed since the preview", async () => {
    const { token } = await preview();
    await db
      .delete(schema.fleetPlanSlots)
      .where(eq(schema.fleetPlanSlots.employeeId, holderOn.id));

    const response = await commit({ shift, token });

    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe(
      "preview_stale"
    );
    const rest = Object.entries(seeded()).filter(([u]) => u !== uCovered.code);
    expect(await liveOf()).toEqual(Object.fromEntries(rest));
  });

  test.skipIf(!onTestDb)("writes the preview's pairings", async () => {
    const response = await commitPreviewed();
    expect(response.status).toBe(200);
    const result = (await response.json()) as PlanGenerateResult;
    expect(result.assigned).toBeGreaterThanOrEqual(3);
    expect(result.released).toBeGreaterThanOrEqual(1);

    expect(await liveOf()).toEqual({
      [uRank1.code]: [spareA.nik],
      [uRank2.code]: [spareB.nik],
      [uFull.code]: [holderOther.nik, spareC.nik].sort(),
      [uCovered.code]: [holderOn.nik],
      [uOutside.code]: [spareElsewhere.nik],
    });
  });

  test.skipIf(!onTestDb)(
    "records releases and assignments as generate",
    async () => {
      await commitPreviewed();
      const rows = await db
        .select({
          nik: schema.fleetPlanHistory.nik,
          action: schema.fleetPlanHistory.action,
          source: schema.fleetPlanHistory.source,
        })
        .from(schema.fleetPlanHistory)
        .where(
          and(
            eq(schema.fleetPlanHistory.unitId, uFull.id),
            eq(schema.fleetPlanHistory.source, "generate")
          )
        );
      expect(rows).toEqual(
        expect.arrayContaining([
          { nik: holderLeave.nik, action: "released", source: "generate" },
          { nik: spareC.nik, action: "assigned", source: "generate" },
        ])
      );
      expect(rows).toHaveLength(2);
    }
  );

  test.skipIf(!onTestDb)("a second run finds nothing more to do", async () => {
    await commitPreviewed();
    const { assign, unfilled } = mine(await preview());
    expect(assign).toEqual([]);
    expect(unfilled.map((u) => u.unit)).toEqual([uUnranked.code]);
  });
});
