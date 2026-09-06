/**
 * The roster grid's two readings: a month, and a span of it.
 *
 * The month view was always there. What is worth pinning is the span and the
 * tally beside it, because both are easy to get subtly wrong in ways no screen
 * would reveal: a summary folded out of the page's cells would be correct on
 * page one and wrong on page two, and a tally that ignored the search would
 * answer a question nobody asked.
 *
 *   bun --env-file=.env test src/routes/roster.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { rosterRoutes } from "./roster";

const app = new Elysia().use(rosterRoutes);
const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Grid ${uid()}`;

/** A month no real document covers, so the fixture owns its whole department. */
const MONTH = "1999-07-01";
const D1 = "1999-07-01";
const D2 = "1999-07-02";
const D3 = "1999-07-03";

let cookie: string;
let documentId: string;
let companyId: string, departmentId: string, positionId: string;
let roleId: string, userId: string;
const employees: string[] = [];

type Cell = {
  nik: string;
  date: string;
  code: "D" | "N" | "OFF" | "CR" | "AL";
};

/** Two days of a small crew, written the way the mirror writes them. */
const FIXTURE: Cell[] = [
  { nik: "990500001", date: D1, code: "D" },
  { nik: "990500002", date: D1, code: "D" },
  { nik: "990500003", date: D1, code: "D" },
  { nik: "990500004", date: D1, code: "N" },
  { nik: "990500005", date: D1, code: "N" },
  { nik: "990500006", date: D1, code: "OFF" },
  { nik: "990500007", date: D1, code: "CR" },
  // The second day is deliberately different, so a query that forgets the date
  // filter returns numbers that do not match either day.
  { nik: "990500001", date: D2, code: "N" },
  { nik: "990500002", date: D2, code: "OFF" },
  // A third day, so a span of two can be told apart from "everything".
  { nik: "990500003", date: D3, code: "AL" },
];

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();

  const [company] = await db
    .insert(schema.companies)
    .values({ name: `${tag} PT`, code: `ZG${uid().slice(0, 4)}` })
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

  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-grid-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  roleId = role!.id;
  await db
    .insert(schema.rolePermissions)
    .values({ roleId, menuSlug: "roster-data", mode: "view" });

  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-grid-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  userId = user!.id;
  cookie = `${SESSION_COOKIE}=${(await createSession("user", userId, "cookie")).id}`;

  const [document] = await db
    .insert(schema.rosterDocuments)
    .values({
      departmentId,
      month: MONTH,
      fileName: `${tag}.xlsx`,
      uploadedBy: userId,
      source: "unggul",
    })
    .returning({ id: schema.rosterDocuments.id });
  documentId = document!.id;

  const byNik = new Map<string, string>();
  for (const nik of new Set(FIXTURE.map((c) => c.nik))) {
    const [row] = await db
      .insert(schema.employees)
      .values({
        nik,
        name: `${tag} ${nik}`,
        companyId,
        departmentId,
        positionId,
        status: "aktif",
      })
      .returning({ id: schema.employees.id });
    employees.push(row!.id);
    byNik.set(nik, row!.id);
  }
  await db.insert(schema.rosterDays).values(
    FIXTURE.map((c) => ({
      documentId,
      employeeId: byNik.get(c.nik)!,
      date: c.date,
      code: c.code,
    }))
  );
});

afterAll(async () => {
  await db
    .delete(schema.rosterDays)
    .where(eq(schema.rosterDays.documentId, documentId));
  await db
    .delete(schema.rosterDocuments)
    .where(eq(schema.rosterDocuments.id, documentId));
  if (employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, employees));
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
  await db.delete(schema.positions).where(eq(schema.positions.id, positionId));
  await db
    .delete(schema.departments)
    .where(eq(schema.departments.id, departmentId));
  await db.delete(schema.companies).where(eq(schema.companies.id, companyId));
});

type Grid = {
  days: string[];
  rows: { nik: string; codes: (string | null)[] }[];
  total: number;
  summary: { code: string; count: number }[];
};

async function grid(params: Record<string, string> = {}): Promise<Grid> {
  const query = new URLSearchParams(params);
  const response = await app.handle(
    new Request(`http://localhost/roster/${documentId}/days?${query}`, {
      headers: { cookie },
    })
  );
  expect(response.status).toBe(200);
  return (await response.json()) as Grid;
}

/** The tally as a plain object, which is how a reader checks it. */
const counts = (g: Grid) =>
  Object.fromEntries(g.summary.map((s) => [s.code, s.count]));

describe("the whole month", () => {
  test("keeps every day as a column and tallies the month", async () => {
    const g = await grid();

    expect(g.days).toHaveLength(31);
    expect(g.total).toBe(7);
    // Every cell of all three days, which is what a month-wide tally means.
    expect(counts(g)).toEqual({ D: 3, N: 3, OFF: 2, CR: 1, AL: 1 });
  });
});

describe("a span of it", () => {
  test("narrows the grid to that day's column", async () => {
    const g = await grid({ from: D1, to: D1 });

    expect(g.days).toEqual([D1]);
    // Still the grid's own shape — one column, codes still positional against
    // `days` — so the screen renders a day through the code that renders a
    // month rather than through a second one kept in step with it.
    expect(g.rows.map((r) => r.codes.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    const day = new Map(g.rows.map((r) => [r.nik, r.codes[0]]));
    expect(day.get("990500004")).toBe("N");
    expect(day.get("990500006")).toBe("OFF");
  });

  test("counts that day and not the one beside it", async () => {
    expect(counts(await grid({ from: D1, to: D1 }))).toEqual({
      D: 3,
      N: 2,
      OFF: 1,
      CR: 1,
    });
    expect(counts(await grid({ from: D2, to: D2 }))).toEqual({ N: 1, OFF: 1 });
  });

  test("rows are the people rostered that day, nobody else", async () => {
    const g = await grid({ from: D2, to: D2 });

    expect(g.total).toBe(2);
    expect(g.rows.map((r) => r.nik).sort()).toEqual(["990500001", "990500002"]);
  });

  /* The reason the tally is its own query. Page two of a day would otherwise
     report the two people on it as the whole shift. */
  test("the tally does not move when the page does", async () => {
    const first = await grid({ from: D1, to: D1, pageSize: "2", page: "1" });
    const second = await grid({ from: D1, to: D1, pageSize: "2", page: "2" });

    expect(first.rows).toHaveLength(2);
    expect(second.rows).toHaveLength(2);
    expect(counts(second)).toEqual(counts(first));
    expect(counts(first)).toEqual({ D: 3, N: 2, OFF: 1, CR: 1 });
  });

  /* And the reason it is not simply the whole document either: the table and
     the number under it have to be about the same rows. */
  test("a search narrows the tally with the table", async () => {
    const g = await grid({ from: D1, to: D1, q: "990500004" });

    expect(g.total).toBe(1);
    expect(counts(g)).toEqual({ N: 1 });
  });

  test("a day the document has nothing for is empty, not an error", async () => {
    const g = await grid({ from: "1999-07-28", to: "1999-07-28" });

    expect(g.days).toEqual(["1999-07-28"]);
    expect(g.rows).toEqual([]);
    expect(g.total).toBe(0);
    expect(g.summary).toEqual([]);
  });

  test("two days are two columns and one tally over both", async () => {
    const g = await grid({ from: D1, to: D2 });

    expect(g.days).toEqual([D1, D2]);
    // Everything on the first day and the second, and nothing from the third.
    expect(counts(g)).toEqual({ D: 3, N: 3, OFF: 2, CR: 1 });
    expect(g.total).toBe(7);
  });

  /* Independent bounds: the two halves of "the rest of the week" and
     "everything up to the 15th" are the same question from two ends. */
  test("a lone `from` runs to the end of the month", async () => {
    const g = await grid({ from: D2 });

    expect(g.days[0]).toBe(D2);
    expect(g.days).toHaveLength(30);
    expect(counts(g)).toEqual({ N: 1, OFF: 1, AL: 1 });
  });

  test("a lone `to` runs from the start of it", async () => {
    const g = await grid({ to: D1 });

    expect(g.days).toEqual([D1]);
    expect(counts(g)).toEqual({ D: 3, N: 2, OFF: 1, CR: 1 });
  });

  /* Clamped rather than refused. A bound outside a document that holds one
     month can only mean that month's edge, and saying so beats a 400 the
     screen would have to translate. */
  test("bounds outside the month are pulled back to it", async () => {
    const g = await grid({ from: "1999-06-01", to: "1999-08-31" });

    expect(g.days).toHaveLength(31);
    expect(counts(g)).toEqual({ D: 3, N: 3, OFF: 2, CR: 1, AL: 1 });
  });

  test("a `to` before its `from` holds nothing, and says so", async () => {
    const g = await grid({ from: D3, to: D1 });

    expect(g.days).toEqual([]);
    expect(g.rows).toEqual([]);
    expect(g.total).toBe(0);
    expect(g.summary).toEqual([]);
  });
});
