/**
 * Filtering the ticket list.
 *
 * What is worth being wrong about here is *where* the filter runs. Applied in
 * the browser it would narrow five hundred rows that the database had already
 * chosen, and the counts under the table would answer a different question
 * than the table shows — which is the one question this screen exists for:
 * "how many failed in my department".
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/tickets.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { ticketRoutes } from "./tickets";

const app = new Elysia().use(ticketRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji Tiket ${uid()}`;
/** Far enough back that no real muster shares it. */
const DAY = "1998-04-02";
const ip = "203.0.113.77";

const made = {
  users: [] as string[],
  roles: [] as string[],
  employees: [] as string[],
  departments: [] as string[],
  niks: [] as string[],
};

let admin: { cookie: string };

type TicketList = {
  printed: number;
  failed: number;
  dry: number;
  departments: string[];
  rows: {
    nik: string;
    name: string | null;
    department: string | null;
    shift: "day" | "night";
    role: "standing" | "spare" | null;
    status: string;
  }[];
};

async function makeUser() {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-tiket-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values([{ roleId: role!.id, menuSlug: "tiket", mode: "manage" }]);
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

/* Departments are unique per company, and two of these people share one. */
const deptIds = new Map<string, string>();

/** One person in one department, and the slip they were handed. */
async function person(input: {
  nik: string;
  name: string;
  department: string;
  shift: "day" | "night";
  role: "standing" | "spare";
  status: "printed" | "failed" | "dry";
}) {
  const [company] = await db
    .select({ id: schema.companies.id })
    .from(schema.companies)
    .limit(1);
  const deptName = `${tag} ${input.department}`;
  let deptId = deptIds.get(deptName);
  if (!deptId) {
    const [dept] = await db
      .insert(schema.departments)
      .values({ name: deptName, companyId: company!.id })
      .returning({ id: schema.departments.id });
    deptId = dept!.id;
    deptIds.set(deptName, deptId);
    made.departments.push(deptId);
  }

  /* Any position will do — what is under test is the department filter. */
  const [position] = await db
    .select({ id: schema.positions.id })
    .from(schema.positions)
    .limit(1);

  const [employee] = await db
    .insert(schema.employees)
    .values({
      nik: input.nik,
      name: input.name,
      departmentId: deptId,
      companyId: company!.id,
      positionId: position!.id,
    })
    .returning({ id: schema.employees.id });
  made.employees.push(employee!.id);
  made.niks.push(input.nik);

  await db.insert(schema.tickets).values({
    nik: input.nik,
    date: DAY,
    shift: input.shift,
    ip,
    status: input.status,
    contentHash: uid(),
    preview: "x",
    fields: { at: `${DAY} 05:00:00`, seat: null, role: input.role },
  });
  return deptName;
}

let miningName = "";

beforeAll(async () => {
  admin = await makeUser();
  miningName = await person({
    nik: "ZZ70000001",
    name: "Ahmad Tetap",
    department: "MINING",
    shift: "day",
    role: "standing",
    status: "printed",
  });
  await person({
    nik: "ZZ70000002",
    name: "Budi Spare",
    department: "MINING",
    shift: "day",
    role: "spare",
    status: "failed",
  });
  await person({
    nik: "ZZ70000003",
    name: "Candra Malam",
    department: "PLANT",
    shift: "night",
    role: "standing",
    status: "dry",
  });
});

afterAll(async () => {
  if (made.niks.length)
    await db
      .delete(schema.tickets)
      .where(inArray(schema.tickets.nik, made.niks));
  if (made.employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
  if (made.departments.length)
    await db
      .delete(schema.departments)
      .where(inArray(schema.departments.id, made.departments));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
  /* The redis client is shared across every suite in the process, so closing
     it here would take out whichever file runs next — which is what it did
     when this suite first ran alongside the others. */
});

const list = async (params: Record<string, string> = {}) => {
  const query = new URLSearchParams({ date: DAY, ...params });
  const response = await app.handle(
    new Request(`http://localhost/tickets?${query}`, {
      headers: { cookie: admin.cookie },
    })
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as TicketList;
  /* The dev register holds other people's tickets; these assertions are
     about ours. */
  /* The dev register holds other people's tickets on other dates; these
     assertions are about ours. */
  return {
    ...body,
    rows: body.rows.filter((r) => r.nik.startsWith("ZZ7")),
  };
};

describe("who the list shows", () => {
  test("everybody on the date when nothing is asked", async () => {
    const body = await list();
    expect(body.rows.map((r) => r.nik).sort()).toEqual([
      "ZZ70000001",
      "ZZ70000002",
      "ZZ70000003",
    ]);
  });

  test("a department narrows it", async () => {
    const body = await list({ department: miningName });
    expect(body.rows.map((r) => r.nik).sort()).toEqual([
      "ZZ70000001",
      "ZZ70000002",
    ]);
  });

  test("a shift narrows it", async () => {
    const body = await list({ shift: "night" });
    expect(body.rows.map((r) => r.nik)).toEqual(["ZZ70000003"]);
  });

  /* Stored in the slip's own fields, not a column — it is part of the paper. */
  test("the kind of operator narrows it", async () => {
    const body = await list({ role: "spare" });
    expect(body.rows.map((r) => r.nik)).toEqual(["ZZ70000002"]);
  });

  test("a status narrows it", async () => {
    const body = await list({ status: "failed" });
    expect(body.rows.map((r) => r.nik)).toEqual(["ZZ70000002"]);
  });

  test("the search matches a name or a NIK", async () => {
    expect((await list({ q: "Candra" })).rows.map((r) => r.nik)).toEqual([
      "ZZ70000003",
    ]);
    expect((await list({ q: "70000001" })).rows.map((r) => r.nik)).toEqual([
      "ZZ70000001",
    ]);
  });

  test("filters combine rather than replace one another", async () => {
    const body = await list({ department: miningName, role: "standing" });
    expect(body.rows.map((r) => r.nik)).toEqual(["ZZ70000001"]);
  });
});

describe("what the list says about itself", () => {
  /*
   * The counts follow the filter. Somebody filtering to their own department
   * is asking how many of *their* people are owed a slip, and a footer
   * counting the whole site would answer a question nobody asked.
   */
  test("the counts are of the filtered set, not the day", async () => {
    const all = await list();
    expect(all.printed).toBeGreaterThanOrEqual(1);

    const failedOnly = await list({ status: "failed" });
    expect(failedOnly.printed).toBe(0);
    expect(failedOnly.dry).toBe(0);
    expect(failedOnly.failed).toBeGreaterThanOrEqual(1);
  });

  /* Otherwise picking a department empties the list you would use to pick a
     different one. */
  test("the department options survive a department filter", async () => {
    const body = await list({ department: miningName });
    expect(body.departments).toContain(miningName);
    expect(body.departments).toContain(`${tag} PLANT`);
  });

  test("a slip carries the department, shift and kind it was issued under", async () => {
    const [row] = (await list({ q: "ZZ70000002" })).rows;
    expect(row).toMatchObject({
      department: miningName,
      shift: "day",
      role: "spare",
    });
  });
});

describe("a slip issued before the kind was printed on it", () => {
  /* `fields` has no `role` key on those, and guessing one would put a word on
     a reprint that the original paper never carried. */
  test("reports no kind rather than inventing one", async () => {
    await db
      .update(schema.tickets)
      .set({ fields: { at: `${DAY} 05:00:00`, seat: null } })
      .where(eq(schema.tickets.nik, "ZZ70000001"));

    const [row] = (await list({ q: "ZZ70000001" })).rows;
    expect(row!.role).toBeNull();
    /* And it is not swept up by a filter that names a kind — the other
       standing operator still is. */
    expect((await list({ role: "standing" })).rows.map((r) => r.nik)).toEqual([
      "ZZ70000003",
    ]);
  });
});
