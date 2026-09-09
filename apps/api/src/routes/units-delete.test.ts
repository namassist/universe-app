/**
 * Why a unit cannot be deleted — and whether the refusal says the true reason.
 *
 * It did not. Seven tables reference a unit, and every refusal reported "still
 * has a bus schedule", because that was the only referrer when the message was
 * written and nothing failed when it stopped being so. A water truck held by
 * two PLAN pairings sent its owner to the Bus menu to look for something that
 * had never been there.
 *
 * So these pin the *mapping*, not one message: two units held by two different
 * tables must be refused with two different reasons. One message for both is
 * exactly the bug, and it is the shape a hardcoded string always has.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/units-delete.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { unitsRoutes } from "./units";

const app = new Elysia().use(unitsRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ UnitDel ${uid()}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  units: [] as string[],
  catalogues: [] as {
    table: "classes" | "types" | "models" | "brands";
    id: string;
  }[],
};

let admin = "";
let cls = "";
let typ = "";
let mdl = "";
let brd = "";

async function addUnit(code: string) {
  const [row] = await db
    .insert(schema.units)
    .values({ code, classId: cls, typeId: typ, modelId: mdl, brandId: brd })
    .returning({ id: schema.units.id });
  made.units.push(row!.id);
  return row!.id;
}

const del = (code: string) =>
  app.handle(
    new Request(`http://localhost/units/${code}`, {
      method: "DELETE",
      headers: { cookie: admin },
    })
  );

const reason = async (code: string) => {
  const response = await del(code);
  expect(response.status).toBe(409);
  return ((await response.json()) as { message: string }).message;
};

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();

  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-unitdel-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values({ roleId: role!.id, menuSlug: "database-unit", mode: "manage" });
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-unitdel-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId: role!.id,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  admin = `${SESSION_COOKIE}=${session.id}`;

  for (const [table, key] of [
    [schema.unitClasses, "classes"],
    [schema.unitTypes, "types"],
    [schema.unitModels, "models"],
    [schema.unitBrands, "brands"],
  ] as const) {
    const [row] = await db
      .insert(table)
      .values({ name: `${tag} ${key}` })
      .returning({ id: table.id });
    made.catalogues.push({ table: key, id: row!.id });
  }
  [cls, typ, mdl, brd] = made.catalogues.map((c) => c.id) as [
    string,
    string,
    string,
    string,
  ];
});

afterAll(async () => {
  if (made.units.length) {
    await db
      .delete(schema.busSchedules)
      .where(inArray(schema.busSchedules.unitId, made.units));
    await db
      .delete(schema.unitStatusHistory)
      .where(inArray(schema.unitStatusHistory.unitId, made.units));
    await db.delete(schema.units).where(inArray(schema.units.id, made.units));
  }
  for (const entry of made.catalogues) {
    const table = {
      classes: schema.unitClasses,
      types: schema.unitTypes,
      models: schema.unitModels,
      brands: schema.unitBrands,
    }[entry.table];
    await db.delete(table).where(eq(table.id, entry.id));
  }
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

describe("a refused delete names what is holding the unit", () => {
  test("a bus schedule is reported as a bus schedule", async () => {
    const code = `${tag}-BUS`.toUpperCase();
    const id = await addUnit(code);
    await db
      .insert(schema.busSchedules)
      .values({ unitId: id, departAt: "05:30:00" });

    expect(await reason(code)).toContain("jadwal bus");
  });

  test("status history is reported as status history, not as a bus schedule", async () => {
    /* The case that gives the regression its teeth. Nothing about this unit
       involves a bus, and history cannot be cleared at all — so the message
       has to say "deactivate" rather than send somebody hunting. */
    const code = `${tag}-HIST`.toUpperCase();
    const id = await addUnit(code);
    await db
      .insert(schema.unitStatusHistory)
      .values({ unitId: id, status: "breakdown", reason: `${tag} uji` });

    const message = await reason(code);
    expect(message).toContain("riwayat");
    expect(message).not.toContain("jadwal bus");
    expect(message).toContain("nonaktifkan");
  });

  test("a unit nothing references is deleted", async () => {
    /* The other half of the guard: if everything refused, the two above would
       pass while the screen had stopped working entirely. */
    const code = `${tag}-FREE`.toUpperCase();
    const id = await addUnit(code);

    const response = await del(code);
    expect(response.status).toBe(200);

    const left = await db
      .select({ id: schema.units.id })
      .from(schema.units)
      .where(eq(schema.units.id, id));
    expect(left).toEqual([]);
    made.units = made.units.filter((u) => u !== id);
  });
});
