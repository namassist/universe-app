/**
 * The display registry's newer half: how long a screen dwells on one subject,
 * and which formations it is pointed at.
 *
 * The pairing and heartbeat halves are exercised through the display routes;
 * what is pinned here is the fleet-pick contract, because its rules are the
 * kind that fail silently — a pick stored on a screen that will never read it
 * looks configured and does nothing.
 *
 *   bun --env-file=.env test src/routes/devices.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { devicesRoutes } from "./devices";

const app = new Elysia().use(devicesRoutes);
const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Display ${uid()}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  devices: [] as string[],
  fleets: [] as string[],
  units: [] as string[],
  areas: [] as string[],
  catalogues: [] as {
    table: "unitClasses" | "unitTypes" | "unitModels" | "unitBrands";
    id: string;
  }[],
};

/**
 * Five formations of this suite's own.
 *
 * Borrowing whatever the dev database happened to hold was a mistake: these
 * tests are about how many formations a screen may carry, and the answer
 * changed the day somebody disbanded a fleet — a failure that says nothing
 * about the code under test.
 */
async function makeFleets(count: number): Promise<string[]> {
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
  made.catalogues.push(
    { table: "unitClasses", id: cls!.id },
    { table: "unitTypes", id: typ!.id },
    { table: "unitModels", id: mdl!.id },
    { table: "unitBrands", id: brd!.id }
  );
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const [unit] = await db
      .insert(schema.units)
      .values({
        code: `ZZF${uid().toUpperCase()}`,
        classId: cls!.id,
        typeId: typ!.id,
        modelId: mdl!.id,
        brandId: brd!.id,
      })
      .returning({ id: schema.units.id });
    made.units.push(unit!.id);
    const [fleet] = await db
      .insert(schema.fleets)
      .values({ leaderUnitId: unit!.id })
      .returning({ id: schema.fleets.id });
    made.fleets.push(fleet!.id);
    ids.push(fleet!.id);
  }
  return ids;
}

/** The ids the layout tests pick from — created once, in beforeAll. */
let fixtureFleets: string[] = [];
let admin: { cookie: string };

const send = (method: string, path: string, cookie?: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  );

/** A device id nothing else in the dev database will collide with. */
const newId = () => {
  const id = `ZZD${uid().toUpperCase()}`;
  made.devices.push(id);
  return id;
};

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-disp-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db.insert(schema.rolePermissions).values([
    { roleId: role!.id, menuSlug: "display-fleet", mode: "manage" },
    { roleId: role!.id, menuSlug: "display-fitwork", mode: "manage" },
  ]);
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
  admin = { cookie: `${SESSION_COOKIE}=${session.id}` };

  fixtureFleets = await makeFleets(5);
});

afterAll(async () => {
  // Devices first: `device_fleets` cascades from both sides, so the picks go
  // with whichever end is deleted, but the fleets must outlive nothing.
  if (made.devices.length)
    await db
      .delete(schema.devices)
      .where(inArray(schema.devices.id, made.devices));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
  if (made.fleets.length)
    await db
      .delete(schema.fleets)
      .where(inArray(schema.fleets.id, made.fleets));
  if (made.units.length)
    await db.delete(schema.units).where(inArray(schema.units.id, made.units));
  for (const { table, id } of made.catalogues)
    await db.delete(schema[table]).where(eq(schema[table].id, id));
});

describe("how long a screen dwells", () => {
  test("defaults to thirty seconds when the caller says nothing", async () => {
    const res = await send("POST", "/devices", admin.cookie, {
      id: newId(),
      name: tag,
      kind: "fleet",
    });
    expect(res.status).toBe(201);
    expect(
      ((await res.json()) as { rotateSeconds: number }).rotateSeconds
    ).toBe(30);
  });

  test("takes the caller's own duration", async () => {
    const id = newId();
    await send("POST", "/devices", admin.cookie, {
      id,
      name: tag,
      kind: "fleet",
      rotateSeconds: 45,
    });
    const res = await send("PATCH", `/devices/${id}`, admin.cookie, {
      rotateSeconds: 8,
    });
    expect(
      ((await res.json()) as { rotateSeconds: number }).rotateSeconds
    ).toBe(8);
  });

  test("refuses a duration nothing could be read at", async () => {
    const res = await send("POST", "/devices", admin.cookie, {
      id: newId(),
      name: tag,
      kind: "fleet",
      rotateSeconds: 1,
    });
    expect(res.status).toBe(422);
  });
});

describe("which formations a screen shows", () => {
  test("starts unscoped, which means every fleet", async () => {
    const res = await send("POST", "/devices", admin.cookie, {
      id: newId(),
      name: tag,
      kind: "fleet",
    });
    expect(((await res.json()) as { fleetIds: string[] }).fleetIds).toEqual([]);
  });

  test("refuses a pick on a screen that is not a fleet wall", async () => {
    // Storing it would leave a setting that looks configured and does nothing:
    // no other kiosk reads `device_fleets`.
    const res = await send("POST", "/devices", admin.cookie, {
      id: newId(),
      name: tag,
      kind: "fitwork",
      fleetIds: [crypto.randomUUID()],
    });
    expect(res.status).toBe(422);
  });

  test("refuses a fleet that no longer exists", async () => {
    const res = await send("POST", "/devices", admin.cookie, {
      id: newId(),
      name: tag,
      kind: "fleet",
      fleetIds: [crypto.randomUUID()],
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe(
      "fleet_not_found"
    );
  });

  test("an empty list hands the screen back to every fleet", async () => {
    const id = newId();
    await send("POST", "/devices", admin.cookie, {
      id,
      name: tag,
      kind: "fleet",
    });
    // Absent and empty are different on purpose: absent leaves the picks
    // alone, empty is how a scoped screen is widened again.
    const res = await send("PATCH", `/devices/${id}`, admin.cookie, {
      fleetIds: [],
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { fleetIds: string[] }).fleetIds).toEqual([]);
    const rows = await db
      .select()
      .from(schema.deviceFleets)
      .where(eq(schema.deviceFleets.deviceId, id));
    expect(rows).toHaveLength(0);
  });
});

describe("how a screen spends itself", () => {
  test("is a slideshow unless the caller says otherwise", async () => {
    // Every wall registered before the column existed is one, so the default
    // has to be the behaviour they already have.
    const res = await send("POST", "/devices", admin.cookie, {
      id: newId(),
      name: tag,
      kind: "fleet",
    });
    expect(((await res.json()) as { layout: string }).layout).toBe("slideshow");
  });

  test("can be turned into a monitor and back", async () => {
    const id = newId();
    await send("POST", "/devices", admin.cookie, {
      id,
      name: tag,
      kind: "fleet",
      layout: "monitor",
    });
    const back = await send("PATCH", `/devices/${id}`, admin.cookie, {
      layout: "slideshow",
    });
    expect(((await back.json()) as { layout: string }).layout).toBe(
      "slideshow"
    );
  });

  test("takes more formations than fit one page", async () => {
    // A monitor is not a smaller slideshow: it shows four at a time and pages
    // through the rest, so nothing here is capped. The cap that used to live
    // in this test was a misreading of the requirement.
    const id = newId();
    const res = await send("POST", "/devices", admin.cookie, {
      id,
      name: tag,
      kind: "fleet",
      layout: "monitor",
      fleetIds: fixtureFleets,
    });
    expect(res.status).toBe(201);
    expect(
      ((await res.json()) as { fleetIds: string[] }).fleetIds
    ).toHaveLength(5);
  });

  test("switching an existing screen to monitor keeps every pick", async () => {
    // Layout and picks are independent: changing one must not silently drop
    // the other, which is what a cap here would have done.
    const id = newId();
    await send("POST", "/devices", admin.cookie, {
      id,
      name: tag,
      kind: "fleet",
      fleetIds: fixtureFleets,
    });
    const res = await send("PATCH", `/devices/${id}`, admin.cookie, {
      layout: "monitor",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { layout: string; fleetIds: string[] };
    expect(body.layout).toBe("monitor");
    expect(body.fleetIds).toHaveLength(5);
  });

  test("stores the picks in the order they were given", async () => {
    // Pick order is the quadrant a monitor draws a pit in, and the sequence a
    // slideshow rotates through. Alphabetical would overrule both.
    const picked = [fixtureFleets[2]!, fixtureFleets[0]!, fixtureFleets[1]!];
    const id = newId();
    const res = await send("POST", "/devices", admin.cookie, {
      id,
      name: tag,
      kind: "fleet",
      layout: "monitor",
      fleetIds: picked,
    });
    expect(res.status).toBe(201);
    const read = await send("GET", `/devices?kind=fleet`, admin.cookie);
    const rows = (await read.json()) as { id: string; fleetIds: string[] }[];
    expect(rows.find((r) => r.id === id)!.fleetIds).toEqual(picked);
  });
});
