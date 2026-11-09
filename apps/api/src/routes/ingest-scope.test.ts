/**
 * The FTW and attendance lists answer only for the people the caller may
 * see. Both used to return every row to anyone holding the menu: the `user`
 * role, `self`-scoped, read the whole site's sleep and taps, and the
 * `dept`-scoped roles every department's. Harmless-looking on a LAN; not once
 * the login is reachable from the internet and every employee can claim an
 * account.
 *
 *   bun --env-file=.env test src/routes/ingest-scope.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { inArray } from "drizzle-orm";
import ExcelJS from "exceljs";
import type { Scope } from "@universe/contracts";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { attendanceSyncRoutes, fitToWorkSyncRoutes } from "./ingest-sync";

const app = new Elysia().use(fitToWorkSyncRoutes).use(attendanceSyncRoutes);

/** A date no source will emit again. */
const DAY = "1998-02-03";
const MONTH = "1998-02-01";

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji Scope ${uid()}`;
/** NIKs in a range no real register uses. */
const ME = "99070001";
const COLLEAGUE = "99070002";
const OTHER_DEPT = "99070003";
/** The dept caller's own record: in department A, with nothing filed. */
const ADMIN = "99070004";
const ALL = [ME, COLLEAGUE, OTHER_DEPT];

const made = {
  companies: [] as string[],
  departments: [] as string[],
  positions: [] as string[],
  employees: [] as string[],
  documents: [] as string[],
  users: [] as string[],
  roles: [] as string[],
  masters: [] as {
    table: "unitClasses" | "unitTypes" | "unitModels" | "unitBrands";
    id: string;
  }[],
  simperCode: "",
  unit: "",
};

/** One account per scope and NIK: an account's NIK is unique. Each holds
 *  its own role, so the scope is the only thing that differs. */
const callers = new Map<string, Promise<string>>();
function caller(scope: Scope, nik: string | null): Promise<string> {
  const key = `${scope}|${nik}`;
  if (!callers.has(key)) callers.set(key, makeCaller(scope, nik));
  return callers.get(key)!;
}

async function makeCaller(scope: Scope, nik: string | null) {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-scope-${uid()}`, name: tag, scope })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db.insert(schema.rolePermissions).values([
    { roleId: role!.id, menuSlug: "fit-to-work", mode: "view" },
    { roleId: role!.id, menuSlug: "attendance", mode: "view" },
  ]);
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `zz-${uid()}@uji.local`,
      nik,
      name: tag,
      passwordHash: "x",
      roleId: role!.id,
      mustChangePassword: false,
    })
    .returning({ id: schema.users.id });
  made.users.push(user!.id);
  const session = await createSession("user", user!.id, "cookie");
  return `${SESSION_COOKIE}=${session.id}`;
}

const get = (path: string, cookie: string) =>
  app.handle(new Request(`http://localhost${path}`, { headers: { cookie } }));

const ours = (niks: Iterable<string>) =>
  [...new Set(niks)].filter((nik) => ALL.includes(nik)).sort();

async function niksIn(path: string, cookie: string): Promise<string[]> {
  const res = await get(path, cookie);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { rows: { nik: string }[] };
  return ours(body.rows.map((r) => r.nik));
}

/** Every cell of the workbook that is one of the fixture's NIKs. */
async function niksInWorkbook(path: string, cookie: string) {
  const res = await get(path, cookie);
  expect(res.status).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  const cells: string[] = [];
  wb.eachSheet((sheet) =>
    sheet.eachRow((row) =>
      row.eachCell((cell) => cells.push(String(cell.value ?? "")))
    )
  );
  return ours(cells);
}

const ftwList = `/fit-to-work/?from=${DAY}&to=${DAY}`;
const attendanceList = `/attendance/?from=${DAY}&to=${DAY}`;

beforeAll(async () => {
  const [company] = await db
    .insert(schema.companies)
    .values({ name: `${tag} PT`, code: `ZS${uid().slice(0, 4)}` })
    .returning({ id: schema.companies.id });
  made.companies.push(company!.id);

  const departments = await db
    .insert(schema.departments)
    .values([
      { name: `${tag} A`, companyId: company!.id },
      { name: `${tag} B`, companyId: company!.id },
    ])
    .returning({ id: schema.departments.id });
  made.departments.push(...departments.map((d) => d.id));

  const positions = await db
    .insert(schema.positions)
    .values(
      departments.map((d) => ({
        name: `${tag} Operator`,
        departmentId: d.id,
        fleetAllocation: true,
      }))
    )
    .returning({ id: schema.positions.id });
  made.positions.push(...positions.map((p) => p.id));

  const place = (i: 0 | 1) => ({
    companyId: company!.id,
    departmentId: departments[i]!.id,
    positionId: positions[i]!.id,
  });
  const employees = await db
    .insert(schema.employees)
    .values([
      { nik: ME, name: `${tag} me`, status: "aktif", ...place(0) },
      {
        nik: COLLEAGUE,
        name: `${tag} colleague`,
        status: "aktif",
        ...place(0),
      },
      { nik: OTHER_DEPT, name: `${tag} other`, status: "aktif", ...place(1) },
      { nik: ADMIN, name: `${tag} admin`, status: "aktif", ...place(0) },
    ])
    .returning({ id: schema.employees.id, nik: schema.employees.nik });
  made.employees.push(...employees.map((e) => e.id));

  /* An unfiled row is only for somebody FTW is asked of: a SIMPER code that
     some FTW unit wants (`ftw-obliged.ts`). All three hold one. */
  const master = async (
    table: "unitClasses" | "unitTypes" | "unitModels" | "unitBrands"
  ) => {
    const [row] = await db
      .insert(schema[table])
      .values({ name: `${tag} ${table}` })
      .returning({ id: schema[table].id });
    made.masters.push({ table, id: row!.id });
    return row!.id;
  };
  const [code] = await db
    .insert(schema.simperCodes)
    .values({ name: `${tag} A2B` })
    .returning({ id: schema.simperCodes.id });
  made.simperCode = code!.id;
  const [unit] = await db
    .insert(schema.units)
    .values({
      code: `ZZS-${uid()}`,
      classId: await master("unitClasses"),
      typeId: await master("unitTypes"),
      modelId: await master("unitModels"),
      brandId: await master("unitBrands"),
      simperCodeId: code!.id,
      ftw: true,
    })
    .returning({ id: schema.units.id });
  made.unit = unit!.id;
  await db
    .insert(schema.employeeSkills)
    .values(
      employees
        .filter((e) => ALL.includes(e.nik))
        .map((e) => ({ employeeId: e.id, simperCodeId: code!.id }))
    );

  /* Rostered on the day, so each also appears as an attendance row and, for
     the one who files nothing, as an unfiled FTW row. */
  const documents = await db
    .insert(schema.rosterDocuments)
    .values(
      departments.map((d) => ({
        departmentId: d.id,
        month: MONTH,
        fileName: `${tag}.xlsx`,
      }))
    )
    .returning({ id: schema.rosterDocuments.id });
  made.documents.push(...documents.map((d) => d.id));
  await db.insert(schema.rosterDays).values(
    employees
      .filter((e) => ALL.includes(e.nik))
      .map((e) => ({
        documentId: documents[e.nik === OTHER_DEPT ? 1 : 0]!.id,
        employeeId: e.id,
        date: DAY,
        code: "D" as const,
      }))
  );

  /* An upload for two of them; the third is unfiled. */
  await db.insert(schema.ftwReadings).values(
    [ME, OTHER_DEPT].map((nik) => ({
      nik,
      date: DAY,
      name: `${tag} ${nik}`,
      sleepMinutes: 420,
      sleepCategory: "Dapat Bekerja",
      ftwDecision: "FTW aman",
      sentAt: `${DAY} 04:10:00`,
    }))
  );
  await db
    .insert(schema.fingerReadings)
    .values(
      ALL.map((nik) => ({ nik, date: DAY, firstInAt: `${DAY} 05:01:00` }))
    );
});

afterAll(async () => {
  await db
    .delete(schema.ftwReadings)
    .where(inArray(schema.ftwReadings.nik, ALL));
  await db
    .delete(schema.fingerReadings)
    .where(inArray(schema.fingerReadings.nik, ALL));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
  if (made.documents.length)
    await db
      .delete(schema.rosterDocuments)
      .where(inArray(schema.rosterDocuments.id, made.documents));
  if (made.employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
  /* After the employees, whose skills hold the code. */
  if (made.unit)
    await db.delete(schema.units).where(inArray(schema.units.id, [made.unit]));
  if (made.simperCode)
    await db
      .delete(schema.simperCodes)
      .where(inArray(schema.simperCodes.id, [made.simperCode]));
  for (const { table, id } of made.masters)
    await db.delete(schema[table]).where(inArray(schema[table].id, [id]));
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

describe("a self-scoped caller", () => {
  test("reads only their own FTW, filed or not", async () => {
    expect(await niksIn(ftwList, await caller("self", ME))).toEqual([ME]);
    // Unfiled: still their own row, and only theirs.
    expect(await niksIn(ftwList, await caller("self", COLLEAGUE))).toEqual([
      COLLEAGUE,
    ]);
  });

  test("reads only their own attendance", async () => {
    expect(await niksIn(attendanceList, await caller("self", ME))).toEqual([
      ME,
    ]);
  });

  test("the exports hold to the same rows", async () => {
    const me = await caller("self", ME);
    expect(
      await niksInWorkbook(`/fit-to-work/export?from=${DAY}&to=${DAY}`, me)
    ).toEqual([ME]);
    expect(
      await niksInWorkbook(`/attendance/export?from=${DAY}&to=${DAY}`, me)
    ).toEqual([ME]);
  });

  test("without a NIK, sees nothing rather than everything", async () => {
    const nobody = await caller("self", null);
    expect(await niksIn(ftwList, nobody)).toEqual([]);
    expect(await niksIn(attendanceList, nobody)).toEqual([]);
  });
});

describe("a dept-scoped caller", () => {
  test("reads their own department, not the other", async () => {
    const admin = await caller("dept", ADMIN);
    expect(await niksIn(ftwList, admin)).toEqual([ME, COLLEAGUE]);
    expect(await niksIn(attendanceList, admin)).toEqual([ME, COLLEAGUE]);
  });
});

describe("an all-scoped caller", () => {
  test("reads everyone, as before", async () => {
    const manpower = await caller("all", null);
    expect(await niksIn(ftwList, manpower)).toEqual(ALL);
    expect(await niksIn(attendanceList, manpower)).toEqual(ALL);
  });
});
