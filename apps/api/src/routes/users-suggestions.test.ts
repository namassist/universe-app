/**
 * The employees the Users form suggests while an admin types a NIK or an
 * email: who matches, in what order, how many, and what each carries.
 *
 *   bun --env-file=.env test src/routes/users-suggestions.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { usersRoutes } from "./users";

const app = new Elysia().use(usersRoutes);

const uid = () => crypto.randomUUID().slice(0, 6).toUpperCase();
const run = uid();
/** Every NIK made here starts with it, so a prefix search sees only ours. */
const NIK = `ZZS${run}`;
/** And every email carries this, so a substring search does too. */
const MAILTAG = `zzsug${run.toLowerCase()}`;
const tag = `ZZ Saran ${run}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  employees: [] as string[],
  positions: [] as string[],
  departments: [] as string[],
  companies: [] as string[],
};
let manager = "";
let viewer = "";

type Suggestion = {
  nik: string;
  name: string;
  email: string | null;
  hasAccount: boolean;
};

async function session(grant: "view" | "manage") {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-sug-${uid()}`, name: `${tag} ${grant}`, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values({ roleId: role!.id, menuSlug: "users", mode: grant });
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-sug-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId: role!.id,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const s = await createSession("user", user!.id, "cookie");
  return `${SESSION_COOKIE}=${s.id}`;
}

const suggest = async (q: string, cookie = manager) =>
  app.handle(
    new Request(
      `http://localhost/users/employee-suggestions?q=${encodeURIComponent(q)}`,
      { headers: { cookie } }
    )
  );

const list = async (q: string) =>
  (await (await suggest(q)).json()) as Suggestion[];

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();

  const [company] = await db
    .insert(schema.companies)
    .values({ name: tag, code: `ZZ${run}` })
    .returning({ id: schema.companies.id });
  made.companies.push(company!.id);
  const [department] = await db
    .insert(schema.departments)
    .values({ name: tag, companyId: company!.id })
    .returning({ id: schema.departments.id });
  made.departments.push(department!.id);
  const [position] = await db
    .insert(schema.positions)
    .values({ name: tag, departmentId: department!.id })
    .returning({ id: schema.positions.id });
  made.positions.push(position!.id);

  const person = (nik: string, name: string, email: string | null) => ({
    nik,
    name,
    email,
    companyId: company!.id,
    departmentId: department!.id,
    positionId: position!.id,
  });
  const rows = await db
    .insert(schema.employees)
    .values([
      person(
        `${NIK}01`,
        "Budi Santoso",
        `budi.${MAILTAG}@ungguldinamika.co.id`
      ),
      person(`${NIK}02`, "Andi Wijaya", null),
      // Found by email only: its NIK does not start with the prefix.
      person(`X${NIK}03`, "Citra Ayu", `citra.${MAILTAG}@ungguldinamika.co.id`),
      ...Array.from({ length: 10 }, (_, i) =>
        person(`${NIK}9${i}`, `Zz Banyak ${i}`, null)
      ),
    ])
    .returning({ id: schema.employees.id });
  made.employees.push(...rows.map((r) => r.id));

  manager = await session("manage");
  viewer = await session("view");

  // Budi already has an account, by NIK.
  const [budi] = await db
    .insert(schema.users)
    .values({
      nik: `${NIK}01`,
      name: "Budi Santoso",
      passwordHash: "x",
      roleId: made.roles[0]!,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(budi!.id);

  // Citra already has one too, by email, written in another case.
  const [citra] = await db
    .insert(schema.users)
    .values({
      email: `Citra.${MAILTAG}@UnggulDinamika.co.id`,
      name: "Citra Ayu",
      passwordHash: "x",
      roleId: made.roles[0]!,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(citra!.id);
});

afterAll(async () => {
  await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
  await db
    .delete(schema.employees)
    .where(inArray(schema.employees.id, made.employees));
  await db
    .delete(schema.positions)
    .where(inArray(schema.positions.id, made.positions));
  await db
    .delete(schema.departments)
    .where(inArray(schema.departments.id, made.departments));
  await db
    .delete(schema.companies)
    .where(inArray(schema.companies.id, made.companies));
});

describe("GET /users/employee-suggestions", () => {
  test("matches a NIK from its start, carrying name, email and whether an account holds it", async () => {
    const found = await list(`${NIK}0`);
    expect(found).toEqual([
      {
        nik: `${NIK}01`,
        name: "Budi Santoso",
        email: `budi.${MAILTAG}@ungguldinamika.co.id`,
        hasAccount: true,
      },
      { nik: `${NIK}02`, name: "Andi Wijaya", email: null, hasAccount: false },
    ]);
  });

  test("does not match a NIK in its middle", async () => {
    const found = await list(`${NIK}03`);
    expect(found).toEqual([]);
  });

  test("matches an email anywhere, ignoring case", async () => {
    const found = await list(`CITRA.${MAILTAG.toUpperCase()}`);
    expect(found.map((s) => s.nik)).toEqual([`X${NIK}03`]);
  });

  test("counts an account holding the employee's email as theirs", async () => {
    const [citra] = await list(`citra.${MAILTAG}`);
    expect(citra!.hasAccount).toBe(true);
  });

  test("answers at most eight", async () => {
    const found = await list(`${NIK}9`);
    expect(found).toHaveLength(8);
  });

  test("answers nothing for fewer than two characters", async () => {
    const res = await suggest("Z");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("reads % and _ as themselves, not as wildcards", async () => {
    expect(await list("%%")).toEqual([]);
    expect(await list("__")).toEqual([]);
  });

  test("is for account managers only", async () => {
    const res = await suggest(`${NIK}0`, viewer);
    expect(res.status).toBe(403);
  });
});
