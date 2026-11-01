/**
 * Peringkat Operator's breakdown: one operator's period shift by shift, the
 * page the board's points open. Who may read it is the board's rule — and
 * the sums are the board's, so the number clicked is the number shown.
 *
 *   bun --env-file=.env test src/routes/leaderboard-breakdown.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { leaderboardRoutes } from "./leaderboard";

const app = new Elysia().use(leaderboardRoutes);
const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Rincian ${uid()}`;
const MAY = "from=1998-05-01&to=1998-05-31";

const made = {
  users: [] as string[],
  roles: [] as string[],
  employees: [] as string[],
  unitTypes: [] as string[],
  companies: [] as string[],
  departments: [] as string[],
  positions: [] as string[],
  documents: [] as string[],
};

let deptA: string, deptB: string, typeDump: string, typeExca: string;
let adi: string, citra: string, adiNik: string, citraNik: string;
/* Settled in Dept A early in May, now in Dept B. */
let dodi: string;
let all: string, deptAdmin: string, selfUser: string, noGrant: string;

type Breakdown = {
  from: string;
  to: string;
  department: { id: string; name: string } | null;
  unitType: { id: string; name: string } | null;
  employee: {
    id: string;
    nik: string;
    name: string;
    department: string | null;
  };
  total: number;
  penalty: number;
  counted: number;
  streak: number;
  unitTypes: { id: string; name: string }[];
  lines: {
    date: string;
    shift: string | null;
    rosterCode: string | null;
    kind: string;
    unitCode: string | null;
    onBoard: boolean;
    total: number;
    running: number;
  }[];
};

const get = (path: string, cookie?: string) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      headers: cookie ? { cookie } : {},
    })
  );

async function makeUser(opts: {
  scope: "all" | "dept" | "self";
  grant?: boolean;
  nik?: string;
}) {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-rincian-${uid()}`, name: tag, scope: opts.scope })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db.insert(schema.rolePermissions).values({
    roleId: role!.id,
    menuSlug: opts.grant === false ? "report" : "leaderboard",
    mode: "view",
  });
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-${uid()}@uji.local`,
      name: tag,
      passwordHash: "x",
      roleId: role!.id,
      nik: opts.nik ?? null,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  return `${SESSION_COOKIE}=${session.id}`;
}

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();

  const [co] = await db
    .insert(schema.companies)
    .values({ name: `${tag} PT`, code: `ZB${uid()}` })
    .returning({ id: schema.companies.id });
  made.companies.push(co!.id);
  const depts = await db
    .insert(schema.departments)
    .values([
      { name: `${tag} Dept A`, companyId: co!.id },
      { name: `${tag} Dept B`, companyId: co!.id },
    ])
    .returning({ id: schema.departments.id });
  [deptA, deptB] = depts.map((d) => d.id) as [string, string];
  made.departments.push(deptA, deptB);
  const [position] = await db
    .insert(schema.positions)
    .values({ name: `${tag} Operator`, departmentId: deptA })
    .returning({ id: schema.positions.id });
  made.positions.push(position!.id);

  const types = await db
    .insert(schema.unitTypes)
    .values([{ name: `${tag} Dump` }, { name: `${tag} Exca` }])
    .returning({ id: schema.unitTypes.id });
  [typeDump, typeExca] = types.map((t) => t.id) as [string, string];
  made.unitTypes.push(typeDump, typeExca);

  const people = await db
    .insert(schema.employees)
    .values(
      (["Adi", "Citra", "Dodi"] as const).map((name, i) => ({
        nik: `98rb${uid()}${i}`,
        name: `${tag} ${name}`,
        companyId: co!.id,
        departmentId: i === 0 ? deptA : deptB,
        positionId: position!.id,
        status: "aktif" as const,
      }))
    )
    .returning({ id: schema.employees.id, nik: schema.employees.nik });
  [adi, citra, dodi] = people.map((p) => p.id) as [string, string, string];
  [adiNik, citraNik] = people.map((p) => p.nik) as [string, string];
  made.employees.push(adi, citra, dodi);

  const shift = (
    employeeId: string,
    departmentId: string,
    date: string,
    unitTypeId: string,
    unitCode: string,
    outcome: "operated" | "not-ready",
    total: number,
    streak: number
  ) => ({
    date,
    shift: "day" as const,
    employeeId,
    nik: employeeId === adi ? adiNik : citraNik,
    name: `${tag} ${employeeId === adi ? "Adi" : employeeId === citra ? "Citra" : "Dodi"}`,
    departmentId,
    unitTypeId,
    unitCode,
    outcome,
    base: outcome === "not-ready" ? -15 : 10,
    onTime: outcome === "operated" ? 2 : 0,
    sleep: outcome === "operated" ? 3 : 0,
    streakBonus: 0,
    total,
    streak,
    attended: outcome === "operated",
  });
  await db
    .insert(schema.operatorPoints)
    .values([
      shift(adi, deptA, "1998-05-01", typeDump, "DT1", "operated", 15, 1),
      shift(adi, deptA, "1998-05-02", typeExca, "EX1", "operated", 17, 2),
      shift(adi, deptA, "1998-05-03", typeDump, "DT1", "not-ready", -15, 0),
      shift(citra, deptB, "1998-05-01", typeDump, "DT9", "operated", 15, 1),
      shift(dodi, deptA, "1998-05-01", typeDump, "DT3", "operated", 15, 1),
    ]);

  /* Adi's May roster, in force; and an archived upload of the same month
     whose CR on the 6th the page must not read. */
  const docs = await db
    .insert(schema.rosterDocuments)
    .values([
      { departmentId: deptA, month: "1998-05-01", fileName: `${tag}.xlsx` },
      {
        departmentId: deptA,
        month: "1998-05-01",
        fileName: `${tag} old.xlsx`,
        status: "arsip",
      },
    ])
    .returning({ id: schema.rosterDocuments.id });
  const [live, archived] = docs.map((d) => d.id) as [string, string];
  made.documents.push(live, archived);
  await db.insert(schema.rosterDays).values([
    { documentId: live, employeeId: adi, date: "1998-05-01", code: "D" },
    { documentId: live, employeeId: adi, date: "1998-05-02", code: "D" },
    { documentId: live, employeeId: adi, date: "1998-05-03", code: "D" },
    { documentId: live, employeeId: adi, date: "1998-05-04", code: "OFF" },
    { documentId: live, employeeId: adi, date: "1998-05-05", code: "N" },
    { documentId: archived, employeeId: adi, date: "1998-05-06", code: "CR" },
    /* Dept A's document still carries Dodi after he moved to Dept B. */
    { documentId: live, employeeId: dodi, date: "1998-05-01", code: "D" },
    { documentId: live, employeeId: dodi, date: "1998-05-10", code: "SICK" },
  ]);

  all = await makeUser({ scope: "all" });
  deptAdmin = await makeUser({ scope: "dept", nik: adiNik });
  selfUser = await makeUser({ scope: "self", nik: citraNik });
  noGrant = await makeUser({ scope: "all", grant: false });
});

afterAll(async () => {
  await db
    .delete(schema.rosterDocuments)
    .where(inArray(schema.rosterDocuments.id, made.documents));
  await db
    .delete(schema.operatorPoints)
    .where(inArray(schema.operatorPoints.employeeId, made.employees));
  await db
    .delete(schema.employees)
    .where(inArray(schema.employees.id, made.employees));
  await db
    .delete(schema.unitTypes)
    .where(inArray(schema.unitTypes.id, made.unitTypes));
  await db
    .delete(schema.positions)
    .where(inArray(schema.positions.id, made.positions));
  await db
    .delete(schema.departments)
    .where(inArray(schema.departments.id, made.departments));
  await db
    .delete(schema.companies)
    .where(inArray(schema.companies.id, made.companies));
  await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  for (const id of made.roles)
    await db.delete(schema.roles).where(eq(schema.roles.id, id));
  redis.disconnect();
});

const path = (employeeId: string, query = "") =>
  `/leaderboard/operators/${employeeId}?${MAY}${query}`;

const read = async (url: string, cookie: string) =>
  (await (await get(url, cookie)).json()) as Breakdown;

describe("who may read it", () => {
  test("no session, no grant, and a self-scoped role are all refused", async () => {
    expect((await get(path(adi))).status).toBe(401);
    expect((await get(path(adi), noGrant)).status).toBe(403);
    expect((await get(path(adi), selfUser)).status).toBe(403);
  });

  test("a period that cannot be read is refused", async () => {
    const status = async (query: string) =>
      (await get(`/leaderboard/operators/${adi}?${query}`, all)).status;
    expect(await status("from=1998-05-31&to=1998-05-01")).toBe(422);
    expect(await status("from=1998-01-01&to=1999-12-31")).toBe(422);
    expect(await status("from=1998-05-01")).toBe(422);
  });

  test("somebody with no settled shift in the period is not found", async () => {
    expect(
      (
        await get(
          `/leaderboard/operators/${adi}?from=1998-08-01&to=1998-08-31`,
          all
        )
      ).status
    ).toBe(404);
    expect((await get(path(crypto.randomUUID()), all)).status).toBe(404);
  });
});

describe("the site's board", () => {
  test("every shift, with the roster days the ledger has none for", async () => {
    const res = await get(path(adi), all);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Breakdown;
    expect(body.employee).toMatchObject({
      id: adi,
      nik: adiNik,
      name: `${tag} Adi`,
      department: `${tag} Dept A`,
    });
    expect(
      body.lines.map((l) => [l.date, l.kind, l.rosterCode, l.running])
    ).toEqual([
      ["1998-05-01", "operated", null, 15],
      ["1998-05-02", "operated", null, 32],
      ["1998-05-03", "not-ready", null, 17],
      ["1998-05-04", "off-roster", "OFF", 17],
      ["1998-05-05", "unsettled", "N", 17],
    ]);
    /* The same figures as the board's row for him. */
    expect(body).toMatchObject({
      total: 17,
      penalty: -15,
      counted: 2,
      streak: 0,
      unitType: null,
    });
    expect(body.unitTypes.map((t) => t.id).sort()).toEqual(
      [typeDump, typeExca].sort()
    );
  });
});

describe("a unit type's board", () => {
  test("only that type's shifts are summed; the others are listed, not counted", async () => {
    const body = await read(path(adi, `&unitType=${typeDump}`), all);
    expect(body.unitType).toEqual({ id: typeDump, name: `${tag} Dump` });
    expect(body).toMatchObject({ total: 0, penalty: -15, counted: 1 });
    expect(
      body.lines
        .filter((l) => l.rosterCode === null)
        .map((l) => [l.unitCode, l.onBoard])
    ).toEqual([
      ["DT1", true],
      ["EX1", false],
      ["DT1", true],
    ]);
  });
});

describe("a department-scoped role", () => {
  test("reads somebody of its own department", async () => {
    const body = await read(path(adi), deptAdmin);
    expect(body.department?.id).toBe(deptA);
    expect(body.total).toBe(17);
  });

  test("somebody of another department is not found, rather than refused", async () => {
    expect((await get(path(citra), deptAdmin)).status).toBe(404);
  });

  test("somebody who has left it: its roster stops at their last shift there", async () => {
    const own = await read(path(dodi), deptAdmin);
    expect(own.lines.map((l) => l.date)).toEqual(["1998-05-01"]);
    /* A site-wide role reads the document as it stands. */
    const site = await read(path(dodi), all);
    expect(site.lines.map((l) => [l.date, l.rosterCode])).toEqual([
      ["1998-05-01", null],
      ["1998-05-10", "SICK"],
    ]);
  });

  test("asking for another department is refused", async () => {
    expect(
      (await get(path(adi, `&department=${deptB}`), deptAdmin)).status
    ).toBe(403);
  });
});
