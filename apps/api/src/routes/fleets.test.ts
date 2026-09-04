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
};

let admin: { cookie: string };
let viewer: { cookie: string };

const pit = `${tag} PIT`;
let busTypeId = "";
let busTypeCreated = false;

let digger1 = { id: "", code: "" };
let digger2 = { id: "", code: "" };
let hauler1 = { id: "", code: "" };
let hauler2 = { id: "", code: "" };
let hauler3 = { id: "", code: "" };
let busUnit = { id: "", code: "" };
/** A formation of its own, so disbanding it disturbs no other test. */
let spare1 = { id: "", code: "" };
let spare2 = { id: "", code: "" };

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
  leaderCode: string;
  workArea: string;
  units: {
    id: string;
    code: string;
    transportUnitId: string | null;
    transportCode: string | null;
  }[];
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

  const refs = { classId: cls!.id, modelId: mdl!.id, brandId: brd!.id };
  spare1 = await makeUnit(`ZZEX9${uid()}`, typ!.id, refs);
  spare2 = await makeUnit(`ZZDT9${uid()}`, typ!.id, refs);
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
  if (made.units.length)
    await db.delete(schema.units).where(inArray(schema.units.id, made.units));
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
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

/* ------------------------------------------------------------ composition */

describe("a fleet is a leader, its haulers, and one work area", () => {
  test("view may list and not write", async () => {
    const list = await send("GET", "/fleets", viewer.cookie);
    expect(list.status).toBe(200);
    const create = await send("POST", "/fleets", viewer.cookie, {
      leaderUnitId: digger1.id,
      workArea: pit,
      unitIds: [hauler1.id],
    });
    expect(create.status).toBe(403);
  });

  test("a fleet is created whole — leader, members, area, transport", async () => {
    const fleet = await createFleet({
      leaderUnitId: digger1.id,
      workArea: pit,
      unitIds: [hauler1.id, hauler2.id],
      // Per unit since 2026-09-04. The dialog sends one value for the whole
      // formation; the shape it sends is still a map, unit by unit.
      transports: {
        [digger1.id]: busUnit.id,
        [hauler1.id]: busUnit.id,
        [hauler2.id]: busUnit.id,
      },
    });
    expect(fleet.leaderCode).toBe(digger1.code);
    expect(fleet.workArea).toBe(pit);
    expect(fleet.units.map((u) => u.code).sort()).toEqual(
      [hauler1.code, hauler2.code].sort()
    );
    expect(fleet.units.every((u) => u.transportCode === busUnit.code)).toBe(
      true
    );
    expect(fleet.active).toBe(true);

    /* The area is written to the leader and to every member — which is how
       "one formation cannot span two areas" is enforced now that the column
       lives on the unit. */
    const areas = await db
      .select({ workArea: schema.units.workArea })
      .from(schema.units)
      .where(inArray(schema.units.id, [digger1.id, hauler1.id, hauler2.id]));
    expect(areas.every((r) => r.workArea === pit)).toBe(true);
  });

  test("a digger leads at most one fleet", async () => {
    const response = await send("POST", "/fleets", admin.cookie, {
      leaderUnitId: digger1.id,
      workArea: pit,
      unitIds: [hauler3.id],
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "fleet_exists" });
  });

  test("a hauler hauls for one fleet, and the refusal names it", async () => {
    const response = await send("POST", "/fleets", admin.cookie, {
      leaderUnitId: digger2.id,
      workArea: pit,
      unitIds: [hauler1.id],
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain(hauler1.code);
  });

  test("a digger cannot haul for itself", async () => {
    const response = await send("POST", "/fleets", admin.cookie, {
      leaderUnitId: digger2.id,
      workArea: pit,
      unitIds: [digger2.id],
    });
    expect(response.status).toBe(422);
  });

  test("a fleet leader cannot be another fleet's hauler", async () => {
    const response = await send("POST", "/fleets", admin.cookie, {
      leaderUnitId: digger2.id,
      workArea: pit,
      unitIds: [digger1.id],
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("memimpin");
  });

  test("transport must be a bus or a manhaul truck", async () => {
    const response = await send("POST", "/fleets", admin.cookie, {
      leaderUnitId: digger2.id,
      workArea: pit,
      unitIds: [hauler3.id],
      transports: { [hauler3.id]: hauler3.id },
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("BUS");
  });

  test("disbanding takes its units out of the location it gave them", async () => {
    const fleet = await createFleet({
      leaderUnitId: spare1.id,
      workArea: `${tag} BUBAR`,
      unitIds: [spare2.id],
      transports: { [spare1.id]: busUnit.id, [spare2.id]: busUnit.id },
    });

    const response = await send("DELETE", `/fleets/${fleet.id}`, admin.cookie);
    expect(response.status).toBe(200);

    /* The units survive and are offerable again — what they lose is the
       location and the ride the formation gave them. Left behind, those values
       had the Unit Status screen naming a pit the machine was pulled out of. */
    const rows = await db
      .select({
        workArea: schema.units.workArea,
        transportUnitId: schema.units.transportUnitId,
      })
      .from(schema.units)
      .where(inArray(schema.units.id, [spare1.id, spare2.id]));
    expect(rows).toHaveLength(2);
    for (const row of rows)
      expect(row).toMatchObject({ workArea: null, transportUnitId: null });
  });

  test("a blank location is refused — it is typed, so nothing else checks it", async () => {
    const response = await send("POST", "/fleets", admin.cookie, {
      leaderUnitId: digger2.id,
      workArea: "",
      unitIds: [hauler3.id],
    });
    expect(response.status).toBe(422);
  });

  test("the member list is bounded", async () => {
    const response = await send("POST", "/fleets", admin.cookie, {
      leaderUnitId: digger2.id,
      workArea: pit,
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
    ).json()) as (FleetBody & { leaderCode: string })[];
    const fleet = all.find((f) => f.leaderCode === digger1.code);
    expect(fleet).toBeDefined();

    // Keeping hauler2 must not read as "already in a fleet" — it is in *this*
    // one. hauler1 is dropped, hauler3 picked up.
    const response = await send("PATCH", `/fleets/${fleet!.id}`, admin.cookie, {
      leaderUnitId: digger1.id,
      workArea: pit,
      unitIds: [hauler2.id, hauler3.id],
      transports: {
        [digger1.id]: null,
        [hauler2.id]: null,
        [hauler3.id]: null,
      },
    });
    expect(response.status).toBe(200);
    const edited = (await response.json()) as FleetBody;
    expect(edited.units.every((u) => u.transportCode === null)).toBe(true);
    expect(edited.units.map((u) => u.code).sort()).toEqual(
      [hauler2.code, hauler3.code].sort()
    );

    // The freed hauler is immediately offerable to a second fleet.
    const second = await createFleet({
      leaderUnitId: digger2.id,
      workArea: pit,
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
 * Its membership is derived, not stored (owner, 2026-08-31): every active unit
 * that leads no fleet and hauls for none is in it, and there is nothing to
 * edit. What is worth pinning is exactly that — the entry follows the
 * formations by itself, and a reshuffle can never leave it stale.
 *
 * Which fixture happens to be free by the time these run depends on the suites
 * above, so the units under test are read from the database rather than
 * assumed.
 */
describe("the no-fleet entry", () => {
  /** A unit currently leading a fleet, and one currently hauling for one. */
  async function claimed() {
    const [leader] = await db
      .select({ id: schema.fleets.leaderUnitId, code: schema.units.code })
      .from(schema.fleets)
      .innerJoin(schema.units, eq(schema.units.id, schema.fleets.leaderUnitId))
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

  const codes = async () => {
    const response = await send("GET", "/fleets/no-fleet", viewer.cookie);
    expect(response.status).toBe(200);
    return ((await response.json()) as { units: { code: string }[] }).units.map(
      (u) => u.code
    );
  };

  test("answers with a list and needs no creating", async () => {
    expect(Array.isArray(await codes())).toBe(true);
  });

  test("excludes a unit that leads a fleet, and one that hauls for one", async () => {
    // The two ways a unit is *in* allocation are the two ways it is out of
    // this list. Storing membership made that an invariant somebody had to
    // maintain; deriving it makes it arithmetic.
    const { leader, hauler } = await claimed();
    const listed = await codes();
    expect(listed).not.toContain(leader!.code);
    expect(listed).not.toContain(hauler!.code);
  });

  test("takes a unit back the moment it leaves its formation", async () => {
    // The reason this entry is derived at all: formations are reshuffled
    // often, and a stored list of "everything else" would go stale silently.
    const { hauler } = await claimed();
    expect(await codes()).not.toContain(hauler!.code);

    const [row] = await db
      .select({ fleetId: schema.fleetUnits.fleetId })
      .from(schema.fleetUnits)
      .where(eq(schema.fleetUnits.unitId, hauler!.id))
      .limit(1);
    await db
      .delete(schema.fleetUnits)
      .where(eq(schema.fleetUnits.unitId, hauler!.id));
    expect(await codes()).toContain(hauler!.code);

    // Put it back, so the suites after this one see what they expect.
    await db
      .insert(schema.fleetUnits)
      .values({ fleetId: row!.fleetId, unitId: hauler!.id });
    expect(await codes()).not.toContain(hauler!.code);
  });

  test("has no write route at all", async () => {
    // Not "forbidden for a viewer" — there is nothing to write. Membership is
    // a consequence of the formations, so an editing endpoint could only ever
    // disagree with them.
    const response = await send("PUT", "/fleets/no-fleet/units", admin.cookie, {
      unitIds: [],
    });
    expect(response.status).not.toBe(200);
  });

  test("cannot be deleted — there is no route that would", async () => {
    // "no-fleet" is not a fleet id, so the disband route refuses it outright.
    // The entry is part of the screen rather than a record, which is what
    // makes undeletable structural instead of a rule to remember.
    const response = await send("DELETE", "/fleets/no-fleet", admin.cookie);
    expect(response.status).not.toBe(200);
  });
});

/* ------------------------------------------------------------ bulk delete */

/**
 * Disbanding a ticked selection in one go.
 *
 * Its own fixtures rather than the shared ones: the suites above consume the
 * module-level units as they go, and a bulk delete has to be able to say
 * exactly which formations it removed.
 */
describe("several formations disband at once", () => {
  let fleetA = "";
  let fleetB = "";
  let hauler = { id: "", code: "" };

  beforeAll(async () => {
    const refs = {
      classId: made.catalogues.find((c) => c.table === "classes")!.id,
      modelId: made.catalogues.find((c) => c.table === "models")!.id,
      brandId: made.catalogues.find((c) => c.table === "brands")!.id,
    };
    const typeId = made.catalogues.find((c) => c.table === "types")!.id;

    const digA = await makeUnit(`ZZBX1${uid()}`, typeId, refs);
    const digB = await makeUnit(`ZZBX2${uid()}`, typeId, refs);
    hauler = await makeUnit(`ZZBH1${uid()}`, typeId, refs);
    const haulerB = await makeUnit(`ZZBH2${uid()}`, typeId, refs);

    fleetA = (
      await createFleet({
        leaderUnitId: digA.id,
        workArea: pit,
        unitIds: [hauler.id],
      })
    ).id;
    fleetB = (
      await createFleet({
        leaderUnitId: digB.id,
        workArea: pit,
        unitIds: [haulerB.id],
      })
    ).id;
  });

  test("a viewer may not", async () => {
    const response = await send("POST", "/fleets/bulk-delete", viewer.cookie, {
      ids: [fleetA],
    });
    expect(response.status).toBe(403);
  });

  test("both go, their members are released, and the units survive", async () => {
    const response = await send("POST", "/fleets/bulk-delete", admin.cookie, {
      ids: [fleetA, fleetB],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 2 });

    const rows = await db
      .select({ id: schema.fleets.id })
      .from(schema.fleets)
      .where(inArray(schema.fleets.id, [fleetA, fleetB]));
    expect(rows).toEqual([]);

    const memberships = await db
      .select()
      .from(schema.fleetUnits)
      .where(inArray(schema.fleetUnits.fleetId, [fleetA, fleetB]));
    expect(memberships).toEqual([]);

    // The point of the whole screen: the machines outlive the formation.
    const [unit] = await db
      .select({ id: schema.units.id })
      .from(schema.units)
      .where(eq(schema.units.id, hauler.id));
    expect(unit).toBeDefined();
  });

  test("an id already gone still counts as deleted", async () => {
    // The end state the caller asked for holds. A list left open while someone
    // else disbanded a fleet should not read as a failed delete.
    const response = await send("POST", "/fleets/bulk-delete", admin.cookie, {
      ids: [fleetA, fleetA, crypto.randomUUID()],
    });
    expect(response.status).toBe(200);
    // Two distinct ids, not three: the repeat cannot inflate the count.
    expect(await response.json()).toEqual({ deleted: 2 });
  });

  test("an empty selection is refused rather than treated as all", async () => {
    const response = await send("POST", "/fleets/bulk-delete", admin.cookie, {
      ids: [],
    });
    expect(response.status).toBe(422);
  });
});
