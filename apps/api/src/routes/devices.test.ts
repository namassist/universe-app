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
};
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
});

afterAll(async () => {
  if (made.devices.length)
    await db
      .delete(schema.devices)
      .where(inArray(schema.devices.id, made.devices));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
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
