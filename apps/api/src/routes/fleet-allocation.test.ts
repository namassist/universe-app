/**
 * The PLAN board's eligibility contract, driven through the real routes.
 *
 * Position flag, qualification + expiry, department scoping, one unit per
 * operator, two operators per unit, and the Day/Night pair rule against the
 * roster. Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/fleet-allocation.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { localDate } from "../scheduler";
import { redis } from "../redis";
import { fleetAllocationRoutes } from "./fleet-allocation";

const app = new Elysia().use(fleetAllocationRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji Alloc ${uid()}`;

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
let deptB = "";
let skillCode = { id: "", name: "" };

type Person = { id: string; nik: string; name: string };
let opFit: Person; //     dept A, skilled, valid SIMPER
let opNoSkill: Person; // dept A, no qualification
let opExpired: Person; // dept A, skilled, SIMPER expired
let opWrongDept: Person; // dept B, skilled
let clerk: Person; //     dept A, position outside fleet allocation
let opDay: Person; //     roster: D today
let opDay2: Person; //    roster: D today
let opNight: Person; //   roster: N today
let opFree: Person; //    no roster row

type Unit = { id: string; code: string };
let unitReq: Unit; //  global, requires the skill code
let unitDept: Unit; // owned by dept A, no requirement
let unitFree: Unit; // global, no requirement

/** The formation every fixture unit hauls for — scaffolding, not subject. */
let fleetId: string, fleetDigger: string;

/* ------------------------------------------------------------- fixtures */

async function makeUser(mode: "view" | "manage") {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-alloc-${uid()}`, name: tag, scope: "all" })
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

const pair = (unitCode: string, nik: string) =>
  send("POST", "/fleet-allocation/plan/slots", admin.cookie, {
    unitCode,
    nik,
  });

type Candidate = {
  nik: string;
  eligible: boolean;
  busyAt: string | null;
  rosterShift: "day" | "night" | null;
  sameShift: boolean;
  departmentName: string;
  deptOk: boolean;
  skillOk: boolean;
  expired: boolean;
};

async function candidatesFor(unitCode: string): Promise<Candidate[]> {
  const response = await send(
    "GET",
    `/fleet-allocation/plan/candidates?unit=${unitCode}`,
    admin.cookie
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Candidate[];
}

const candidateOf = (rows: Candidate[], person: Person) =>
  rows.find((c) => c.nik === person.nik);

beforeAll(async () => {
  // scheduler.test.ts disconnects the shared client in its teardown, and bun
  // runs every file in one process.
  if (redis.status === "end") await redis.connect();

  admin = await makeUser("manage");
  viewer = await makeUser("view");

  const [company] = await db
    .insert(schema.companies)
    .values({ name: tag, code: `ZZ${uid()}` })
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
  deptB = b!.id;
  made.departments.push(deptA, deptB);

  const position = async (departmentId: string, fleetAllocation: boolean) => {
    const [row] = await db
      .insert(schema.positions)
      .values({ name: `${tag} ${uid()}`, departmentId, fleetAllocation })
      .returning({ id: schema.positions.id });
    made.positions.push(row!.id);
    return row!.id;
  };
  const operatorA = await position(deptA, true);
  const operatorB = await position(deptB, true);
  const clerkPos = await position(deptA, false);

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
    const nik = `ZZA${uid()}`;
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
    departmentId: deptB,
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
  opFree = await employee({
    label: "Free",
    departmentId: deptA,
    positionId: operatorA,
    // Skilled, so the spare pool has someone whose codes the board must carry.
    skilled: true,
  });

  // Catalogue scaffolding for units.
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

  /** A bare unit row. The digger needs one without a membership. */
  const unitRow = async (
    extra: Partial<{
      simperCodeId: string;
      departmentId: string;
      standby: boolean;
    }>
  ) => {
    const [row] = await db
      .insert(schema.units)
      .values({
        code: `ZZAU${uid()}`,
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

  /* The suite's formation. Its digger is standby so it never occupies a slot
     of its own; it exists only to give `fleet_units` something to point at. */
  fleetDigger = (await unitRow({ standby: true })).id;
  const [fleet] = await db
    .insert(schema.fleets)
    .values({ diggerUnitId: fleetDigger, workArea: `ZZ Pit ${uid()}` })
    .returning({ id: schema.fleets.id });
  fleetId = fleet!.id;

  /* The board only carries units that belong to a formation, so a fixture unit
     hauls for that fleet. What scoping leaves *out* is pinned on its own
     below. */
  const unit = async (
    extra: Partial<{ simperCodeId: string; departmentId: string }>
  ) => {
    const row = await unitRow(extra);
    await db.insert(schema.fleetUnits).values({ fleetId, unitId: row.id });
    return row;
  };

  unitReq = await unit({ simperCodeId: skillCode.id });
  unitDept = await unit({ departmentId: deptA });
  unitFree = await unit({});

  // Today's roster for the pair rule: two on Day, one on Night, one absent
  // from the sheet entirely.
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
  if (fleetId)
    await db.delete(schema.fleets).where(eq(schema.fleets.id, fleetId));
  if (made.units.length) {
    // Before the units: `fleet_units.unit_id` is `restrict`.
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

/* ------------------------------------------------------------- candidates */

describe("who a unit may be paired with, and why not", () => {
  test("qualification, expiry, and the position flag decide the list", async () => {
    const rows = await candidatesFor(unitReq.code);

    expect(candidateOf(rows, opFit)?.eligible).toBe(true);
    expect(candidateOf(rows, opFit)?.departmentName).toBe(`${tag} A`);
    // No qualification for a unit that requires one — and the row says which
    // rule failed, not just that one did.
    expect(candidateOf(rows, opNoSkill)).toMatchObject({
      eligible: false,
      skillOk: false,
      expired: false,
    });
    // Qualified on paper, expired in fact.
    expect(candidateOf(rows, opExpired)).toMatchObject({
      eligible: false,
      skillOk: true,
      expired: true,
    });
    // The unit is global, so the other department is welcome.
    expect(candidateOf(rows, opWrongDept)).toMatchObject({
      eligible: true,
      deptOk: true,
    });
    // A position outside fleet allocation is not a candidate at all.
    expect(candidateOf(rows, clerk)).toBeUndefined();
  });

  test("a department-owned unit takes only its own people", async () => {
    const rows = await candidatesFor(unitDept.code);
    expect(candidateOf(rows, opFit)?.eligible).toBe(true);
    expect(candidateOf(rows, opWrongDept)).toMatchObject({
      eligible: false,
      deptOk: false,
    });
  });

  test("the refusals name the rule, not a constraint", async () => {
    const message = async (response: Response) =>
      ((await response.json()) as { message: string }).message;

    const flag = await pair(unitFree.code, clerk.nik);
    expect(flag.status).toBe(422);
    expect(await message(flag)).toContain("alokasi fleet");

    const skill = await pair(unitReq.code, opNoSkill.nik);
    expect(skill.status).toBe(422);
    expect(await message(skill)).toContain(skillCode.name);

    const expired = await pair(unitReq.code, opExpired.nik);
    expect(expired.status).toBe(422);
    expect(await message(expired)).toContain("kedaluwarsa");

    const dept = await pair(unitDept.code, opWrongDept.nik);
    expect(dept.status).toBe(422);
    expect(await message(dept)).toContain(`${tag} A`);
  });
});

/* -------------------------------------------------------------- the pair */

describe("a unit's two operators are a Day/Night pair", () => {
  test("same shift is refused, opposite accepted, missing roster tolerated", async () => {
    expect((await pair(unitFree.code, opDay.nik)).status).toBe(201);

    // Two Day operators are a queue, not a pair.
    const sameShift = await pair(unitFree.code, opDay2.nik);
    expect(sameShift.status).toBe(422);
    expect(((await sameShift.json()) as { message: string }).message).toContain(
      "pagi"
    );

    expect((await pair(unitFree.code, opNight.nik)).status).toBe(201);

    // Full at two, whoever asks.
    const full = await pair(unitFree.code, opFree.nik);
    expect(full.status).toBe(409);
    expect(await full.json()).toMatchObject({ code: "unit_full" });
  });

  test("an operator pairs with one unit, and the second asks says which", async () => {
    expect((await pair(unitReq.code, opFit.nik)).status).toBe(201);

    const rows = await candidatesFor(unitDept.code);
    expect(candidateOf(rows, opFit)).toMatchObject({
      eligible: false,
      busyAt: unitReq.code,
    });

    const again = await pair(unitDept.code, opFit.nik);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "operator_busy" });
  });

  test("view may look and not pair", async () => {
    const response = await send(
      "POST",
      "/fleet-allocation/plan/slots",
      viewer.cookie,
      { unitCode: unitFree.code, nik: opFree.nik }
    );
    expect(response.status).toBe(403);
  });
});

/* -------------------------------------------------------------- the board */

describe("the board composes what the screen renders", () => {
  test("slots, shifts, and spares in one document", async () => {
    const response = await send("GET", "/fleet-allocation/plan", viewer.cookie);
    expect(response.status).toBe(200);
    const board = (await response.json()) as {
      units: {
        code: string;
        slots: { nik: string; rosterShift: string | null }[];
      }[];
      spares: { nik: string }[];
    };

    const free = board.units.find((u) => u.code === unitFree.code);
    expect(free?.slots.map((s) => s.nik).sort()).toEqual(
      [opDay.nik, opNight.nik].sort()
    );
    expect(free?.slots.find((s) => s.nik === opDay.nik)?.rosterShift).toBe(
      "day"
    );

    const spares = board.spares.map((s) => s.nik);
    // Paired operators left the pool; unpaired ones remain; a position
    // outside fleet allocation was never in it.
    expect(spares).not.toContain(opFit.nik);
    expect(spares).toContain(opFree.nik);
    expect(spares).not.toContain(clerk.nik);
  });

  test("a spare carries the SIMPER codes they hold", async () => {
    /* The pool is browsed by someone deciding who can drive a given unit, and
       that is exactly what a code answers. Sending it with the board rather
       than making the screen ask per operator is what keeps a pool of several
       hundred to one request. */
    const board = (await (
      await send("GET", "/fleet-allocation/plan", viewer.cookie)
    ).json()) as { spares: { nik: string; skills: string[] }[] };

    const free = board.spares.find((s) => s.nik === opFree.nik);
    expect(free?.skills).toEqual([skillCode.name]);

    // And an operator with none of them says so with an empty list, not by
    // omitting the field — the screen renders no badges either way, but only
    // one of those shapes survives a client that reads `.length`.
    const bare = board.spares.find((s) => s.nik === opNoSkill.nik);
    expect(bare?.skills).toEqual([]);
  });

  test("releasing frees the slot and the spare returns", async () => {
    const release = await send(
      "DELETE",
      `/fleet-allocation/plan/slots/${unitFree.code}/${opDay.nik}`,
      admin.cookie
    );
    expect(release.status).toBe(200);

    const again = await send(
      "DELETE",
      `/fleet-allocation/plan/slots/${unitFree.code}/${opDay.nik}`,
      admin.cookie
    );
    expect(again.status).toBe(404);

    const board = (await (
      await send("GET", "/fleet-allocation/plan", admin.cookie)
    ).json()) as {
      units: { code: string; slots: { nik: string }[] }[];
      spares: { nik: string }[];
    };
    const free = board.units.find((u) => u.code === unitFree.code);
    expect(free?.slots.map((s) => s.nik)).toEqual([opNight.nik]);
    expect(board.spares.map((s) => s.nik)).toContain(opDay.nik);
  });
});

/**
 * What the board leaves out.
 *
 * The sharp edge of scoping, pinned on its own: a unit nobody configured does
 * not appear as a vacancy, so it goes quiet rather than loudly empty. That was
 * accepted deliberately (owner, 2026-08-31) — unscoped, the board covered the
 * whole register and every forklift and ambulance stood as an idle card nobody
 * would ever fill — but it has to stay a fact the suite states out loud rather
 * than one a future reader discovers.
 */
describe("PLAN carries the whole register, the engine does not", () => {
  test("a unit in no formation is on the PLAN board, with no fleet", async () => {
    /* The two scopes differ on purpose. A standing pairing is a fact about a
       person and a machine — true whether or not the machine is in a formation
       today — so PLAN has to be able to show it. Automatic allocation is a
       different question, and `allocation.test.ts` pins that it answers only
       about formations. */
    const board = (await (
      await send("GET", "/fleet-allocation/plan", admin.cookie)
    ).json()) as { units: { code: string; fleet: unknown }[] };

    const listed = board.units.find((u) => u.code === unitFree.code);
    expect(listed).toBeDefined();
    expect(listed!.fleet).not.toBeNull();

    // Take it out of its formation: it stays on the board and loses its fleet,
    // which is what puts it under the filter's no-fleet entry.
    await db
      .delete(schema.fleetUnits)
      .where(eq(schema.fleetUnits.unitId, unitFree.id));
    const after = (await (
      await send("GET", "/fleet-allocation/plan", admin.cookie)
    ).json()) as { units: { code: string; fleet: unknown }[] };
    const loose = after.units.find((u) => u.code === unitFree.code);
    expect(loose).toBeDefined();
    expect(loose!.fleet).toBeNull();

    // Put it back for the suites that follow.
    await db.insert(schema.fleetUnits).values({ fleetId, unitId: unitFree.id });
  });
});
