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
import { LOGIN_MAX_FAILURES, throttleKey } from "../auth/login-throttle";
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
/** Employed, never logged in: what a first login from outside would take. */
const UNCLAIMED_NIK = N(4);
/** Activated: has set a password of their own. */
const ACTIVATED_NIK = N(5);
/** Holds the issued password still, e.g. after an administrator's reset. */
const RESET_NIK = N(6);
const STRANGER_NIK = N(9);
const OWN_PASSWORD = "password-sendiri-123";

let companyId: string, departmentId: string, positionId: string;
const employeeIds: string[] = [];

/** On the LAN unless a test says otherwise. Each test that counts attempts
 *  takes its own addresses, so one test's budget never spends another's. */
const SITE_IP = "192.168.10.10";
let octet = 1;
const outside = () => `203.0.113.${octet++}`;

/** As Caddy delivers it: the client's address as the last forwarded entry. */
const login = (identifier: string, password: string, from = SITE_IP) =>
  app.handle(
    new Request("http://localhost/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": from,
      },
      body: JSON.stringify({ identifier, password, transport: "bearer" }),
    })
  );

const previousProxy = process.env.TRUST_PROXY;
async function clearThrottle() {
  const keys = await redis.keys(throttleKey("*"));
  if (keys.length) await redis.del(...keys);
}

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
  process.env.TRUST_PROXY = "true";
  await clearThrottle();

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
    [UNCLAIMED_NIK, "aktif"],
    [ACTIVATED_NIK, "aktif"],
    [RESET_NIK, "aktif"],
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
  await db.insert(schema.users).values([
    {
      nik: ACTIVATED_NIK,
      name: `${tag} activated`,
      passwordHash: await hashPassword(OWN_PASSWORD),
      mustChangePassword: false,
      roleId: role!.id,
      active: true,
    },
    {
      nik: RESET_NIK,
      name: `${tag} reset`,
      passwordHash: await hashPassword(env.DEFAULT_USER_PASSWORD),
      mustChangePassword: true,
      roleId: role!.id,
      active: true,
    },
  ]);
});

afterAll(async () => {
  if (previousProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = previousProxy;
  await clearThrottle();
  await db
    .delete(schema.users)
    .where(
      inArray(schema.users.nik, [
        EMPLOYED_NIK,
        DEPARTED_NIK,
        DISABLED_NIK,
        UNCLAIMED_NIK,
        ACTIVATED_NIK,
        RESET_NIK,
      ])
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

describe("a first login happens on site", () => {
  test("from outside, the issued password provisions nothing", async () => {
    const res = await login(
      UNCLAIMED_NIK,
      env.DEFAULT_USER_PASSWORD,
      outside()
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe(
      "first_login_on_site"
    );
    expect(await accountFor(UNCLAIMED_NIK)).toBeNull();
  });

  test("from outside, an account still on the issued password is refused", async () => {
    const res = await login(RESET_NIK, env.DEFAULT_USER_PASSWORD, outside());
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe(
      "first_login_on_site"
    );
  });

  test("from outside, a wrong password still reads as a wrong password", async () => {
    // The refusal is only reached with the right password: anything else
    // must not learn that the account is waiting for its first login.
    const res = await login(RESET_NIK, "bukan-password-yang-benar", outside());
    expect(res.status).toBe(401);
  });

  test("from site, the same account logs in", async () => {
    const res = await login(RESET_NIK, env.DEFAULT_USER_PASSWORD, "10.1.2.3");
    expect(res.status).toBe(200);
  });

  test("from outside, an activated account logs in", async () => {
    const res = await login(ACTIVATED_NIK, OWN_PASSWORD, outside());
    expect(res.status).toBe(200);
  });

  test("with no address to judge, the login is treated as outside", async () => {
    delete process.env.TRUST_PROXY;
    try {
      // `app.handle` has no socket, so nothing names the caller.
      const res = await login(RESET_NIK, env.DEFAULT_USER_PASSWORD);
      expect(res.status).toBe(403);
    } finally {
      process.env.TRUST_PROXY = "true";
    }
  });
});

describe("guesses are bounded", () => {
  test(`one address is refused after ${LOGIN_MAX_FAILURES} attempts, right password included`, async () => {
    const ip = outside();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++)
      expect((await login(STRANGER_NIK, `salah-${i}`, ip)).status).toBe(401);

    const res = await login(ACTIVATED_NIK, OWN_PASSWORD, ip);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe(
      "too_many_attempts"
    );
    const retryAfter = Number(res.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
  });

  test("one account guessed from many outside addresses is refused from outside, not from site", async () => {
    // The test before spent one of this account's attempts; a login that
    // succeeds is what starts its budget again.
    expect((await login(ACTIVATED_NIK, OWN_PASSWORD, "10.9.9.8")).status).toBe(
      200
    );
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++)
      expect((await login(ACTIVATED_NIK, `salah-${i}`, outside())).status).toBe(
        401
      );

    expect((await login(ACTIVATED_NIK, OWN_PASSWORD, outside())).status).toBe(
      429
    );
    expect((await login(ACTIVATED_NIK, OWN_PASSWORD, "10.9.9.9")).status).toBe(
      200
    );
  });
});
