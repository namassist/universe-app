/**
 * The revision routes, driven through Elysia with real sessions.
 *
 * Unlike `master-import.test.ts`, which exercises a pure parser, almost
 * everything worth asserting here *is* the route: the stale-entry conflict, the
 * refusal to reject without a reason, and the scope predicate that decides whose
 * NIK an entry may name. Testing the handlers underneath would test everything
 * except the part that can be wrong.
 *
 * The app is assembled from the route modules rather than imported from
 * `index.ts`, which would bind a port and start the scheduler.
 *
 * Needs the dev Postgres and Redis, the same as `db:seed`:
 *   bun --env-file=.env test src/routes/roster-revision.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { redis } from "../redis";
import { db, schema } from "../db";
import { employeesRoutes } from "./employees";
import { rosterRoutes } from "./roster";
import { monthDays } from "./roster-month";
import { commitRoster } from "./roster-import";
import { rosterRevisionRoutes } from "./roster-revision";

const app = new Elysia()
  .use(rosterRevisionRoutes)
  .use(rosterRoutes)
  .use(employeesRoutes);

const MONTH = "2026-09-01";
const DAYS = monthDays(MONTH);

/* --------------------------------------------------------------- fixtures */

const tag = `ZZ Uji Rev ${crypto.randomUUID().slice(0, 8)}`;
const uid = () => crypto.randomUUID();
const nikFor = (prefix: string) => `ZZ${prefix}${uid().slice(0, 8)}`;

type Fixture = {
  departmentA: string;
  departmentB: string;
  companyId: string;
  positionId: string;
  employeeA: { id: string; nik: string };
  employeeB: { id: string; nik: string };
  /** `all` scope, manage on revision and approval. */
  adminAll: { id: string; cookie: string };
  /** `dept` scope resolving to department A, manage on revision. */
  adminDept: { id: string; cookie: string };
  documentA: string;
  documentB: string;
};

let fx: Fixture;
const made = {
  roles: [] as string[],
  users: [] as string[],
  documents: [] as string[],
  employees: [] as string[],
  positions: [] as string[],
  companies: [] as string[],
  departments: [] as string[],
};

async function makeRole(
  scope: "all" | "dept",
  grants: [string, "view" | "manage"][]
): Promise<string> {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-uji-${uid()}`, name: tag, scope })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db.insert(schema.rolePermissions).values(
    grants.map(([menuSlug, mode]) => ({
      roleId: role!.id,
      menuSlug,
      mode,
    }))
  );
  return role!.id;
}

/** An account plus a live cookie session for it. */
async function makeUser(roleId: string, nik: string | null) {
  const [user] = await db
    .insert(schema.users)
    .values({
      nik,
      email: nik ? null : `zz-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId,
      // The auth macro refuses everything but logout while this holds.
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  return { id: user!.id, cookie: `${SESSION_COOKIE}=${session.id}` };
}

async function makeEmployee(departmentId: string, prefix: string) {
  const nik = nikFor(prefix);
  const [row] = await db
    .insert(schema.employees)
    .values({
      nik,
      name: `${tag} ${prefix}`,
      companyId: fx.companyId,
      positionId: fx.positionId,
      departmentId,
    })
    .returning({ id: schema.employees.id });
  made.employees.push(row!.id);
  return { id: row!.id, nik };
}

const get = (path: string, cookie: string) =>
  app.handle(new Request(`http://localhost${path}`, { headers: { cookie } }));

const post = (path: string, cookie: string, body: unknown) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

const del = (path: string, cookie: string) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: "DELETE",
      headers: { cookie },
    })
  );

beforeAll(async () => {
  // `scheduler.test.ts` disconnects the shared Redis client in its teardown and
  // bun runs every file in one process, so whether this file has a connection
  // depends on file order. Reviving it is cheaper than making that ordering
  // matter.
  if (redis.status === "end") await redis.connect();

  // Company first: a department belongs to one, and a position to a department.
  const [company] = await db
    .insert(schema.companies)
    .values({ name: tag, code: tag.slice(-8) })
    .returning({ id: schema.companies.id });
  made.companies.push(company!.id);

  const [departmentA] = await db
    .insert(schema.departments)
    .values({ name: `${tag} A`, companyId: company!.id })
    .returning({ id: schema.departments.id });
  const [departmentB] = await db
    .insert(schema.departments)
    .values({ name: `${tag} B`, companyId: company!.id })
    .returning({ id: schema.departments.id });
  made.departments.push(departmentA!.id, departmentB!.id);

  const [position] = await db
    .insert(schema.positions)
    .values({ name: tag, departmentId: departmentA!.id })
    .returning({ id: schema.positions.id });
  made.positions.push(position!.id);

  fx = {
    departmentA: departmentA!.id,
    departmentB: departmentB!.id,
    companyId: company!.id,
    positionId: position!.id,
  } as Fixture;

  fx.employeeA = await makeEmployee(fx.departmentA, "A");
  fx.employeeB = await makeEmployee(fx.departmentB, "B");

  const allRole = await makeRole("all", [
    ["roster-data", "manage"],
    ["roster-revision", "manage"],
    ["roster-approval", "manage"],
    ["employees", "manage"],
  ]);
  fx.adminAll = await makeUser(allRole, null);

  // A `dept` account resolves its department *through* its NIK's employee
  // record, so this account carries employee A's NIK.
  const deptRole = await makeRole("dept", [
    ["roster-data", "manage"],
    ["roster-revision", "manage"],
    ["employees", "view"],
  ]);
  fx.adminDept = await makeUser(deptRole, fx.employeeA.nik);

  const rows = (employeeId: string) => [
    {
      row: 2,
      employeeId,
      nik: "",
      name: "",
      codes: DAYS.map(() => "D" as const),
    },
  ];
  const a = await commitRoster(
    {
      departmentId: fx.departmentA,
      monthFirstDay: MONTH,
      fileName: "a.xlsx",
      uploadedBy: fx.adminAll.id,
    },
    rows(fx.employeeA.id),
    DAYS
  );
  const b = await commitRoster(
    {
      departmentId: fx.departmentB,
      monthFirstDay: MONTH,
      fileName: "b.xlsx",
      uploadedBy: fx.adminAll.id,
    },
    rows(fx.employeeB.id),
    DAYS
  );
  made.documents.push(a.documentId, b.documentId);
  fx.documentA = a.documentId;
  fx.documentB = b.documentId;
});

afterAll(async () => {
  // Documents cascade to their days and revisions; employees are `restrict`,
  // so they can only go once nothing points at them.
  if (made.documents.length)
    await db
      .delete(schema.rosterDocuments)
      .where(inArray(schema.rosterDocuments.id, made.documents));
  if (made.employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
  // Positions, then departments, then the company: the catalogues own each
  // other now, and `restrict` means the order is not a preference.
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

/** Submit one entry and hand back the created entry's id. */
async function submit(
  cookie: string,
  entry: { nik: string; date: string; toCode: string; reason?: string }
) {
  const response = await post("/roster-revisions", cookie, {
    entries: [{ reason: "uji", ...entry }],
  });
  return response;
}

/* ------------------------------------------------------------------- scope */

describe("who an entry may name", () => {
  test("a dept caller cannot submit for another department", async () => {
    const response = await submit(fx.adminDept.cookie, {
      nik: fx.employeeB.nik,
      date: DAYS[4]!,
      toCode: "OFF",
    });
    // Answered as "not found" rather than "not allowed": a refusal that only
    // fires for real NIKs is a way to enumerate the register.
    expect(response.status).toBe(404);

    const rows = await db
      .select({ id: schema.rosterRevisionItems.id })
      .from(schema.rosterRevisionItems)
      .where(eq(schema.rosterRevisionItems.employeeId, fx.employeeB.id));
    expect(rows).toHaveLength(0);
  });

  test("a dept caller can submit within its own department", async () => {
    const response = await submit(fx.adminDept.cookie, {
      nik: fx.employeeA.nik,
      date: DAYS[4]!,
      toCode: "OFF",
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { code: string; items: unknown[] };
    expect(body.code).toMatch(/^REV-\d{4}$/);
    expect(body.items).toHaveLength(1);
  });
});

/* -------------------------------------------------------------- the dates */

describe("which dates a revision may name", () => {
  test("a past date and a future date inside the month are both accepted", async () => {
    // No backward window and no forward one (design D17): the only boundary is
    // the month of the document being revised.
    for (const date of [DAYS[0]!, DAYS[DAYS.length - 1]!]) {
      const response = await submit(fx.adminAll.cookie, {
        nik: fx.employeeA.nik,
        date,
        toCode: "CR",
      });
      expect(response.status).toBe(201);
    }
  });

  test("a date outside the document's month is refused", async () => {
    const response = await submit(fx.adminAll.cookie, {
      nik: fx.employeeA.nik,
      date: "2026-10-01",
      toCode: "OFF",
    });
    expect(response.status).toBe(422);
  });

  test("a day the document carries no row for is refused", async () => {
    // Employee B has a document, but not this one, and the entry resolves
    // against B's own department — so ask for a day A's document lacks by
    // naming an employee with no row at all.
    const stranger = await makeEmployee(fx.departmentA, "C");
    const response = await submit(fx.adminAll.cookie, {
      nik: stranger.nik,
      date: DAYS[2]!,
      toCode: "OFF",
    });
    expect(response.status).toBe(422);
  });
});

/* ---------------------------------------------------------- the decisions */

describe("deciding an entry", () => {
  test("approving writes the code onto the roster and shows up in force", async () => {
    const date = DAYS[9]!;
    const created = await submit(fx.adminAll.cookie, {
      nik: fx.employeeA.nik,
      date,
      toCode: "OFF",
    });
    const submission = (await created.json()) as { items: { id: string }[] };
    const itemId = submission.items[0]!.id;

    const before = await get(
      `/roster/in-force?date=${date}&code=D`,
      fx.adminAll.cookie
    );
    const beforeRows = (await before.json()) as { employeeId: string }[];
    expect(beforeRows.some((r) => r.employeeId === fx.employeeA.id)).toBe(true);

    const decided = await post(
      `/roster-revisions/items/${itemId}/approve`,
      fx.adminAll.cookie,
      {}
    );
    expect(decided.status).toBe(200);
    const body = (await decided.json()) as {
      status: string;
      decidedById: string | null;
      submittedById: string;
    };
    expect(body.status).toBe("approved");
    // Both accounts come back so an approver deciding its own submission is
    // visible rather than prevented (design D18).
    expect(body.decidedById).toBe(fx.adminAll.id);
    expect(body.submittedById).toBe(fx.adminAll.id);

    const after = await get(
      `/roster/in-force?date=${date}&code=D`,
      fx.adminAll.cookie
    );
    const afterRows = (await after.json()) as { employeeId: string }[];
    expect(afterRows.some((r) => r.employeeId === fx.employeeA.id)).toBe(false);
  });

  test("an entry whose day moved under it is refused, naming both codes", async () => {
    const date = DAYS[14]!;
    const created = await submit(fx.adminAll.cookie, {
      nik: fx.employeeA.nik,
      date,
      toCode: "OFF",
    });
    const submission = (await created.json()) as { items: { id: string }[] };
    const itemId = submission.items[0]!.id;

    // Somebody else changes the day between submission and decision.
    await db
      .update(schema.rosterDays)
      .set({ code: "N" })
      .where(eq(schema.rosterDays.documentId, fx.documentA));

    const decided = await post(
      `/roster-revisions/items/${itemId}/approve`,
      fx.adminAll.cookie,
      {}
    );
    expect(decided.status).toBe(409);
    const body = (await decided.json()) as {
      code: string;
      recordedCode: string;
      currentCode: string;
    };
    expect(body.code).toBe("stale_revision");
    expect(body.recordedCode).toBe("D");
    expect(body.currentCode).toBe("N");

    const [unchanged] = await db
      .select({ status: schema.rosterRevisionItems.status })
      .from(schema.rosterRevisionItems)
      .where(eq(schema.rosterRevisionItems.id, itemId));
    expect(unchanged!.status).toBe("pending");
  });

  test("rejecting without a reason is refused", async () => {
    const date = DAYS[16]!;
    const created = await submit(fx.adminAll.cookie, {
      nik: fx.employeeA.nik,
      date,
      toCode: "OFF",
    });
    const submission = (await created.json()) as { items: { id: string }[] };
    const itemId = submission.items[0]!.id;

    const blank = await post(
      `/roster-revisions/items/${itemId}/reject`,
      fx.adminAll.cookie,
      { reason: "   " }
    );
    expect(blank.status).toBe(422);

    const missing = await post(
      `/roster-revisions/items/${itemId}/reject`,
      fx.adminAll.cookie,
      {}
    );
    expect(missing.status).toBe(422);

    const [untouched] = await db
      .select({ status: schema.rosterRevisionItems.status })
      .from(schema.rosterRevisionItems)
      .where(eq(schema.rosterRevisionItems.id, itemId));
    expect(untouched!.status).toBe("pending");
  });

  test("rejecting with a reason decides it and leaves the roster alone", async () => {
    const date = DAYS[17]!;
    const created = await submit(fx.adminAll.cookie, {
      nik: fx.employeeA.nik,
      date,
      toCode: "AL",
    });
    const submission = (await created.json()) as { items: { id: string }[] };
    const itemId = submission.items[0]!.id;

    const [before] = await db
      .select({ code: schema.rosterDays.code })
      .from(schema.rosterDays)
      .where(eq(schema.rosterDays.date, date));

    const rejected = await post(
      `/roster-revisions/items/${itemId}/reject`,
      fx.adminAll.cookie,
      { reason: "tidak disetujui atasan" }
    );
    expect(rejected.status).toBe(200);
    const body = (await rejected.json()) as {
      status: string;
      decisionNote: string;
    };
    expect(body.status).toBe("rejected");
    expect(body.decisionNote).toBe("tidak disetujui atasan");

    const [after] = await db
      .select({ code: schema.rosterDays.code })
      .from(schema.rosterDays)
      .where(eq(schema.rosterDays.date, date));
    expect(after!.code).toBe(before!.code);

    // A decided entry cannot be decided again.
    const again = await post(
      `/roster-revisions/items/${itemId}/approve`,
      fx.adminAll.cookie,
      {}
    );
    expect(again.status).toBe(409);
  });
});

/* -------------------------------------------------- the employee's traces */

describe("roster traces hold an employee in place", () => {
  test("an employee with roster days cannot be deleted, and the 409 says why", async () => {
    const response = await del(
      `/employees/${fx.employeeB.nik}`,
      fx.adminAll.cookie
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("hari roster");

    const [still] = await db
      .select({ id: schema.employees.id })
      .from(schema.employees)
      .where(eq(schema.employees.id, fx.employeeB.id));
    expect(still).toBeDefined();
  });

  test("an archived document still holds the employee", async () => {
    // Re-uploading B's month archives its document without moving its rows —
    // history has to stay readable, so it has to stay referenced.
    const second = await commitRoster(
      {
        departmentId: fx.departmentB,
        monthFirstDay: MONTH,
        fileName: "b-2.xlsx",
        uploadedBy: fx.adminAll.id,
      },
      [
        {
          row: 2,
          employeeId: fx.employeeB.id,
          nik: fx.employeeB.nik,
          name: tag,
          codes: DAYS.map(() => "OFF" as const),
        },
      ],
      DAYS
    );
    made.documents.push(second.documentId);
    expect(second.archivedDocumentId).toBe(fx.documentB);

    const response = await del(
      `/employees/${fx.employeeB.nik}`,
      fx.adminAll.cookie
    );
    expect(response.status).toBe(409);
  });

  test("the 409 names revision entries as well as roster days", async () => {
    // The two traces are fixed in different places, so the refusal names them
    // separately rather than saying "referenced by other data". Employee B is
    // used because employee A's NIK also carries an account, and the account
    // check answers first.
    const submitted = await submit(fx.adminAll.cookie, {
      nik: fx.employeeB.nik,
      date: DAYS[3]!,
      toCode: "AL",
    });
    expect(submitted.status).toBe(201);

    const response = await del(
      `/employees/${fx.employeeB.nik}`,
      fx.adminAll.cookie
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("hari roster");
    expect(body.message).toContain("entri revisi");
  });
});
