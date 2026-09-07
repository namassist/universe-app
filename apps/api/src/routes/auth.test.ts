/**
 * Login provisions the account the employee register says should exist.
 *
 * The cases worth pinning are the ones where a mistake is invisible from the
 * screen: a NIK nobody employs must not become an account, a departed employee
 * must not get one back, and an account an administrator switched off must not
 * be re-created by the person walking up to the login form. Each of those looks
 * exactly like a successful login until you check the users table.
 *
 *   bun --env-file=.env test src/routes/auth.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { hashPassword } from "../auth/password";
import { db, schema } from "../db";
import { env } from "../env";
import { redis } from "../redis";
import { authRoutes } from "./auth";

const app = new Elysia().use(authRoutes);
const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Auth ${uid()}`;

/** NIKs in a range no real register uses, so the fixture cannot collide. */
const N = (n: number) => `9906000${n}`;
const EMPLOYED_NIK = N(1);
const DEPARTED_NIK = N(2);
const DISABLED_NIK = N(3);
const STRANGER_NIK = N(9);

let companyId: string, departmentId: string, positionId: string;
const employeeIds: string[] = [];

const login = (identifier: string, password: string) =>
  app.handle(
    new Request("http://localhost/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier, password, transport: "bearer" }),
    })
  );

const accountFor = async (nik: string) => {
  const [row] = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      active: schema.users.active,
      mustChangePassword: schema.users.mustChangePassword,
      roleSlug: schema.roles.slug,
    })
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .where(eq(schema.users.nik, nik))
    .limit(1);
  return row ?? null;
};

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();

  const [company] = await db
    .insert(schema.companies)
    .values({ name: `${tag} PT`, code: `ZA${uid().slice(0, 4)}` })
    .returning({ id: schema.companies.id });
  companyId = company!.id;

  const [department] = await db
    .insert(schema.departments)
    .values({ name: `${tag} Dept`, companyId })
    .returning({ id: schema.departments.id });
  departmentId = department!.id;

  const [position] = await db
    .insert(schema.positions)
    .values({ name: `${tag} Operator`, departmentId, fleetAllocation: true })
    .returning({ id: schema.positions.id });
  positionId = position!.id;

  for (const [nik, status] of [
    [EMPLOYED_NIK, "aktif"],
    [DEPARTED_NIK, "nonaktif"],
    [DISABLED_NIK, "aktif"],
  ] as const) {
    const [row] = await db
      .insert(schema.employees)
      .values({
        nik,
        name: `${tag} ${nik}`,
        companyId,
        departmentId,
        positionId,
        status,
      })
      .returning({ id: schema.employees.id });
    employeeIds.push(row!.id);
  }

  // An account an administrator switched off, on an employee still on the
  // register — the case a naive "no account? make one" would silently undo.
  const [role] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.slug, "user"))
    .limit(1);
  await db.insert(schema.users).values({
    nik: DISABLED_NIK,
    name: `${tag} disabled`,
    passwordHash: await hashPassword(env.DEFAULT_USER_PASSWORD),
    roleId: role!.id,
    active: false,
  });
});

afterAll(async () => {
  await db
    .delete(schema.users)
    .where(
      inArray(schema.users.nik, [EMPLOYED_NIK, DEPARTED_NIK, DISABLED_NIK])
    );
  if (employeeIds.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, employeeIds));
  await db.delete(schema.positions).where(eq(schema.positions.id, positionId));
  await db
    .delete(schema.departments)
    .where(eq(schema.departments.id, departmentId));
  await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
});

describe("first login provisions an account", () => {
  test("an employed NIK with the issued password gets one", async () => {
    expect(await accountFor(EMPLOYED_NIK)).toBeNull();

    const res = await login(EMPLOYED_NIK, env.DEFAULT_USER_PASSWORD);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      principal: { nik: string; name: string; mustChangePassword: boolean };
    };
    expect(body.principal.nik).toBe(EMPLOYED_NIK);
    // The name comes from the register, not from anything the caller typed.
    expect(body.principal.name).toBe(`${tag} ${EMPLOYED_NIK}`);
    // Everyone is issued the same password, so the change gate must be armed.
    expect(body.principal.mustChangePassword).toBe(true);

    const account = await accountFor(EMPLOYED_NIK);
    expect(account?.roleSlug).toBe("user");
    expect(account?.active).toBe(true);
  });

  test("logging in again reuses the account rather than making a second", async () => {
    const first = await accountFor(EMPLOYED_NIK);
    const res = await login(EMPLOYED_NIK, env.DEFAULT_USER_PASSWORD);
    expect(res.status).toBe(200);
    expect((await accountFor(EMPLOYED_NIK))?.id).toBe(first!.id);
  });

  test("a wrong password provisions nothing", async () => {
    const res = await login(STRANGER_NIK, "bukan-password-yang-benar");
    expect(res.status).toBe(401);
    expect(await accountFor(STRANGER_NIK)).toBeNull();
  });

  test("a NIK nobody employs provisions nothing", async () => {
    const res = await login(STRANGER_NIK, env.DEFAULT_USER_PASSWORD);
    expect(res.status).toBe(401);
    expect(await accountFor(STRANGER_NIK)).toBeNull();
  });

  test("an employee who left provisions nothing", async () => {
    const res = await login(DEPARTED_NIK, env.DEFAULT_USER_PASSWORD);
    expect(res.status).toBe(401);
    expect(await accountFor(DEPARTED_NIK)).toBeNull();
  });

  test("a deactivated account is not handed back by provisioning", async () => {
    const res = await login(DISABLED_NIK, env.DEFAULT_USER_PASSWORD);
    expect(res.status).toBe(401);
    expect((await accountFor(DISABLED_NIK))?.active).toBe(false);
  });
});
