/**
 * An employee's email: optional, a company address only, stored lowercased,
 * and searchable from the employee list.
 *
 *   bun --env-file=.env test src/routes/employees-email.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { inArray } from "drizzle-orm";
import { isEmployeeEmail } from "@universe/contracts";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { employeesRoutes } from "./employees";

const app = new Elysia().use(employeesRoutes);

const uid = () => crypto.randomUUID().slice(0, 6).toUpperCase();
const run = uid();
const tag = `ZZ Email ${run}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  employees: [] as string[],
  positions: [] as string[],
  departments: [] as string[],
  companies: [] as string[],
};
let cookie = "";
let placement = { companyId: "", departmentId: "", positionId: "" };

type EmployeeBody = { id: string; nik: string; email: string | null };

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

async function create(nik: string, extra: Record<string, unknown> = {}) {
  const res = await send("POST", "/employees", {
    nik,
    name: `${tag} ${nik}`,
    ...placement,
    ...extra,
  });
  if (res.status === 201)
    made.employees.push(((await res.clone().json()) as EmployeeBody).id);
  return res;
}

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
  placement = {
    companyId: company!.id,
    departmentId: department!.id,
    positionId: position!.id,
  };

  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-email-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values({ roleId: role!.id, menuSlug: "employees", mode: "manage" });
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-email-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId: role!.id,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const s = await createSession("user", user!.id, "cookie");
  cookie = `${SESSION_COOKIE}=${s.id}`;
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

describe("isEmployeeEmail", () => {
  test.each([
    "budi@ungguldinamika.co.id",
    "Budi.Santoso@UnggulDinamika.CO.ID",
    "budi+shift_a-1@ungguldinamika.co.id",
  ])("takes %s", (value) => expect(isEmployeeEmail(value)).toBe(true));

  test.each([
    "budi@gmail.com",
    "budi@mail.ungguldinamika.co.id",
    "budi@ungguldinamika.co.id.evil.com",
    "@ungguldinamika.co.id",
    "a@b@ungguldinamika.co.id",
    ".budi@ungguldinamika.co.id",
    "bu..di@ungguldinamika.co.id",
    "bu di@ungguldinamika.co.id",
    "ungguldinamika.co.id",
  ])("refuses %s", (value) => expect(isEmployeeEmail(value)).toBe(false));
});

describe("an employee's email", () => {
  test("is optional: created without one, it is null", async () => {
    const res = await create(`ZZE${run}01`);
    expect(res.status).toBe(201);
    expect(((await res.json()) as EmployeeBody).email).toBeNull();
  });

  test("is stored trimmed and lowercased", async () => {
    const res = await create(`ZZE${run}02`, {
      email: "  Budi.Santoso@UnggulDinamika.co.id ",
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as EmployeeBody).email).toBe(
      "budi.santoso@ungguldinamika.co.id"
    );
  });

  test("refuses another domain, naming the field", async () => {
    const res = await create(`ZZE${run}03`, { email: "budi@gmail.com" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      code: string;
      issues: { field: string; message: string }[];
    };
    expect(body.code).toBe("validation_failed");
    expect(body.issues[0]!.field).toBe("email");
    expect(body.issues[0]!.message).toBe(
      "Email harus alamat @ungguldinamika.co.id"
    );
  });

  test("is changed, kept and cleared by an edit", async () => {
    const nik = `ZZE${run}04`;
    await create(nik, { email: "satu@ungguldinamika.co.id" });

    const changed = await send("PATCH", `/employees/${nik}`, {
      email: "Dua@ungguldinamika.co.id",
    });
    expect(((await changed.json()) as EmployeeBody).email).toBe(
      "dua@ungguldinamika.co.id"
    );

    const kept = await send("PATCH", `/employees/${nik}`, { room: "A-1" });
    expect(((await kept.json()) as EmployeeBody).email).toBe(
      "dua@ungguldinamika.co.id"
    );

    const refused = await send("PATCH", `/employees/${nik}`, {
      email: "dua@gmail.com",
    });
    expect(refused.status).toBe(422);

    const cleared = await send("PATCH", `/employees/${nik}`, { email: "" });
    expect(((await cleared.json()) as EmployeeBody).email).toBeNull();
  });

  test("is reached by the list search", async () => {
    await create(`ZZE${run}05`, {
      email: `cari.${run.toLowerCase()}@ungguldinamika.co.id`,
    });
    const res = await send(
      "GET",
      `/employees?q=${encodeURIComponent(`cari.${run.toLowerCase()}`)}`
    );
    const found = (await res.json()) as EmployeeBody[];
    expect(found.map((e) => e.nik)).toEqual([`ZZE${run}05`]);
  });
});
