/**
 * Peringkat Operator's route: who may read it, whose points they get, and
 * that a unit-type board sums only that type's shifts.
 *
 * The scope is the thing worth being wrong about, as with the reports: the
 * board carries names, NIKs and a month of attendance, and `admin` and
 * `manajer` read their own department only, whatever the query asks for.
 *
 *   bun --env-file=.env test src/routes/leaderboard.test.ts
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
const tag = `ZZ Peringkat ${uid()}`;
const MAY = "from=1998-05-01&to=1998-05-31";

const made = {
  users: [] as string[],
  roles: [] as string[],
  employees: [] as string[],
  unitTypes: [] as string[],
  companies: [] as string[],
  departments: [] as string[],
  positions: [] as string[],
};

let deptA: string, deptB: string, typeDump: string, typeExca: string;
let adi: string, budi: string, citra: string;
/* `users.nik` is unique: each signed-in person gets their own employee. */
let adiNik: string, budiNik: string;

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
    .values({ slug: `zz-peringkat-${uid()}`, name: tag, scope: opts.scope })
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

let all: string, deptAdmin: string, selfUser: string, noGrant: string;

type Board = {
  from: string;
  to: string;
  department: { id: string; name: string } | null;
  unitTypeId: string | null;
  unitTypes: { id: string; name: string }[];
  rows: {
    rank: number;
    employeeId: string;
    name: string;
    total: number;
    shifts: number;
    operated: number;
    stoodDown: number;
    notReady: number;
    department: string | null;
    penalty: number;
    streak: number;
    attended: number;
    sleepAvgMinutes: number | null;
    units: { code: string; shifts: number }[];
  }[];
};

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();

  const [co] = await db
    .insert(schema.companies)
    .values({ name: `${tag} PT`, code: `ZR${uid()}` })
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
    .values({
      name: `${tag} Operator`,
      departmentId: deptA,
      fleetAllocation: true,
    })
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
      (["Adi", "Budi", "Citra"] as const).map((name, i) => ({
        nik: `98lb${uid()}${i}`,
        name: `${tag} ${name}`,
        companyId: co!.id,
        departmentId: i < 2 ? deptA : deptB,
        positionId: position!.id,
        status: "aktif" as const,
      }))
    )
    .returning({ id: schema.employees.id, nik: schema.employees.nik });
  [adi, budi, citra] = people.map((p) => p.id) as [string, string, string];
  adiNik = people[0]!.nik;
  budiNik = people[1]!.nik;
  made.employees.push(adi, budi, citra);

  const row = (
    employeeId: string,
    departmentId: string,
    date: string,
    unitTypeId: string | null,
    outcome: "operated" | "not-ready" | "stood-down",
    total: number,
    extra: {
      unitCode?: string;
      streak?: number;
      attended?: boolean;
      sleepMinutes?: number | null;
    } = {}
  ) => ({
    date,
    shift: "day" as const,
    employeeId,
    nik: "1",
    name:
      employeeId === adi
        ? `${tag} Adi`
        : employeeId === budi
          ? `${tag} Budi`
          : `${tag} Citra`,
    departmentId,
    unitTypeId,
    unitCode: extra.unitCode ?? null,
    outcome,
    base: outcome === "not-ready" ? -15 : 10,
    onTime: 0,
    sleep: 0,
    streakBonus: 0,
    total,
    streak: extra.streak ?? 1,
    attended: extra.attended ?? true,
    sleepMinutes: extra.sleepMinutes ?? null,
  });
  await db.insert(schema.operatorPoints).values([
    /* Adi drove both types: 15 on dump, 17 on exca — 32 in all. */
    row(adi, deptA, "1998-05-01", typeDump, "operated", 15, {
      unitCode: "DT1",
      sleepMinutes: 400,
    }),
    row(adi, deptA, "1998-05-02", typeExca, "operated", 17, {
      unitCode: "EX1",
      streak: 2,
      sleepMinutes: 300,
    }),
    /* Outside the month: never summed. */
    row(adi, deptA, "1998-06-01", typeDump, "operated", 100),
    /* Not ready against his standing dump: no tap, no reading, run reset. */
    row(budi, deptA, "1998-05-01", typeDump, "not-ready", -15, {
      unitCode: "DT2",
      streak: 0,
      attended: false,
    }),
    row(budi, deptA, "1998-05-02", typeDump, "operated", 15, {
      unitCode: "DT2",
      sleepMinutes: 360,
    }),
    /* A spare's stand-down: no seat, no standing unit, so stored untyped. */
    row(budi, deptA, "1998-05-03", null, "stood-down", 25, {
      streak: 2,
      sleepMinutes: 420,
    }),
    row(citra, deptB, "1998-05-01", typeDump, "operated", 25, {
      unitCode: "DT1",
    }),
  ]);

  all = await makeUser({ scope: "all" });
  deptAdmin = await makeUser({ scope: "dept", nik: adiNik });
  selfUser = await makeUser({ scope: "self", nik: budiNik });
  noGrant = await makeUser({ scope: "all", grant: false });
});

afterAll(async () => {
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

const path = (query: string) => `/leaderboard?${MAY}${query}`;

describe("who may read it", () => {
  test("no session, no grant, and a self-scoped role are all refused", async () => {
    expect((await get(path(""))).status).toBe(401);
    expect((await get(path(""), noGrant)).status).toBe(403);
    expect((await get(path(""), selfUser)).status).toBe(403);
  });

  test("a period that cannot be read is refused before anything is", async () => {
    const status = async (query: string) =>
      (await get(`/leaderboard?${query}`, all)).status;
    expect(await status("from=1998-05-01&to=1998-13-01")).toBe(422);
    /* Postgres has no year 0: refused here rather than a 500 from the query. */
    expect(await status("from=0000-01-01&to=0000-01-31")).toBe(422);
    expect(await status("from=1998-02-30&to=1998-03-05")).toBe(422);
    expect(await status("from=1998-05-31&to=1998-05-01")).toBe(422);
    expect(await status("from=1998-01-01&to=1999-12-31")).toBe(422);
    /* One end alone is not a period. */
    expect(await status("from=1998-05-01")).toBe(422);
  });
});

describe("the site's board", () => {
  test("every unit type summed, ranked by total", async () => {
    const res = await get(path(""), all);
    expect(res.status).toBe(200);
    const board = (await res.json()) as Board;
    const ours = board.rows.filter((r) =>
      made.employees.includes(r.employeeId)
    );
    /* Budi and Citra tie on 25; Budi has two counted shifts to her one. */
    expect(ours.map((r) => [r.name.replace(`${tag} `, ""), r.total])).toEqual([
      ["Adi", 32],
      ["Budi", 25],
      ["Citra", 25],
    ]);
    expect(ours.find((r) => r.employeeId === budi)).toMatchObject({
      shifts: 3,
      operated: 1,
      stoodDown: 1,
      notReady: 1,
    });
    expect(board.department).toBeNull();
    expect(board.unitTypes.map((t) => t.id)).toEqual(
      expect.arrayContaining([typeDump, typeExca])
    );
  });

  test("a unit type's board sums only shifts on that type", async () => {
    const board = (await (
      await get(path(`&unitType=${typeDump}`), all)
    ).json()) as Board;
    const ours = board.rows.filter((r) =>
      made.employees.includes(r.employeeId)
    );
    expect(ours.map((r) => [r.name.replace(`${tag} `, ""), r.total])).toEqual([
      ["Budi", 25],
      ["Citra", 25],
      ["Adi", 15],
    ]);
    expect(board.unitTypeId).toBe(typeDump);
  });

  test("a shift with no unit counts on the type operated most that month", async () => {
    /* Budi's untyped stand-down is on the dump board (above) and nowhere
       else; Adi's exca shift is the exca board's whole answer. */
    const board = (await (
      await get(path(`&unitType=${typeExca}`), all)
    ).json()) as Board;
    const ours = board.rows.filter((r) =>
      made.employees.includes(r.employeeId)
    );
    expect(ours.map((r) => [r.name.replace(`${tag} `, ""), r.total])).toEqual([
      ["Adi", 17],
    ]);
  });

  test("the type operated most counts operated shifts, not not-ready ones", async () => {
    /* July: Citra drove a dump once and was not ready twice against an exca
       she was planned on. Her stand-down is a dump shift, not an exca one. */
    const shift = (
      date: string,
      unitTypeId: string | null,
      outcome: "operated" | "not-ready" | "stood-down",
      total: number
    ) => ({
      date,
      shift: "day" as const,
      employeeId: citra,
      nik: "1",
      name: `${tag} Citra`,
      departmentId: deptB,
      unitTypeId,
      unitCode: null,
      outcome,
      base: total < 0 ? -15 : 10,
      onTime: 0,
      sleep: 0,
      streakBonus: 0,
      total,
      streak: total < 0 ? 0 : 1,
    });
    await db
      .insert(schema.operatorPoints)
      .values([
        shift("1998-07-01", typeDump, "operated", 25),
        shift("1998-07-02", typeExca, "not-ready", -15),
        shift("1998-07-03", typeExca, "not-ready", -15),
        shift("1998-07-04", null, "stood-down", 25),
      ]);
    const july = async (type: string) => {
      const board = (await (
        await get(
          `/leaderboard?from=1998-07-01&to=1998-07-31&unitType=${type}`,
          all
        )
      ).json()) as Board;
      return board.rows.find((r) => r.employeeId === citra);
    };
    expect(await july(typeDump)).toMatchObject({ total: 50, stoodDown: 1 });
    expect(await july(typeExca)).toMatchObject({ total: -30, stoodDown: 0 });
  });
});

describe("the columns", () => {
  const find = async (query: string, employeeId: string) => {
    const board = (await (await get(path(query), all)).json()) as Board;
    return board.rows.find((r) => r.employeeId === employeeId);
  };

  test("the site's board: department, penalty, streak, attendance, sleep", async () => {
    expect(await find("", budi)).toMatchObject({
      department: `${tag} Dept A`,
      shifts: 3,
      operated: 1,
      penalty: -15,
      /* The run his last shift in the period ended on. */
      streak: 2,
      attended: 2,
      /* 360 and 420; the not-ready shift had no reading and is left out. */
      sleepAvgMinutes: 390,
      units: [{ code: "DT2", shifts: 1 }],
    });
    /* No reading at all: no average, rather than zero hours. */
    expect((await find("", citra))?.sleepAvgMinutes).toBeNull();
  });

  test("the units are the ones operated, on this board's type only", async () => {
    expect((await find("", adi))?.units).toEqual([
      { code: "DT1", shifts: 1 },
      { code: "EX1", shifts: 1 },
    ]);
    expect(await find(`&unitType=${typeDump}`, adi)).toMatchObject({
      units: [{ code: "DT1", shifts: 1 }],
      /* Operated on this type, out of every rostered shift he had. */
      operated: 1,
      shifts: 2,
    });
  });

  test("a week reads only its own days", async () => {
    const board = (await (
      await get("/leaderboard?from=1998-05-01&to=1998-05-02", all)
    ).json()) as Board;
    expect(board).toMatchObject({ from: "1998-05-01", to: "1998-05-02" });
    expect(board.rows.find((r) => r.employeeId === budi)).toMatchObject({
      total: 0,
      shifts: 2,
      stoodDown: 0,
      streak: 1,
    });
  });
});

describe("a department-scoped role", () => {
  test("reads its own department only", async () => {
    const res = await get(path(""), deptAdmin);
    expect(res.status).toBe(200);
    const board = (await res.json()) as Board;
    expect(board.department?.id).toBe(deptA);
    expect(board.rows.map((r) => r.employeeId).sort()).toEqual(
      [adi, budi].sort()
    );
  });

  test("asking for another department is refused, not swapped", async () => {
    expect((await get(path(`&department=${deptB}`), deptAdmin)).status).toBe(
      403
    );
  });
});

describe("the department filter", () => {
  test("a department-scoped role is offered its own department only", async () => {
    const res = await get("/leaderboard/departments", deptAdmin);
    expect(res.status).toBe(200);
    const list = (await res.json()) as { id: string }[];
    expect(list.map((d) => d.id)).toEqual([deptA]);
  });

  test("needs the leaderboard grant, not the report one", async () => {
    expect((await get("/leaderboard/departments", noGrant)).status).toBe(403);
    expect((await get("/leaderboard/departments", all)).status).toBe(200);
  });
});
