/**
 * Accounts holding several roles, as the Users and Roles screens manage them.
 *
 * `roleId` is an account's default role and `roleIds` the whole set it holds.
 * What is pinned: the default is always part of the set, a set naming a role
 * that needs a NIK needs one, a role held as an extra counts as held — for the
 * user count, for deletion, for narrowing its scope — and taking a role away
 * takes effect on the next request of a session acting as it.
 *
 *   bun --env-file=.env test src/routes/users-roles.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";
import ExcelJS from "exceljs";

import { requireAuth } from "../auth/macro";
import { invalidateUser } from "../auth/principal";
import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { rolesRoutes } from "./roles";
import { usersRoutes } from "./users";

const probe = new Elysia()
  .use(requireAuth)
  .get("/probe", () => "ok", { auth: { menu: "dashboard", mode: "view" } });

const app = new Elysia().use(usersRoutes).use(rolesRoutes).use(probe);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Multi ${uid()}`;

const made = { roles: [] as string[], users: [] as string[] };
let adminRole = "";
let roleA = "";
let roleB = "";
let deptRole = "";
let cookie = "";

type UserBody = {
  id: string;
  roleId: string;
  roles: { id: string; name: string; scope: string }[];
};

async function role(name: string, scope: "all" | "dept") {
  const [row] = await db
    .insert(schema.roles)
    .values({ slug: `zz-multi-${uid()}`, name: `${tag} ${name}`, scope })
    .returning({ id: schema.roles.id });
  made.roles.push(row!.id);
  return row!.id;
}

const send = (method: string, path: string, body?: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        cookie,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );

const codeOf = async (res: Response) =>
  ((await res.json()) as { code: string }).code;

const mail = () => `zz-multi-${uid()}@uji.local`;

async function create(body: Record<string, unknown>) {
  const res = await send("POST", "/users", {
    email: mail(),
    name: `${tag} akun`,
    ...body,
  });
  if (res.status === 201) {
    const user = (await res.clone().json()) as UserBody;
    made.users.push(user.id);
  }
  return res;
}

const extrasOf = async (userId: string) =>
  (
    await db
      .select({ roleId: schema.userRoles.roleId })
      .from(schema.userRoles)
      .where(eq(schema.userRoles.userId, userId))
  ).map((r) => r.roleId);

const ids = (user: UserBody) => user.roles.map((r) => r.id);

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
  adminRole = await role("Admin", "all");
  await db.insert(schema.rolePermissions).values([
    { roleId: adminRole, menuSlug: "users", mode: "manage" },
    { roleId: adminRole, menuSlug: "roles", mode: "manage" },
  ]);
  roleA = await role("A", "all");
  roleB = await role("B", "all");
  deptRole = await role("Dept", "dept");
  await db.insert(schema.rolePermissions).values([
    { roleId: roleA, menuSlug: "dashboard", mode: "view" },
    { roleId: roleB, menuSlug: "dashboard", mode: "view" },
  ]);

  const [admin] = await db
    .insert(schema.users)
    .values({
      email: mail(),
      name: `${tag} admin`,
      passwordHash: "untouched",
      mustChangePassword: false,
      roleId: adminRole,
    })
    .returning({ id: schema.users.id });
  made.users.push(admin!.id);
  cookie = `${SESSION_COOKIE}=${(await createSession("user", admin!.id, "cookie")).id}`;
});

afterAll(async () => {
  await Promise.all(made.users.map(invalidateUser));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

describe("creating an account", () => {
  test("holds every role it is given, the default first", async () => {
    const res = await create({ roleId: roleA, roleIds: [roleB, roleA] });
    expect(res.status).toBe(201);
    const user = (await res.json()) as UserBody;
    expect(user.roleId).toBe(roleA);
    expect(ids(user)).toEqual([roleA, roleB]);
    // The default is `users.role_id`; only the extra is stored as a row.
    expect(await extrasOf(user.id)).toEqual([roleB]);
  });

  test("with one role, as before", async () => {
    const res = await create({ roleId: roleA });
    expect(res.status).toBe(201);
    const user = (await res.json()) as UserBody;
    expect(ids(user)).toEqual([roleA]);
    expect(await extrasOf(user.id)).toEqual([]);
  });

  test("refuses a default it does not hold", async () => {
    const res = await create({ roleId: roleA, roleIds: [roleB] });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("default_role_not_held");
  });

  test("refuses a role that does not exist", async () => {
    const res = await create({
      roleId: roleA,
      roleIds: [roleA, crypto.randomUUID()],
    });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("role_not_found");
  });

  test("needs a NIK when any of its roles does", async () => {
    const res = await create({ roleId: roleA, roleIds: [roleA, deptRole] });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("scope_requires_nik");
  });
});

describe("editing an account's roles", () => {
  test("replaces the set with the one given", async () => {
    const user = (await (
      await create({ roleId: roleA, roleIds: [roleA, roleB] })
    ).json()) as UserBody;

    const res = await send("PATCH", `/users/${user.id}`, { roleIds: [roleA] });
    expect(res.status).toBe(200);
    expect(ids((await res.json()) as UserBody)).toEqual([roleA]);
    expect(await extrasOf(user.id)).toEqual([]);
  });

  test("moves the default within the set", async () => {
    const user = (await (
      await create({ roleId: roleA, roleIds: [roleA, roleB] })
    ).json()) as UserBody;

    const res = await send("PATCH", `/users/${user.id}`, {
      roleId: roleB,
      roleIds: [roleA, roleB],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UserBody;
    expect(body.roleId).toBe(roleB);
    expect(ids(body)).toEqual([roleB, roleA]);
    expect(await extrasOf(user.id)).toEqual([roleA]);
  });

  test("keeps the extras when only the default is changed", async () => {
    // A client that predates multi-role accounts sends `roleId` alone.
    const user = (await (
      await create({ roleId: roleA, roleIds: [roleA, roleB] })
    ).json()) as UserBody;
    const res = await send("PATCH", `/users/${user.id}`, {
      roleId: adminRole,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as UserBody;
    expect(body.roleId).toBe(adminRole);
    expect(ids(body)).toEqual([adminRole, roleB]);
  });

  test("refuses a default outside the set", async () => {
    const user = (await (await create({ roleId: roleA })).json()) as UserBody;
    const res = await send("PATCH", `/users/${user.id}`, {
      roleId: roleA,
      roleIds: [roleB],
    });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("default_role_not_held");
  });

  test("ends a session acting as a role taken away", async () => {
    const user = (await (
      await create({ roleId: roleA, roleIds: [roleA, roleB] })
    ).json()) as UserBody;
    const actingAsB = await createSession("user", user.id, "bearer", roleB);
    const probeAs = (sessionId: string) =>
      app.handle(
        new Request("http://localhost/probe", {
          headers: { authorization: `Bearer ${sessionId}` },
        })
      );
    // The account is created on the issued password; let it through the gate.
    await db
      .update(schema.users)
      .set({ mustChangePassword: false })
      .where(eq(schema.users.id, user.id));
    await invalidateUser(user.id);
    expect((await probeAs(actingAsB.id)).status).toBe(200);

    await send("PATCH", `/users/${user.id}`, { roleIds: [roleA] });
    expect((await probeAs(actingAsB.id)).status).toBe(401);
  });
});

test("the list carries every account's roles", async () => {
  const user = (await (
    await create({ roleId: roleA, roleIds: [roleA, roleB] })
  ).json()) as UserBody;
  const list = (await (await send("GET", "/users")).json()) as UserBody[];
  expect(ids(list.find((u) => u.id === user.id)!)).toEqual([roleA, roleB]);
});

describe("a role held only as an extra", () => {
  test("is counted, cannot be deleted, and blocks a scope it cannot meet", async () => {
    const lone = await role("Lone", "all");
    await create({ roleId: roleA, roleIds: [roleA, lone] });

    const roles = (await (await send("GET", "/roles")).json()) as {
      id: string;
      userCount: number;
    }[];
    expect(roles.find((r) => r.id === lone)!.userCount).toBe(1);

    const del = await send("DELETE", `/roles/${lone}`);
    expect(del.status).toBe(409);
    expect(await codeOf(del)).toBe("role_in_use");

    // The holder has no NIK, so the role cannot become `dept`.
    const narrow = await send("PATCH", `/roles/${lone}`, { scope: "dept" });
    expect(narrow.status).toBe(409);
    expect(await codeOf(narrow)).toBe("scope_unsatisfiable");
  });
});

describe("a role set as sent", () => {
  test("empty is refused: an account holds at least its default", async () => {
    const res = await create({ roleId: roleA, roleIds: [] });
    expect(res.status).toBe(422);
    expect(await codeOf(res)).toBe("default_role_not_held");
  });

  test("with a role twice holds it once", async () => {
    const res = await create({ roleId: roleA, roleIds: [roleA, roleB, roleB] });
    expect(res.status).toBe(201);
    const user = (await res.json()) as UserBody;
    expect(ids(user)).toEqual([roleA, roleB]);
    expect(await extrasOf(user.id)).toEqual([roleB]);
  });
});

test("a role name may not hold a comma, which the import splits on", async () => {
  const res = await send("POST", "/roles", {
    name: `${tag} Ops, Malam`,
    scope: "all",
    permissions: {},
  });
  expect(res.status).toBe(422);
  expect(await codeOf(res)).toBe("role_name_comma");
});

describe("the import commit", () => {
  const NIK = `99070${uid().replace(/\D/g, "").padEnd(4, "0").slice(0, 4)}`;
  const org = { company: "", department: "", position: "", employee: "" };

  beforeAll(async () => {
    const [company] = await db
      .insert(schema.companies)
      .values({ name: `${tag} PT`, code: `ZM${uid().slice(0, 4)}` })
      .returning({ id: schema.companies.id });
    org.company = company!.id;
    const [department] = await db
      .insert(schema.departments)
      .values({ name: `${tag} Dept`, companyId: org.company })
      .returning({ id: schema.departments.id });
    org.department = department!.id;
    const [position] = await db
      .insert(schema.positions)
      .values({ name: `${tag} Pos`, departmentId: org.department })
      .returning({ id: schema.positions.id });
    org.position = position!.id;
    const [employee] = await db
      .insert(schema.employees)
      .values({
        nik: NIK,
        name: `${tag} Budi`,
        companyId: org.company,
        departmentId: org.department,
        positionId: org.position,
        status: "aktif",
      })
      .returning({ id: schema.employees.id });
    org.employee = employee!.id;
  });

  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.nik, NIK));
    await db
      .delete(schema.employees)
      .where(eq(schema.employees.id, org.employee));
    await db
      .delete(schema.positions)
      .where(eq(schema.positions.id, org.position));
    await db
      .delete(schema.departments)
      .where(eq(schema.departments.id, org.department));
    await db
      .delete(schema.companies)
      .where(eq(schema.companies.id, org.company));
  });

  async function commit(roleCell: string) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Akun");
    ws.addRow(["nik", "nama", "email", "role"]);
    ws.addRow([NIK, `${tag} Budi`, "", roleCell]);
    const form = new FormData();
    form.append(
      "file",
      new File([await wb.xlsx.writeBuffer()], "akun.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
    );
    return app.handle(
      new Request("http://localhost/users/import/commit", {
        method: "POST",
        headers: { cookie },
        body: form,
      })
    );
  }

  const accountByNik = async () =>
    (
      await db
        .select({ id: schema.users.id, roleId: schema.users.roleId })
        .from(schema.users)
        .where(eq(schema.users.nik, NIK))
    )[0]!;

  test("writes the default and the extras, then replaces them on re-upload", async () => {
    const first = await commit(`${tag} B, ${tag} A`);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ created: 1, updated: 0 });
    const account = await accountByNik();
    expect(account.roleId).toBe(roleB);
    expect(await extrasOf(account.id)).toEqual([roleA]);

    const again = await commit(`${tag} A`);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ created: 0, updated: 1 });
    expect((await accountByNik()).roleId).toBe(roleA);
    expect(await extrasOf(account.id)).toEqual([]);
  });
});
