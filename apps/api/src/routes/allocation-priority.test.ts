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
import { eq, inArray, like } from "drizzle-orm";

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

async function addUnit(
  code: string,
  description: string,
  simperCodeId: string | null = null
) {
  const [row] = await db
    .insert(schema.units)
    .values({
      code,
      classId: cls,
      typeId: typ,
      modelId: mdl,
      brandId: brd,
      description,
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
    description: string;
    typeName: string;
    units: number;
    simperCodeNames: string[];
    brandNames: string[];
    unitCodes: string[];
    rank: number | null;
  }[];
  return body.filter((r) => r.description.startsWith(tag));
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
    .where(like(schema.allocationPriorities.description, `${tag}%`));
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
  test("a description appears once, however many units share it, and starts unranked", async () => {
    await addUnit(`${tag}-1`, `${tag} BESAR`, codeA);
    await addUnit(`${tag}-2`, `${tag} BESAR`, codeB);
    await addUnit(`${tag}-3`, `${tag} KECIL`, codeA);

    const rows = await mine(admin);
    expect(rows).toHaveLength(2);
    const big = rows.find((r) => r.description === `${tag} BESAR`)!;

    /* The count is what lets somebody weigh a rank instead of guessing at it,
       so it is asserted rather than assumed. */
    expect(big.units).toBe(2);
    /* And the machines themselves, in the register's own order — a rank is set
       against real units, not against a word. */
    expect(big.unitCodes).toEqual([`${tag}-1`, `${tag}-2`]);
    /* Both licences under one description, which is the whole change: they no
       longer split the row, they are listed on it. */
    expect(big.simperCodeNames.sort()).toEqual([`${tag} A`, `${tag} B`]);
    /* The make is shown, not ranked — one entry, not one per unit. */
    expect(big.brandNames).toEqual([`${tag} Merk`]);
    for (const row of rows) expect(row.rank).toBeNull();
  });

  test("a unit with no description is a line of its own, not a missing row", async () => {
    /* `description` is `notNull` with an empty default, so a machine nobody
       described still has to be crewed and still has to be rankable. */
    await addUnit(`${tag}-4`, "", codeA);

    const body = (await (await get(admin)).json()) as { description: string }[];
    expect(body.some((r) => r.description === "")).toBe(true);
  });
});

describe("saving an order", () => {
  test("numbers the descriptions in the order given, ranked before unranked", async () => {
    const response = await put(admin, [
      { description: `${tag} KECIL` },
      { description: `${tag} BESAR` },
    ]);
    expect(response.status).toBe(200);

    const after = await mine(admin);
    expect(after[0]).toMatchObject({ description: `${tag} KECIL`, rank: 1 });
    expect(after[1]).toMatchObject({ description: `${tag} BESAR`, rank: 2 });
  });

  test("the same description twice is refused rather than half-applied", async () => {
    const entry = { description: `${tag} BESAR` };
    const response = await put(admin, [entry, entry]);
    expect(response.status).toBe(422);
  });

  test("view may read the order but not set it", async () => {
    expect((await get(viewer)).status).toBe(200);
    expect((await put(viewer, [])).status).toBe(403);
  });
});

describe("the ranks follow the units, not the other way round", () => {
  test("retiring the last unit of a description drops its line", async () => {
    const gone = await addUnit(`${tag}-9`, `${tag} SEKALI`, codeA);
    expect(
      (await mine(admin)).some((r) => r.description === `${tag} SEKALI`)
    ).toBe(true);

    await db.delete(schema.units).where(eq(schema.units.id, gone));
    made.units = made.units.filter((id) => id !== gone);

    /* No cleanup of the ranks anywhere: the screen is read from the units, so
       removing the last unit is what removes the line. */
    expect(
      (await mine(admin)).some((r) => r.description === `${tag} SEKALI`)
    ).toBe(false);
  });
});
