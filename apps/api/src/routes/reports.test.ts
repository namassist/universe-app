/**
 * The Report menu's routes: who may read a report, whose rows they get, and
 * that the rows are the board's.
 *
 * What is worth being wrong about here is the scope. The reports carry names,
 * NIKs and FTW verdicts for a whole shift, and an `admin` or `manajer` reads
 * them for their own department only — decided on the server, whatever the
 * query string asks for.
 *
 *   bun --env-file=.env test src/routes/reports.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import ExcelJS from "exceljs";
import { Elysia } from "elysia";
import { eq, inArray } from "drizzle-orm";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { reportRoutes } from "./reports";

const app = new Elysia().use(reportRoutes);
const uid = () => crypto.randomUUID().slice(0, 8);
/** Digits only: a NIK is joined to savera's readings by its digits. */
const digits = () => String(Math.floor(Math.random() * 1e4)).padStart(4, "0");
const tag = `ZZ Laporan ${uid()}`;
/** A date nothing else in the database is rostered on. */
const DATE = "1998-03-03";
/** A date with a roster and no board. */
const NO_BOARD_DATE = "1998-03-04";

const made = {
  users: [] as string[],
  roles: [] as string[],
  units: [] as string[],
  employees: [] as string[],
  cat: [] as {
    table: "unitClasses" | "unitTypes" | "unitModels" | "unitBrands";
    id: string;
  }[],
  companies: [] as string[],
  departments: [] as string[],
  positions: [] as string[],
  docs: [] as string[],
  rosterDocs: [] as string[],
  simperCodes: [] as string[],
};

let deptA: string, deptB: string;
let nikPlaced: string, nikLeftA: string, nikLeftB: string;
/** Spares the board left seatless whose SIMPERs reach only units that ask no
    FTW, or reach both kinds (owner, 2026-10-06). */
let nikDozerOnly: string, nikBoth: string;
let unitPlaced: string,
  unitEmptyA: string,
  unitEmptyB: string,
  unitGlobal: string;

const get = (path: string, cookie?: string) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      headers: cookie ? { cookie } : {},
    })
  );

async function makeUser(opts: {
  scope: "all" | "dept" | "self";
  menuSlug?: "report" | "fleet-allocation";
  nik?: string;
}) {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-laporan-${uid()}`, name: tag, scope: opts.scope })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values([
      { roleId: role!.id, menuSlug: opts.menuSlug ?? "report", mode: "view" },
    ]);
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

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();

  const [co] = await db
    .insert(schema.companies)
    .values({ name: `${tag} PT`, code: `ZL${uid()}` })
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
  const positions = await db
    .insert(schema.positions)
    .values([
      { name: `${tag} Operator`, departmentId: deptA, fleetAllocation: true },
      { name: `${tag} Operator`, departmentId: deptB, fleetAllocation: true },
    ])
    .returning({ id: schema.positions.id });
  made.positions.push(...positions.map((p) => p.id));
  const [posA, posB] = positions.map((p) => p.id) as [string, string];

  const [cl] = await db
    .insert(schema.unitClasses)
    .values({ name: `${tag} K` })
    .returning({ id: schema.unitClasses.id });
  const [ty] = await db
    .insert(schema.unitTypes)
    .values({ name: `${tag} T` })
    .returning({ id: schema.unitTypes.id });
  const [mo] = await db
    .insert(schema.unitModels)
    .values({ name: `${tag} M` })
    .returning({ id: schema.unitModels.id });
  const [br] = await db
    .insert(schema.unitBrands)
    .values({ name: `${tag} B` })
    .returning({ id: schema.unitBrands.id });
  made.cat.push(
    { table: "unitClasses", id: cl!.id },
    { table: "unitTypes", id: ty!.id },
    { table: "unitModels", id: mo!.id },
    { table: "unitBrands", id: br!.id }
  );
  const catalogue = {
    classId: cl!.id,
    typeId: ty!.id,
    modelId: mo!.id,
    brandId: br!.id,
  };
  const units = await db
    .insert(schema.units)
    .values([
      { ...catalogue, code: `${tag}-P`, departmentId: deptA },
      { ...catalogue, code: `${tag}-EA`, departmentId: deptA },
      { ...catalogue, code: `${tag}-EB`, departmentId: deptB },
      { ...catalogue, code: `${tag}-G` },
    ])
    .returning({ id: schema.units.id });
  [unitPlaced, unitEmptyA, unitEmptyB, unitGlobal] = units.map((u) => u.id) as [
    string,
    string,
    string,
    string,
  ];
  made.units.push(...units.map((u) => u.id));

  /* Department B's empty seat asks for FTW; the site's own does not — a
     dozer, say. Each wants its own SIMPER code. */
  const codes = await db
    .insert(schema.simperCodes)
    .values([{ name: `${tag} OHT` }, { name: `${tag} DZ` }])
    .returning({ id: schema.simperCodes.id });
  const [codeFtw, codeNoFtw] = codes.map((c) => c.id) as [string, string];
  made.simperCodes.push(codeFtw, codeNoFtw);
  await db
    .update(schema.units)
    .set({ ftw: true, simperCodeId: codeFtw })
    .where(eq(schema.units.id, unitEmptyB));
  await db
    .update(schema.units)
    .set({ ftw: false, simperCodeId: codeNoFtw })
    .where(eq(schema.units.id, unitGlobal));

  nikPlaced = `9881${digits()}`;
  nikLeftA = `9882${digits()}`;
  nikLeftB = `9883${digits()}`;
  nikDozerOnly = `9884${digits()}`;
  nikBoth = `9885${digits()}`;
  const people = await db
    .insert(schema.employees)
    .values([
      {
        nik: nikPlaced,
        name: `${tag} Placed`,
        companyId: co!.id,
        departmentId: deptA,
        positionId: posA,
      },
      {
        nik: nikLeftA,
        name: `${tag} Left A`,
        companyId: co!.id,
        departmentId: deptA,
        positionId: posA,
      },
      {
        nik: nikLeftB,
        name: `${tag} Left B`,
        companyId: co!.id,
        departmentId: deptB,
        positionId: posB,
      },
      {
        nik: nikDozerOnly,
        name: `${tag} Dozer Only`,
        companyId: co!.id,
        departmentId: deptA,
        positionId: posA,
      },
      {
        nik: nikBoth,
        name: `${tag} Both`,
        companyId: co!.id,
        departmentId: deptA,
        positionId: posA,
      },
    ])
    .returning({ id: schema.employees.id });
  made.employees.push(...people.map((p) => p.id));
  const [opPlaced, opLeftA, opLeftB, opDozerOnly, opBoth] = people.map(
    (p) => p.id
  ) as [string, string, string, string, string];
  await db.insert(schema.employeeSkills).values([
    /* The two left without a seat can reach an FTW seat, so the No FTW
       report holds them to it. */
    { employeeId: opLeftA, simperCodeId: codeFtw },
    { employeeId: opLeftB, simperCodeId: codeFtw },
    { employeeId: opDozerOnly, simperCodeId: codeNoFtw },
    { employeeId: opBoth, simperCodeId: codeFtw },
    { employeeId: opBoth, simperCodeId: codeNoFtw },
  ]);

  all = await makeUser({ scope: "all" });
  deptAdmin = await makeUser({ scope: "dept", nik: nikLeftA });
  selfUser = await makeUser({ scope: "self", nik: nikLeftB });
  noGrant = await makeUser({ scope: "all", menuSlug: "fleet-allocation" });

  const rosterDocs = await db
    .insert(schema.rosterDocuments)
    .values(
      [deptA, deptB].map((departmentId) => ({
        departmentId,
        month: `${DATE.slice(0, 7)}-01`,
        fileName: `${tag}.xlsx`,
        uploadedBy: made.users[0]!,
      }))
    )
    .returning({
      id: schema.rosterDocuments.id,
      departmentId: schema.rosterDocuments.departmentId,
    });
  made.rosterDocs.push(...rosterDocs.map((d) => d.id));
  const docOf = (dept: string) =>
    rosterDocs.find((d) => d.departmentId === dept)!.id;
  await db.insert(schema.rosterDays).values(
    [DATE, NO_BOARD_DATE].flatMap((date) => [
      {
        documentId: docOf(deptA),
        employeeId: opPlaced,
        date,
        code: "D" as const,
      },
      {
        documentId: docOf(deptA),
        employeeId: opLeftA,
        date,
        code: "D" as const,
      },
      {
        documentId: docOf(deptB),
        employeeId: opLeftB,
        date,
        code: "D" as const,
      },
      {
        documentId: docOf(deptA),
        employeeId: opDozerOnly,
        date,
        code: "D" as const,
      },
      {
        documentId: docOf(deptA),
        employeeId: opBoth,
        date,
        code: "D" as const,
      },
    ])
  );

  await db.insert(schema.ftwReadings).values({
    nik: nikLeftA,
    date: DATE,
    name: `${tag} Left A`,
    ftwDecision: "FTW Perlu Tindak Lanjut",
    sleepCategory: "Tidak Boleh Bekerja",
  });

  const [doc] = await db
    .insert(schema.fleetActualDocuments)
    .values({ date: DATE, shift: "day" })
    .returning({ id: schema.fleetActualDocuments.id });
  made.docs.push(doc!.id);
  await db.insert(schema.fleetActualSlots).values([
    {
      documentId: doc!.id,
      unitId: unitPlaced,
      employeeId: opPlaced,
      source: "plan",
      transportCode: "UD BU 09",
      workArea: "KASTURI - KOLAM",
    },
    { documentId: doc!.id, unitId: unitEmptyA, employeeId: null, source: null },
    { documentId: doc!.id, unitId: unitEmptyB, employeeId: null, source: null },
    { documentId: doc!.id, unitId: unitGlobal, employeeId: null, source: null },
  ]);
});

afterAll(async () => {
  await db
    .delete(schema.ftwReadings)
    .where(inArray(schema.ftwReadings.nik, [nikPlaced, nikLeftA, nikLeftB]));
  if (made.docs.length)
    await db
      .delete(schema.fleetActualDocuments)
      .where(inArray(schema.fleetActualDocuments.id, made.docs));
  if (made.rosterDocs.length)
    await db
      .delete(schema.rosterDocuments)
      .where(inArray(schema.rosterDocuments.id, made.rosterDocs));
  if (made.employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
  if (made.units.length)
    await db.delete(schema.units).where(inArray(schema.units.id, made.units));
  if (made.simperCodes.length)
    await db
      .delete(schema.simperCodes)
      .where(inArray(schema.simperCodes.id, made.simperCodes));
  for (const c of made.cat)
    await db.delete(schema[c.table]).where(eq(schema[c.table].id, c.id));
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
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
  redis.disconnect();
});

type Report = {
  kind: string;
  date: string;
  shift: string;
  department: { id: string; name: string } | null;
  boardGenerated: boolean;
  rows: Record<string, string>[];
};

const read = async (res: Response) => (await res.json()) as Report;

describe("who may read a report", () => {
  test("no session is 401, and a role without the grant is 403", async () => {
    const path = `/reports/final-validation?date=${DATE}&shift=day`;
    expect((await get(path)).status).toBe(401);
    expect((await get(path, noGrant)).status).toBe(403);
    expect((await get("/reports/departments", noGrant)).status).toBe(403);
  });

  test("an unknown report or a malformed date is refused, not guessed", async () => {
    expect(
      (await get(`/reports/nope?date=${DATE}&shift=day`, all)).status
    ).toBe(422);
    expect(
      (await get(`/reports/final-validation?date=03-03-1998&shift=day`, all))
        .status
    ).toBe(422);
  });

  test("a self-scoped role reads nobody's report", async () => {
    const res = await get(
      `/reports/final-validation?date=${DATE}&shift=day`,
      selfUser
    );
    expect(res.status).toBe(403);
  });
});

describe("a department-scoped role", () => {
  test("is narrowed to its own department without asking", async () => {
    const res = await get(
      `/reports/equipment-no-operator?date=${DATE}&shift=day`,
      deptAdmin
    );
    expect(res.status).toBe(200);
    const body = await read(res);
    expect(body.department?.id).toBe(deptA);
    expect(body.rows.map((r) => r.unit)).toEqual([`${tag}-EA`]);
  });

  test("cannot ask for another department's", async () => {
    const res = await get(
      `/reports/equipment-no-operator?date=${DATE}&shift=day&department=${deptB}`,
      deptAdmin
    );
    expect(res.status).toBe(403);
  });

  test("the export is narrowed the same way", async () => {
    const res = await get(
      `/reports/equipment-no-operator/export?date=${DATE}&shift=day&department=${deptB}`,
      deptAdmin
    );
    expect(res.status).toBe(403);
  });

  test("reads only its own department's people on every person report", async () => {
    for (const kind of [
      "final-validation",
      "operator-no-equipment",
      "operator-no-ftw",
      "operator-no-finger",
    ]) {
      const res = await get(
        `/reports/${kind}?date=${DATE}&shift=day`,
        deptAdmin
      );
      if (res.status === 422) return; // no deadline configured for the shift
      const body = await read(res);
      expect(body.department?.id).toBe(deptA);
      expect(body.rows.map((r) => r.nik)).not.toContain(nikLeftB);
      expect(body.rows.every((r) => r.department === `${tag} Dept A`)).toBe(
        true
      );
    }
  });

  test("is offered its own department and no other", async () => {
    const res = await get("/reports/departments", deptAdmin);
    const list = (await res.json()) as { id: string }[];
    expect(list.map((d) => d.id)).toEqual([deptA]);
  });
});

describe("Equipment No Operator", () => {
  test("lists every empty seat on the board, including the site's own", async () => {
    const body = await read(
      await get(`/reports/equipment-no-operator?date=${DATE}&shift=day`, all)
    );
    expect(body.boardGenerated).toBe(true);
    const mine = body.rows.map((r) => r.unit).filter((u) => u?.startsWith(tag));
    expect(mine.sort()).toEqual([`${tag}-EA`, `${tag}-EB`, `${tag}-G`].sort());
  });

  test("says so when the board was never built", async () => {
    const body = await read(
      await get(
        `/reports/equipment-no-operator?date=${NO_BOARD_DATE}&shift=day`,
        all
      )
    );
    expect(body.boardGenerated).toBe(false);
    expect(body.rows).toEqual([]);
  });
});

describe("the person reports", () => {
  /* The finger and FTW rules need the timeline's deadlines; a database
     without them answers 422, which the route states rather than guessing. */
  const person = async (kind: string, query = "") => {
    const res = await get(
      `/reports/${kind}?date=${DATE}&shift=day${query}`,
      all
    );
    if (res.status === 422) return null;
    expect(res.status).toBe(200);
    return read(res);
  };

  test("Final Validation names the seat, or SPARE", async () => {
    const body = await person("final-validation", `&department=${deptA}`);
    if (!body) return;
    expect(body.department).toEqual({ id: deptA, name: `${tag} Dept A` });
    const byNik = new Map(body.rows.map((r) => [r.nik, r]));
    expect(byNik.get(nikPlaced)).toMatchObject({
      unit: `${tag}-P`,
      bus: "UD BU 09",
      location: "KASTURI - KOLAM",
      department: `${tag} Dept A`,
    });
    expect(byNik.get(nikLeftA)).toMatchObject({ unit: "SPARE", bus: "" });
    /* Department B's operator is not on department A's sheet. */
    expect(byNik.has(nikLeftB)).toBe(false);
  });

  /* Nobody in these fixtures tapped in: the unplaced are the No Finger
     report's, not this one's (owner, 2026-10-07). The rule's other halves
     are proven case by case in reports.test.ts. */
  test("Operator No Equipment leaves out whoever never tapped in", async () => {
    const body = await person("operator-no-equipment");
    if (!body) return;
    const niks = body.rows.map((r) => r.nik);
    expect(niks).not.toContain(nikLeftA);
    expect(niks).not.toContain(nikLeftB);
    expect(niks).not.toContain(nikPlaced);
    const noFinger = await person("operator-no-finger");
    const absent = noFinger!.rows.map((r) => r.nik);
    expect(absent).toContain(nikLeftA);
    expect(absent).toContain(nikLeftB);
  });

  test("Operator No FTW prints savera's category, or Belum FTW", async () => {
    const body = await person("operator-no-ftw");
    if (!body) return;
    const status = new Map(body.rows.map((r) => [r.nik, r.saveraStatus]));
    expect(status.get(nikLeftA)).toBe("Tidak Boleh Bekerja");
    expect(status.get(nikLeftB)).toBe("Belum FTW");
  });

  /*
   * The trial of 2026-10-05: dozer and small-exca spares the board left
   * seatless were listed "Belum FTW", though no seat they could fill asks for
   * FTW — the engine never held it against them. With no seat and no
   * standing unit, FTW applies only if a unit they hold a SIMPER for asks
   * for it (owner, 2026-10-06).
   */
  test("Operator No FTW leaves out a spare whose every unit asks no FTW", async () => {
    const body = await person("operator-no-ftw");
    if (!body) return;
    const niks = body.rows.map((r) => r.nik);
    expect(niks).not.toContain(nikDozerOnly);
    /* One FTW seat within reach is enough: FTW is what kept him off it. */
    expect(niks).toContain(nikBoth);
  });

  test("…and on a date with no board, by the units in service", async () => {
    const res = await get(
      `/reports/operator-no-ftw?date=${NO_BOARD_DATE}&shift=day`,
      all
    );
    if (res.status === 422) return;
    const niks = (await read(res)).rows.map((r) => r.nik);
    expect(niks).not.toContain(nikDozerOnly);
    expect(niks).toContain(nikBoth);
  });

  test("Operator No Finger reads No Finger for nobody tapping", async () => {
    const body = await person("operator-no-finger");
    if (!body) return;
    const mine = body.rows.filter((r) =>
      [nikPlaced, nikLeftA, nikLeftB].includes(r.nik!)
    );
    expect(mine).toHaveLength(3);
    expect(new Set(mine.map((r) => r.jamIn))).toEqual(new Set(["No Finger"]));
    expect(mine[0]).toMatchObject({ roster: "D" });
  });
});

describe("the export", () => {
  test("is the report as a workbook, named for what it holds", async () => {
    const res = await get(
      `/reports/equipment-no-operator/export?date=${DATE}&shift=day&department=${deptA}`,
      all
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="equipment-no-operator-${DATE}-siang.xlsx"`
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const ws = wb.worksheets[0]!;
    expect(ws.getCell("A1").value).toBe("EQUIPMENT NO OPERATOR REPORT");
    expect(ws.getCell("C5").value).toBe(`${tag} Dept A`);
    expect(ws.getCell("B7").value).toBe(`${tag}-EA`);
    expect(ws.getCell("B8").value).toBeNull();
  });
});
