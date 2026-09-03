/**
 * Unit status — the derived reading, the flag-rewriting transition, and the
 * location that resolves through fleet membership.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/unit-status.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { unitStatusRoutes } from "./unit-status";

const app = new Elysia().use(unitStatusRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji Status ${uid()}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  fleets: [] as string[],
  history: [] as string[],
  units: [] as string[],
  catalogueIds: {
    cls: "",
    typ: "",
    mdl: "",
    brd: "",
  },
};

let admin: { cookie: string };
let viewer: { cookie: string };

let digger = { id: "", code: "" };
let hauler = { id: "", code: "" };
let loner = { id: "", code: "" };
let retired = { id: "", code: "" };

/* ------------------------------------------------------------- fixtures */

async function makeUser(mode: "view" | "manage") {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-status-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values([{ roleId: role!.id, menuSlug: "unit-status", mode }]);
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
  extra: Partial<{ active: boolean }> = {}
) {
  const { cls, typ, mdl, brd } = made.catalogueIds;
  const [row] = await db
    .insert(schema.units)
    .values({
      code,
      classId: cls,
      typeId: typ,
      modelId: mdl,
      brandId: brd,
      ...extra,
    })
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

type Row = {
  id: string;
  code: string;
  status: "ready" | "standby" | "breakdown";
  location: string | null;
  updatedAt: string | null;
};

async function listRows(): Promise<Row[]> {
  const response = await send("GET", "/unit-status", admin.cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as Row[];
}

const rowOf = (rows: Row[], unit: { code: string }) =>
  rows.find((r) => r.code === unit.code);

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
  made.catalogueIds = {
    cls: cls!.id,
    typ: typ!.id,
    mdl: mdl!.id,
    brd: brd!.id,
  };

  digger = await makeUnit(`ZZSX1${uid()}`);
  hauler = await makeUnit(`ZZSD1${uid()}`);
  loner = await makeUnit(`ZZSL1${uid()}`);
  retired = await makeUnit(`ZZSR1${uid()}`, { active: false });

  const [fleet] = await db
    .insert(schema.fleets)
    .values({ diggerUnitId: digger.id, workArea: `${tag} PIT` })
    .returning({ id: schema.fleets.id });
  made.fleets.push(fleet!.id);
  await db
    .insert(schema.fleetUnits)
    .values([{ fleetId: fleet!.id, unitId: hauler.id }]);
});

afterAll(async () => {
  if (made.units.length)
    await db
      .delete(schema.unitStatusHistory)
      .where(inArray(schema.unitStatusHistory.unitId, made.units));
  if (made.fleets.length)
    await db
      .delete(schema.fleets)
      .where(inArray(schema.fleets.id, made.fleets));
  if (made.units.length)
    await db.delete(schema.units).where(inArray(schema.units.id, made.units));
  const { cls, typ, mdl, brd } = made.catalogueIds;
  await db.delete(schema.unitClasses).where(eq(schema.unitClasses.id, cls));
  await db.delete(schema.unitTypes).where(eq(schema.unitTypes.id, typ));
  await db.delete(schema.unitModels).where(eq(schema.unitModels.id, mdl));
  await db.delete(schema.unitBrands).where(eq(schema.unitBrands.id, brd));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

/* ------------------------------------------------------------- the reading */

describe("the list derives status and resolves location through the fleet", () => {
  test("a fresh unit is ready, never changed, and located by its fleet", async () => {
    const rows = await listRows();

    // Location reaches the digger and the hauler through the same fleet; a
    // unit no fleet holds has none.
    expect(rowOf(rows, digger)).toMatchObject({
      status: "ready",
      location: `${tag} PIT`,
      updatedAt: null,
    });
    expect(rowOf(rows, hauler)).toMatchObject({ location: `${tag} PIT` });
    expect(rowOf(rows, loner)).toMatchObject({
      status: "ready",
      location: null,
    });

    // An inactive unit has no operational status to report.
    expect(rowOf(rows, retired)).toBeUndefined();
  });

  test("breakdown outranks standby however the flags were left", async () => {
    // Both flags set — a state no transition writes, but one legacy data
    // could hold. The reading must still pick the worse answer.
    await db
      .update(schema.units)
      .set({ standby: true, breakdown: true })
      .where(eq(schema.units.id, loner.id));
    const rows = await listRows();
    expect(rowOf(rows, loner)?.status).toBe("breakdown");
  });
});

/* ---------------------------------------------------------- the transition */

describe("a status change rewrites both flags and leaves a trail", () => {
  test("view may read and not write", async () => {
    const response = await send(
      "POST",
      `/unit-status/${hauler.code}`,
      viewer.cookie,
      { status: "breakdown", reason: "x" }
    );
    expect(response.status).toBe(403);
  });

  test("a change requires a reason", async () => {
    const response = await send(
      "POST",
      `/unit-status/${hauler.code}`,
      admin.cookie,
      { status: "breakdown", reason: "   " }
    );
    expect(response.status).toBe(422);
  });

  test("an unknown code is not found", async () => {
    const response = await send(
      "POST",
      `/unit-status/ZZ-NOPE-${uid()}`,
      admin.cookie,
      { status: "ready", reason: "x" }
    );
    expect(response.status).toBe(404);
  });

  test("transitions cannot compound — each writes both flags", async () => {
    const change = (status: string, reason: string) =>
      send("POST", `/unit-status/${loner.code}`, admin.cookie, {
        status,
        reason,
      });

    // The unit enters with both flags set (previous test). breakdown →
    // standby → ready must end with both clear, not with leftovers.
    expect((await change("standby", "menunggu operator")).status).toBe(200);
    let [flags] = await db
      .select({
        standby: schema.units.standby,
        breakdown: schema.units.breakdown,
      })
      .from(schema.units)
      .where(eq(schema.units.id, loner.id));
    expect(flags).toEqual({ standby: true, breakdown: false });

    expect((await change("ready", "operator ditemukan")).status).toBe(200);
    [flags] = await db
      .select({
        standby: schema.units.standby,
        breakdown: schema.units.breakdown,
      })
      .from(schema.units)
      .where(eq(schema.units.id, loner.id));
    expect(flags).toEqual({ standby: false, breakdown: false });

    const rows = await listRows();
    expect(rowOf(rows, loner)?.status).toBe("ready");
    expect(rowOf(rows, loner)?.updatedAt).not.toBeNull();
  });

  test("the history answers newest first, with the reasons", async () => {
    const response = await send(
      "GET",
      `/unit-status/${loner.code}/history`,
      viewer.cookie
    );
    expect(response.status).toBe(200);
    const rows = (await response.json()) as {
      status: string;
      reason: string;
      createdAt: string;
    }[];
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({
      status: "ready",
      reason: "operator ditemukan",
    });
    expect(rows[1]).toMatchObject({
      status: "standby",
      reason: "menunggu operator",
    });
    expect(rows[0]!.createdAt >= rows[1]!.createdAt).toBe(true);
  });

  test("a unit with no history has none, not an error", async () => {
    const response = await send(
      "GET",
      `/unit-status/${digger.code}/history`,
      admin.cookie
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});
