/**
 * The two fixes recorded in `docs/known-issues.md`, driven through the real
 * routes.
 *
 * Both were about writes rather than reads, and neither could be caught by a
 * constraint: renaming a NIK left `users.nik` pointing at nobody, and every
 * write route reached past the caller's department while every read route did
 * not. Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/employees-scope.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { employeesRoutes } from "./employees";

const app = new Elysia().use(employeesRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji Scope ${uid()}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  employees: [] as string[],
  positions: [] as string[],
  companies: [] as string[],
  departments: [] as string[],
};

let departmentA = "";
let departmentB = "";
let companyId = "";
let positionA = "";
let positionB = "";

type Person = { id: string; nik: string; name: string };
let alice: Person; // department A
let bob: Person; //   department B
let clerk: Person; //  department A, holds the dept-scoped account

let deptAdmin: { cookie: string; id: string };
let superAdmin: { cookie: string; id: string };

/* ------------------------------------------------------------- fixtures */

async function makeRole(scope: "all" | "dept", grants: [string, "manage"][]) {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-scope-${uid()}`, name: tag, scope })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values(
      grants.map(([menuSlug, mode]) => ({ roleId: role!.id, menuSlug, mode }))
    );
  return role!.id;
}

async function makeUser(roleId: string, nik: string | null) {
  const [user] = await db
    .insert(schema.users)
    .values({
      nik,
      email: nik ? null : `zz-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  return { id: user!.id, cookie: `${SESSION_COOKIE}=${session.id}` };
}

async function makeEmployee(
  departmentId: string,
  positionId: string,
  label: string
): Promise<Person> {
  const nik = `ZZ${label}${uid()}`;
  const [row] = await db
    .insert(schema.employees)
    .values({
      nik,
      name: `${tag} ${label}`,
      companyId,
      positionId,
      departmentId,
    })
    .returning({ id: schema.employees.id });
  made.employees.push(row!.id);
  return { id: row!.id, nik, name: `${tag} ${label}` };
}

/* -------------------------------------------------------------- requests */

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

beforeAll(async () => {
  // scheduler.test.ts disconnects the shared client in its teardown, and bun
  // runs every file in one process.
  if (redis.status === "end") await redis.connect();

  const [company] = await db
    .insert(schema.companies)
    .values({ name: tag, code: `ZZ${uid()}` })
    .returning({ id: schema.companies.id });
  companyId = company!.id;
  made.companies.push(companyId);

  const [a] = await db
    .insert(schema.departments)
    .values({ name: `${tag} A`, companyId })
    .returning({ id: schema.departments.id });
  const [b] = await db
    .insert(schema.departments)
    .values({ name: `${tag} B`, companyId })
    .returning({ id: schema.departments.id });
  departmentA = a!.id;
  departmentB = b!.id;
  made.departments.push(departmentA, departmentB);

  const [pa] = await db
    .insert(schema.positions)
    .values({ name: tag, departmentId: departmentA })
    .returning({ id: schema.positions.id });
  const [pb] = await db
    .insert(schema.positions)
    .values({ name: tag, departmentId: departmentB })
    .returning({ id: schema.positions.id });
  positionA = pa!.id;
  positionB = pb!.id;
  made.positions.push(positionA, positionB);

  alice = await makeEmployee(departmentA, positionA, "Alice");
  bob = await makeEmployee(departmentB, positionB, "Bob");
  clerk = await makeEmployee(departmentA, positionA, "Clerk");

  deptAdmin = await makeUser(
    await makeRole("dept", [["employees", "manage"]]),
    clerk.nik
  );
  superAdmin = await makeUser(
    await makeRole("all", [["employees", "manage"]]),
    null
  );
});

afterAll(async () => {
  if (made.employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
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
});

/* ----------------------------------------------------------- write scope */

describe("a write cannot reach where a read cannot", () => {
  test("editing another department's employee is not found, not refused", async () => {
    const response = await send(
      "PATCH",
      `/employees/${bob.nik}`,
      deptAdmin.cookie,
      { name: "Diubah Diam-diam" }
    );
    // 404 rather than 403: an existence answer that differs for records outside
    // the caller's department is a register they can enumerate a NIK at a time.
    expect(response.status).toBe(404);

    const [row] = await db
      .select({ name: schema.employees.name })
      .from(schema.employees)
      .where(eq(schema.employees.id, bob.id));
    expect(row!.name).toBe(bob.name);
  });

  test("the edit route no longer discloses the record either", async () => {
    // The old hole: `GET /:nik` was scoped, `PATCH /:nik` was not and returned
    // the updated row — so a write was a way to read.
    const response = await send(
      "PATCH",
      `/employees/${bob.nik}`,
      deptAdmin.cookie,
      { status: "aktif" }
    );
    expect(response.status).toBe(404);
    expect(await response.json()).not.toMatchObject({ nik: bob.nik });
  });

  test("deleting another department's employee is not found", async () => {
    const response = await send(
      "DELETE",
      `/employees/${bob.nik}`,
      deptAdmin.cookie
    );
    expect(response.status).toBe(404);
    const [row] = await db
      .select({ id: schema.employees.id })
      .from(schema.employees)
      .where(eq(schema.employees.id, bob.id));
    expect(row).toBeDefined();
  });

  test("a created employee lands in the caller's department, whatever the body says", async () => {
    const nik = `ZZNew${uid()}`;
    const response = await send("POST", "/employees", deptAdmin.cookie, {
      nik,
      name: `${tag} Baru`,
      companyId,
      // Department B, and a position that belongs to it. Both are ignored:
      // the department comes from the caller's own record.
      departmentId: departmentB,
      positionId: positionA,
    });
    expect(response.status).toBe(201);

    const [row] = await db
      .select({
        id: schema.employees.id,
        departmentId: schema.employees.departmentId,
      })
      .from(schema.employees)
      .where(eq(schema.employees.nik, nik));
    made.employees.push(row!.id);
    expect(row!.departmentId).toBe(departmentA);
  });

  test("an edit cannot hand one of your own people to another department", async () => {
    const response = await send(
      "PATCH",
      `/employees/${alice.nik}`,
      deptAdmin.cookie,
      { departmentId: departmentB, positionId: positionB }
    );
    // The department is read from the record as it stands, so the position no
    // longer fits it and the pairing check refuses the row.
    expect(response.status).toBe(422);

    const [row] = await db
      .select({ departmentId: schema.employees.departmentId })
      .from(schema.employees)
      .where(eq(schema.employees.id, alice.id));
    expect(row!.departmentId).toBe(departmentA);
  });

  test("an all-scoped caller still reaches every department", async () => {
    const response = await send(
      "PATCH",
      `/employees/${bob.nik}`,
      superAdmin.cookie,
      { phone: "0800-0000-0000" }
    );
    expect(response.status).toBe(200);
  });
});

/* --------------------------------------------------------- the NIK rename */

describe("renaming a NIK carries the account holding it", () => {
  test("the account follows, instead of being left pointing at nobody", async () => {
    const renamed = `ZZMoved${uid()}`;
    const response = await send(
      "PATCH",
      `/employees/${clerk.nik}`,
      superAdmin.cookie,
      { nik: renamed }
    );
    expect(response.status).toBe(200);

    const [account] = await db
      .select({ nik: schema.users.nik })
      .from(schema.users)
      .where(eq(schema.users.id, deptAdmin.id));
    expect(account!.nik).toBe(renamed);

    // And the link still resolves, which is the thing that actually broke: a
    // scoped account whose NIK names nobody sees an empty screen everywhere.
    const [employee] = await db
      .select({ id: schema.employees.id })
      .from(schema.employees)
      .where(eq(schema.employees.nik, renamed));
    expect(employee!.id).toBe(clerk.id);

    clerk = { ...clerk, nik: renamed };
  });

  test("renaming onto a NIK another account holds is refused", async () => {
    // Give Alice's NIK to an account, then try to rename Bob onto it.
    const other = await makeUser(
      await makeRole("dept", [["employees", "manage"]]),
      alice.nik
    );
    expect(other.id).toBeDefined();

    const response = await send(
      "PATCH",
      `/employees/${bob.nik}`,
      superAdmin.cookie,
      { nik: alice.nik }
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "nik_taken" });

    // Neither record moved.
    const [row] = await db
      .select({ nik: schema.employees.nik })
      .from(schema.employees)
      .where(eq(schema.employees.id, bob.id));
    expect(row!.nik).toBe(bob.nik);
  });
});
