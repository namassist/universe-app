/**
 * The order vacancies are filled in — the screen's own rules.
 *
 * What matters here is that the list is generated from the units and only
 * *numbered* by the stored ranks. A pair that appears because somebody
 * imported a model has to turn up unranked rather than invisibly, and a pair
 * whose last unit is retired has to stop being offered without anything
 * cleaning up after it.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/allocation-priority.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { allocationPriorityRoutes } from "./allocation-priority";

const app = new Elysia().use(allocationPriorityRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Prio ${uid()}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  units: [] as string[],
  simperCodes: [] as string[],
  catalogues: [] as {
    table: "classes" | "types" | "models" | "brands";
    id: string;
  }[],
};

let admin = "";
let viewer = "";
let cls = "";
let typ = "";
let mdl = "";
let brd = "";
let codeA = "";
let codeB = "";

async function makeUser(mode: "view" | "manage") {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-prio-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values({ roleId: role!.id, menuSlug: "allocation-priority", mode });
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-prio-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId: role!.id,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  return `${SESSION_COOKIE}=${session.id}`;
}

async function addUnit(code: string, simperCodeId: string | null) {
  const [row] = await db
    .insert(schema.units)
    .values({
      code,
      classId: cls,
      typeId: typ,
      modelId: mdl,
      brandId: brd,
      simperCodeId,
    })
    .returning({ id: schema.units.id });
  made.units.push(row!.id);
  return row!.id;
}

const get = (cookie: string) =>
  app.handle(
    new Request("http://localhost/allocation-priority", { headers: { cookie } })
  );

const put = (cookie: string, order: unknown) =>
  app.handle(
    new Request("http://localhost/allocation-priority", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ order }),
    })
  );

/** Only the rows this suite made — the register holds plenty of others. */
const mine = async (cookie: string) => {
  const body = (await (await get(cookie)).json()) as {
    classId: string;
    simperCodeId: string | null;
    simperCodeName: string | null;
    units: number;
    brandNames: string[];
    unitCodes: string[];
    rank: number | null;
  }[];
  return body.filter((r) => r.classId === cls);
};

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();

  const [c] = await db
    .insert(schema.unitClasses)
    .values({ name: `${tag} Kelas` })
    .returning({ id: schema.unitClasses.id });
  cls = c!.id;
  made.catalogues.push({ table: "classes", id: cls });

  const [ty] = await db
    .insert(schema.unitTypes)
    .values({ name: `${tag} Jenis` })
    .returning({ id: schema.unitTypes.id });
  typ = ty!.id;
  made.catalogues.push({ table: "types", id: typ });

  const [m] = await db
    .insert(schema.unitModels)
    .values({ name: `${tag} Model` })
    .returning({ id: schema.unitModels.id });
  mdl = m!.id;
  made.catalogues.push({ table: "models", id: mdl });

  const [b] = await db
    .insert(schema.unitBrands)
    .values({ name: `${tag} Merk` })
    .returning({ id: schema.unitBrands.id });
  brd = b!.id;
  made.catalogues.push({ table: "brands", id: brd });

  for (const name of ["A", "B"]) {
    const [code] = await db
      .insert(schema.simperCodes)
      .values({ name: `${tag} ${name}` })
      .returning({ id: schema.simperCodes.id });
    made.simperCodes.push(code!.id);
  }
  [codeA, codeB] = made.simperCodes as [string, string];

  admin = await makeUser("manage");
  viewer = await makeUser("view");
});

afterAll(async () => {
  await db
    .delete(schema.allocationPriorities)
    .where(eq(schema.allocationPriorities.classId, cls));
  if (made.units.length)
    await db.delete(schema.units).where(inArray(schema.units.id, made.units));
  if (made.simperCodes.length)
    await db
      .delete(schema.simperCodes)
      .where(inArray(schema.simperCodes.id, made.simperCodes));
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

describe("the list is generated from the units", () => {
  test("a pair appears once, however many units share it, and starts unranked", async () => {
    await addUnit(`${tag}-1`, codeA);
    await addUnit(`${tag}-2`, codeA);
    await addUnit(`${tag}-3`, codeB);

    const rows = await mine(admin);
    expect(rows).toHaveLength(2);
    /* The count is what lets somebody weigh a rank instead of guessing at it,
       so it is asserted rather than assumed. */
    expect(rows.find((r) => r.simperCodeId === codeA)?.units).toBe(2);
    expect(rows.find((r) => r.simperCodeId === codeB)?.units).toBe(1);
    /* And the machines themselves, in the register's own order — a rank is
       set against real units, not against a category. */
    expect(rows.find((r) => r.simperCodeId === codeA)?.unitCodes).toEqual([
      `${tag}-1`,
      `${tag}-2`,
    ]);
    /* The make is shown, not ranked — one entry here because the fixture's
       units share a brand, and duplicates must not pile up per unit. */
    expect(rows.find((r) => r.simperCodeId === codeA)?.brandNames).toEqual([
      `${tag} Merk`,
    ]);
    for (const row of rows) expect(row.rank).toBeNull();
  });

  test("a unit with no SIMPER code is a pair of its own, not a missing row", async () => {
    /* 18 active units on this site carry no code. They are still machines
       somebody has to crew, so they get a line rather than vanishing. */
    await addUnit(`${tag}-4`, null);

    const rows = await mine(admin);
    const bare = rows.find((r) => r.simperCodeId === null);
    expect(bare).toBeDefined();
    expect(bare!.simperCodeName).toBeNull();
  });
});

describe("saving an order", () => {
  test("numbers the pairs in the order given, ranked before unranked", async () => {
    const before = await mine(admin);
    const response = await put(
      admin,
      before
        .filter((r) => r.simperCodeId !== null)
        .map((r) => ({ classId: r.classId, simperCodeId: r.simperCodeId }))
        .reverse()
    );
    expect(response.status).toBe(200);

    const after = await mine(admin);
    /* Ranked pairs first, in their given order; whatever was left out sorts
       last and still says it is unranked. */
    expect(after[0]!.rank).toBe(1);
    expect(after[1]!.rank).toBe(2);
    expect(after.at(-1)!.rank).toBeNull();
    expect(after.at(-1)!.simperCodeId).toBeNull();
  });

  test("the same pair twice is refused rather than half-applied", async () => {
    const pair = { classId: cls, simperCodeId: codeA };
    const response = await put(admin, [pair, pair]);
    expect(response.status).toBe(422);
  });

  test("view may read the order but not set it", async () => {
    expect((await get(viewer)).status).toBe(200);
    expect((await put(viewer, [])).status).toBe(403);
  });
});

describe("the ranks follow the units, not the other way round", () => {
  test("retiring the last unit of a pair drops its line", async () => {
    const gone = await addUnit(`${tag}-9`, codeB);
    await db.delete(schema.units).where(eq(schema.units.id, gone));
    made.units = made.units.filter((id) => id !== gone);

    /* `-3` still carries codeB, so the pair survives this deletion — the
       point is that the *list* is read from units, so removing every unit of
       a pair is what removes it. */
    const rows = await mine(admin);
    expect(rows.some((r) => r.simperCodeId === codeB)).toBe(true);

    const [last] = await db
      .select({ id: schema.units.id })
      .from(schema.units)
      .where(eq(schema.units.simperCodeId, codeB));
    await db.delete(schema.units).where(eq(schema.units.id, last!.id));
    made.units = made.units.filter((id) => id !== last!.id);

    expect((await mine(admin)).some((r) => r.simperCodeId === codeB)).toBe(
      false
    );
  });
});
