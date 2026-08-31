/**
 * Fleet composition rules, driven through the real routes.
 *
 * The exclusivity promises the screen makes — a digger leads once, a hauler
 * hauls for one fleet, a leader never hauls — live in the database and in
 * `refuseComposition`; these tests pin both the refusals and their shapes.
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/fleets.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray, sql } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { fleetsRoutes } from "./fleets";

const app = new Elysia().use(fleetsRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji Fleet ${uid()}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  fleets: [] as string[],
  units: [] as string[],
  catalogues: [] as {
    table: "classes" | "types" | "models" | "brands";
    id: string;
  }[],
  workAreas: [] as string[],
};

let admin: { cookie: string };
let viewer: { cookie: string };

let miningArea = "";
let officeArea = "";
let busTypeId = "";
let busTypeCreated = false;

let digger1 = { id: "", code: "" };
let digger2 = { id: "", code: "" };
let hauler1 = { id: "", code: "" };
let hauler2 = { id: "", code: "" };
let hauler3 = { id: "", code: "" };
let busUnit = { id: "", code: "" };

/* ------------------------------------------------------------- fixtures */

async function makeUser(mode: "view" | "manage") {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-fleet-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values([{ roleId: role!.id, menuSlug: "fleet-setting", mode }]);
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
  return { cookie: `${SESSION_COOKIE}=${session.id}` };
}

async function makeUnit(
  code: string,
  typeId: string,
  refs: {
    classId: string;
    modelId: string;
    brandId: string;
  }
) {
  const [row] = await db
    .insert(schema.units)
    .values({ code, typeId, ...refs })
    .returning({ id: schema.units.id, code: schema.units.code });
  made.units.push(row!.id);
  return { id: row!.id, code: row!.code };
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

type FleetBody = {
  id: string;
  diggerCode: string;
  workAreaName: string;
  busCode: string | null;
  units: { id: string; code: string }[];
  active: boolean;
};

/** Create through the route, remember for teardown, hand back the body. */
async function createFleet(body: Record<string, unknown>) {
  const response = await send("POST", "/fleets", admin.cookie, body);
  expect(response.status).toBe(201);
  const fleet = (await response.json()) as FleetBody;
  made.fleets.push(fleet.id);
  return fleet;
}

beforeAll(async () => {
  // scheduler.test.ts disconnects the shared client in its teardown, and bun
  // runs every file in one process.
  if (redis.status === "end") await redis.connect();

  admin = await makeUser("manage");
  viewer = await makeUser("view");

  const [cls] = await db
    .insert(schema.unitClasses)
    .values({ name: `${tag} CLASS` })
    .returning({ id: schema.unitClasses.id });
  made.catalogues.push({ table: "classes", id: cls!.id });
  const [typ] = await db
    .insert(schema.unitTypes)
    .values({ name: `${tag} TYPE` })
    .returning({ id: schema.unitTypes.id });
  made.catalogues.push({ table: "types", id: typ!.id });
  const [mdl] = await db
    .insert(schema.unitModels)
    .values({ name: `${tag} MODEL` })
    .returning({ id: schema.unitModels.id });
  made.catalogues.push({ table: "models", id: mdl!.id });
  const [brd] = await db
    .insert(schema.unitBrands)
    .values({ name: `${tag} BRAND` })
    .returning({ id: schema.unitBrands.id });
  made.catalogues.push({ table: "brands", id: brd!.id });

  // The bus check compares the type's *name*, so the fixture needs the real
  // `BUS` row — reused when the seed already holds it, created (and later
  // removed) when it does not.
  const [existingBus] = await db
    .select({ id: schema.unitTypes.id })
    .from(schema.unitTypes)
    .where(sql`lower(${schema.unitTypes.name}) = 'bus'`)
    .limit(1);
  if (existingBus) {
    busTypeId = existingBus.id;
  } else {
    const [created] = await db
      .insert(schema.unitTypes)
      .values({ name: "BUS" })
      .returning({ id: schema.unitTypes.id });
    busTypeId = created!.id;
    busTypeCreated = true;
  }

  const [mining] = await db
    .insert(schema.workAreas)
    .values({ name: `${tag} PIT`, type: "Mining" })
    .returning({ id: schema.workAreas.id });
  const [office] = await db
    .insert(schema.workAreas)
    .values({ name: `${tag} OFFICE`, type: "Non Mining" })
    .returning({ id: schema.workAreas.id });
  miningArea = mining!.id;
  officeArea = office!.id;
  made.workAreas.push(miningArea, officeArea);

  const refs = { classId: cls!.id, modelId: mdl!.id, brandId: brd!.id };
  digger1 = await makeUnit(`ZZEX1${uid()}`, typ!.id, refs);
  digger2 = await makeUnit(`ZZEX2${uid()}`, typ!.id, refs);
  hauler1 = await makeUnit(`ZZDT1${uid()}`, typ!.id, refs);
  hauler2 = await makeUnit(`ZZDT2${uid()}`, typ!.id, refs);
  hauler3 = await makeUnit(`ZZDT3${uid()}`, typ!.id, refs);
  busUnit = await makeUnit(`ZZBS1${uid()}`, busTypeId, refs);
});

afterAll(async () => {
  if (made.fleets.length)
    await db
      .delete(schema.fleets)
      .where(inArray(schema.fleets.id, made.fleets));
  if (made.units.length) {
    await db
      .delete(schema.noFleetUnits)
      .where(inArray(schema.noFleetUnits.unitId, made.units));
    await db.delete(schema.units).where(inArray(schema.units.id, made.units));
  }
  for (const { table, id } of made.catalogues) {
    const target = {
      classes: schema.unitClasses,
      types: schema.unitTypes,
      models: schema.unitModels,
      brands: schema.unitBrands,
    }[table];
    await db.delete(target).where(eq(target.id, id));
  }
  if (busTypeCreated)
    await db.delete(schema.unitTypes).where(eq(schema.unitTypes.id, busTypeId));
  if (made.workAreas.length)
    await db
      .delete(schema.workAreas)
      .where(inArray(schema.workAreas.id, made.workAreas));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

/* ------------------------------------------------------------ composition */

describe("a fleet is a digger, its haulers, and a Mining work area", () => {
  test("view may list and not write", async () => {
    const list = await send("GET", "/fleets", viewer.cookie);
    expect(list.status).toBe(200);
    const create = await send("POST", "/fleets", viewer.cookie, {
      diggerUnitId: digger1.id,
      workAreaId: miningArea,
      unitIds: [hauler1.id],
    });
    expect(create.status).toBe(403);
  });

  test("a fleet is created whole — digger, bus, members, area", async () => {
    const fleet = await createFleet({
      diggerUnitId: digger1.id,
      workAreaId: miningArea,
      busUnitId: busUnit.id,
      unitIds: [hauler1.id, hauler2.id],
    });
    expect(fleet.diggerCode).toBe(digger1.code);
    expect(fleet.workAreaName).toBe(`${tag} PIT`);
    expect(fleet.busCode).toBe(busUnit.code);
    expect(fleet.units.map((u) => u.code).sort()).toEqual(
      [hauler1.code, hauler2.code].sort()
    );
    expect(fleet.active).toBe(true);
  });

  test("a digger leads at most one fleet", async () => {
    const response = await send("POST", "/fleets", admin.cookie, {
      diggerUnitId: digger1.id,
      workAreaId: miningArea,
      unitIds: [hauler3.id],
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "fleet_exists" });
  });

  test("a hauler hauls for one fleet, and the refusal names it", async () => {
    const response = await send("POST", "/fleets", admin.cookie, {
      diggerUnitId: digger2.id,
      workAreaId: miningArea,
      unitIds: [hauler1.id],
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain(hauler1.code);
  });

  test("a digger cannot haul for itself", async () => {
    const response = await send("POST", "/fleets", admin.cookie, {
      diggerUnitId: digger2.id,
      workAreaId: miningArea,
      unitIds: [digger2.id],
    });
    expect(response.status).toBe(422);
  });

  test("a fleet leader cannot be another fleet's hauler", async () => {
    const response = await send("POST", "/fleets", admin.cookie, {
      diggerUnitId: digger2.id,
      workAreaId: miningArea,
      unitIds: [digger1.id],
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("memimpin");
  });

  test("the bus must be a unit of type BUS", async () => {
    const response = await send("POST", "/fleets", admin.cookie, {
      diggerUnitId: digger2.id,
      workAreaId: miningArea,
      busUnitId: hauler3.id,
      unitIds: [hauler3.id],
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("BUS");
  });

  test("the location must be a Mining work area", async () => {
    const response = await send("POST", "/fleets", admin.cookie, {
      diggerUnitId: digger2.id,
      workAreaId: officeArea,
      unitIds: [hauler3.id],
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("Mining");
  });

  test("the member list is bounded", async () => {
    const response = await send("POST", "/fleets", admin.cookie, {
      diggerUnitId: digger2.id,
      workAreaId: miningArea,
      unitIds: Array.from({ length: 14 }, () => crypto.randomUUID()),
    });
    expect(response.status).toBe(422);
  });
});

/* ------------------------------------------------------------------- edits */

describe("editing replaces the member list; deleting releases it", () => {
  test("an edit keeps what it keeps and frees what it drops", async () => {
    // Found by digger code, not by list position — the dev database holds the
    // seeded sample fleets beside this file's fixtures.
    const all = (await (
      await send("GET", "/fleets", admin.cookie)
    ).json()) as (FleetBody & { diggerCode: string })[];
    const fleet = all.find((f) => f.diggerCode === digger1.code);
    expect(fleet).toBeDefined();

    // Keeping hauler2 must not read as "already in a fleet" — it is in *this*
    // one. hauler1 is dropped, hauler3 picked up.
    const response = await send("PATCH", `/fleets/${fleet!.id}`, admin.cookie, {
      diggerUnitId: digger1.id,
      workAreaId: miningArea,
      busUnitId: null,
      unitIds: [hauler2.id, hauler3.id],
    });
    expect(response.status).toBe(200);
    const edited = (await response.json()) as FleetBody;
    expect(edited.busCode).toBeNull();
    expect(edited.units.map((u) => u.code).sort()).toEqual(
      [hauler2.code, hauler3.code].sort()
    );

    // The freed hauler is immediately offerable to a second fleet.
    const second = await createFleet({
      diggerUnitId: digger2.id,
      workAreaId: miningArea,
      unitIds: [hauler1.id],
      active: false,
    });
    expect(second.units.map((u) => u.code)).toEqual([hauler1.code]);
    expect(second.active).toBe(false);
  });

  test("deleting a fleet releases its members and leaves the units", async () => {
    const second = made.fleets[made.fleets.length - 1]!;
    const response = await send("DELETE", `/fleets/${second}`, admin.cookie);
    expect(response.status).toBe(200);

    const memberships = await db
      .select()
      .from(schema.fleetUnits)
      .where(eq(schema.fleetUnits.fleetId, second));
    expect(memberships).toEqual([]);
    const [unit] = await db
      .select({ id: schema.units.id })
      .from(schema.units)
      .where(eq(schema.units.id, hauler1.id));
    expect(unit).toBeDefined();

    const again = await send("DELETE", `/fleets/${second}`, admin.cookie);
    expect(again.status).toBe(404);
  });
});

/* --------------------------------------------------------------- no-fleet */

/**
 * The fixed entry for machines in no formation.
 *
 * What is worth pinning is the exclusivity — a unit is configured in exactly
 * one place — and that the list is *replaced*, because the dialog submits what
 * it means rather than a diff. Which fixture happens to be free by the time
 * these run depends on the suites above, so the units under test are read from
 * the database rather than assumed.
 */
describe("the no-fleet entry", () => {
  /** A unit currently leading a fleet, and one currently hauling for one. */
  async function claimed() {
    const [leader] = await db
      .select({ id: schema.fleets.diggerUnitId, code: schema.units.code })
      .from(schema.fleets)
      .innerJoin(schema.units, eq(schema.units.id, schema.fleets.diggerUnitId))
      .where(inArray(schema.fleets.id, made.fleets))
      .limit(1);
    const [hauler] = await db
      .select({ id: schema.fleetUnits.unitId, code: schema.units.code })
      .from(schema.fleetUnits)
      .innerJoin(schema.units, eq(schema.units.id, schema.fleetUnits.unitId))
      .where(inArray(schema.fleetUnits.fleetId, made.fleets))
      .limit(1);
    return { leader, hauler };
  }

  /** A unit this suite made that no formation has claimed. */
  async function free() {
    const rows = await db
      .select({ id: schema.units.id, code: schema.units.code })
      .from(schema.units)
      .where(inArray(schema.units.id, made.units));
    const { leader, hauler } = await claimed();
    const takenIds = await db
      .select({ id: schema.fleetUnits.unitId })
      .from(schema.fleetUnits);
    const leaders = await db
      .select({ id: schema.fleets.diggerUnitId })
      .from(schema.fleets);
    const taken = new Set([
      ...takenIds.map((r) => r.id),
      ...leaders.map((r) => r.id),
      leader?.id,
      hauler?.id,
    ]);
    return rows.find((u) => !taken.has(u.id))!;
  }

  test("answers with a list and needs no creating", async () => {
    const response = await send("GET", "/fleets/no-fleet", viewer.cookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { units: { code: string }[] };
    expect(Array.isArray(body.units)).toBe(true);
  });

  test("replaces its unit list rather than adding to it", async () => {
    const unit = await free();
    const first = await send("PUT", "/fleets/no-fleet/units", admin.cookie, {
      unitIds: [unit.id],
    });
    expect(first.status).toBe(200);
    expect(
      ((await first.json()) as { units: { code: string }[] }).units.map(
        (u) => u.code
      )
    ).toEqual([unit.code]);

    // Emptied, not merged: a replaced list is the whole list.
    const second = await send("PUT", "/fleets/no-fleet/units", admin.cookie, {
      unitIds: [],
    });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { units: unknown[] }).units).toEqual([]);
  });

  test("refuses a unit that already leads a fleet, by name", async () => {
    const { leader } = await claimed();
    const response = await send("PUT", "/fleets/no-fleet/units", admin.cookie, {
      unitIds: [leader!.id],
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { message: string }).message).toContain(
      leader!.code
    );
  });

  test("refuses a unit that already hauls for a fleet, by name", async () => {
    const { hauler } = await claimed();
    const response = await send("PUT", "/fleets/no-fleet/units", admin.cookie, {
      unitIds: [hauler!.id],
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { message: string }).message).toContain(
      hauler!.code
    );
  });

  test("is read-only for a viewer", async () => {
    const response = await send(
      "PUT",
      "/fleets/no-fleet/units",
      viewer.cookie,
      { unitIds: [] }
    );
    expect(response.status).toBe(403);
  });

  test("cannot be deleted — there is no route that would", async () => {
    // "no-fleet" is not a fleet id, so the disband route refuses it outright.
    // The entry is part of the screen rather than a record, which is what
    // makes undeletable structural instead of a rule to remember.
    const response = await send("DELETE", "/fleets/no-fleet", admin.cookie);
    expect(response.status).not.toBe(200);
  });
});
