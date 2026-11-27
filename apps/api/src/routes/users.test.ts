/**
 * Accounts: what an administrator may not do to their own (docs/prd.md,
 * Mobile app → Superadmin, "Akun"). Resetting your own password, switching
 * your own account off or deleting it would lock you out mid-shift, so the
 * API refuses all three for the caller's own id, whatever the client.
 *
 *   bun --env-file=.env test src/routes/users.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { usersRoutes } from "./users";

const app = new Elysia().use(usersRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji Users ${uid()}`;

const made = { role: "", users: [] as string[] };
let admin = "";
let other = "";
let cookie = "";

async function account(name: string) {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-users-${uid()}@uji.local`,
      name,
      passwordHash: "untouched",
      roleId: made.role,
      /* An account starts on the issued password, which is gated. */
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  return user!.id;
}

const send = (method: string, path: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost/users${path}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

const stored = async (id: string) =>
  (
    await db
      .select({
        active: schema.users.active,
        passwordHash: schema.users.passwordHash,
        mustChangePassword: schema.users.mustChangePassword,
      })
      .from(schema.users)
      .where(eq(schema.users.id, id))
      .limit(1)
  )[0];

beforeAll(async () => {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-users-${uid()}`, name: `${tag} Role`, scope: "all" })
    .returning({ id: schema.roles.id });
  made.role = role!.id;
  await db
    .insert(schema.rolePermissions)
    .values({ roleId: made.role, menuSlug: "users", mode: "manage" });
  admin = await account(`${tag} admin`);
  other = await account(`${tag} other`);
  cookie = `${SESSION_COOKIE}=${(await createSession("user", admin, "cookie")).id}`;
});

afterAll(async () => {
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.role)
    await db.delete(schema.roles).where(eq(schema.roles.id, made.role));
});

const codeOf = async (res: Response) =>
  ((await res.json()) as { code: string }).code;

describe("my own account", () => {
  test("cannot be reset to the issued password", async () => {
    const res = await send("POST", `/${admin}/reset-password`);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("own_account");
    expect(await stored(admin)).toMatchObject({
      passwordHash: "untouched",
      mustChangePassword: false,
    });
  });

  test("cannot be switched off, and can still be renamed", async () => {
    const off = await send("PATCH", `/${admin}`, { active: false });
    expect(off.status).toBe(409);
    expect(await codeOf(off)).toBe("own_account");
    expect((await stored(admin))!.active).toBe(true);

    const renamed = await send("PATCH", `/${admin}`, {
      name: `${tag} renamed`,
    });
    expect(renamed.status).toBe(200);
  });

  test("cannot be deleted", async () => {
    const res = await send("DELETE", `/${admin}`);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("own_account");
    expect(await stored(admin)).toBeDefined();
  });
});

test("my own id in capitals is still my own", async () => {
  /* Postgres matches a uuid whatever its case, so the guard must too. */
  const upper = admin.toUpperCase();
  for (const [method, path, body] of [
    ["POST", `/${upper}/reset-password`, undefined],
    ["PATCH", `/${upper}`, { active: false }],
    ["DELETE", `/${upper}`, undefined],
  ] as const) {
    const res = await send(method, path, body);
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("own_account");
  }
  expect(await stored(admin)).toMatchObject({
    active: true,
    passwordHash: "untouched",
  });
});

describe("somebody else's account", () => {
  test("is reset, switched off and deleted as before", async () => {
    expect((await send("POST", `/${other}/reset-password`)).status).toBe(200);
    expect((await stored(other))!.mustChangePassword).toBe(true);
    expect((await send("PATCH", `/${other}`, { active: false })).status).toBe(
      200
    );
    expect((await send("DELETE", `/${other}`)).status).toBe(200);
    expect(await stored(other)).toBeUndefined();
  });
});

describe("the list", () => {
  test("puts every active account first and the switched-off ones last, oldest first within each", async () => {
    const offOld = await account(`${tag} off lama`);
    const onA = await account(`${tag} on a`);
    const offNew = await account(`${tag} off baru`);
    const onB = await account(`${tag} on b`);
    await db
      .update(schema.users)
      .set({ active: false })
      .where(inArray(schema.users.id, [offOld, offNew]));

    const list = (await (await send("GET", "")).json()) as {
      id: string;
      active: boolean;
    }[];

    // Once the first switched-off account appears, no active one follows.
    const firstOff = list.findIndex((u) => !u.active);
    expect(list.slice(firstOff).some((u) => u.active)).toBe(false);

    const ours = list
      .map((u) => u.id)
      .filter((id) => [offOld, onA, offNew, onB].includes(id));
    expect(ours).toEqual([onA, onB, offOld, offNew]);
  });
});
