/**
 * The dashboard's operator ratio and equipment panel, against a fixture of
 * its own on a date nothing else uses.
 *
 * The trial of 2026-10-09: 61 operators who tapped in had no FTW reading —
 * diggers, dozers and small excavators, whose units ask for none — and fell
 * out of all three buckets, so whole categories read empty. Every operator
 * the shift has must land in exactly one bucket, with "FTW required" read by
 * the same rule as the FTW cards (`ftw-obliged.ts`). A standby employee — an
 * induction hold, as Jusman was that night — is not on the ratio at all, as
 * the engine gives them no unit.
 *
 * Needs the dev Postgres:
 *   bun --env-file=.env test src/routes/dashboard-analytics.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";

import { db, schema } from "../db";
import { dashboardAnalytics } from "./dashboard-analytics";

const DATE = "1997-05-07";
const MONTH = "1997-05-01";
const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Rasio ${uid()}`;
const FTW_TYPE = `${tag} FTW`;
const FREE_TYPE = `${tag} BEBAS`;
const nikOf = () =>
  `96${Math.floor(Math.random() * 1e7)
    .toString()
    .padStart(7, "0")}`;

const made = {
  employees: [] as string[],
  units: [] as string[],
  types: [] as string[],
  classes: [] as string[],
  models: [] as string[],
  brands: [] as string[],
  codes: [] as string[],
  docs: [] as string[],
  positions: [] as string[],
  departments: [] as string[],
  companies: [] as string[],
  niks: [] as string[],
};

let companyId = "";
let departmentId = "";
let positionId = "";
let docId = "";
let codeFtw = "";
let codeFree = "";
let unitFtw = "";
let unitFree = "";

async function person(options: {
  unit?: string;
  skill: string;
  tapped: boolean;
  ftw?: "pass" | "fail";
  status?: "aktif" | "standby";
}) {
  const nik = nikOf();
  const [row] = await db
    .insert(schema.employees)
    .values({
      nik,
      name: `${tag} ${nik}`,
      companyId,
      departmentId,
      positionId,
      status: options.status ?? "aktif",
    })
    .returning({ id: schema.employees.id });
  const id = row!.id;
  made.employees.push(id);
  made.niks.push(nik);
  await db
    .insert(schema.employeeSkills)
    .values({ employeeId: id, simperCodeId: options.skill });
  await db
    .insert(schema.rosterDays)
    .values({ documentId: docId, employeeId: id, date: DATE, code: "N" });
  if (options.unit)
    await db
      .insert(schema.fleetPlanSlots)
      .values({ unitId: options.unit, employeeId: id });
  if (options.tapped)
    await db
      .insert(schema.fingerReadings)
      .values({ nik, date: DATE, firstInPmAt: `${DATE} 17:10:00` });
  if (options.ftw)
    await db.insert(schema.ftwReadings).values({
      nik,
      date: DATE,
      name: tag,
      ftwDecision:
        options.ftw === "pass" ? "FTW Aman" : "FTW Perlu Tindak Lanjut",
      sleepCategory:
        options.ftw === "pass" ? "Dapat Bekerja" : "Tidak Boleh Bekerja",
    });
  return nik;
}

const row = (
  rows: Awaited<ReturnType<typeof dashboardAnalytics>>["operators"],
  category: string
) =>
  rows.find((r) => r.category === category) ?? {
    category,
    ready: 0,
    noFinger: 0,
    noFtw: 0,
  };

beforeAll(async () => {
  const [company] = await db
    .insert(schema.companies)
    .values({ name: `${tag} PT`, code: `ZR${uid()}` })
    .returning({ id: schema.companies.id });
  companyId = company!.id;
  made.companies.push(companyId);
  const [dept] = await db
    .insert(schema.departments)
    .values({ name: `${tag} Dept`, companyId })
    .returning({ id: schema.departments.id });
  departmentId = dept!.id;
  made.departments.push(departmentId);
  const [pos] = await db
    .insert(schema.positions)
    .values({ name: `${tag} Operator`, departmentId, fleetAllocation: true })
    .returning({ id: schema.positions.id });
  positionId = pos!.id;
  made.positions.push(positionId);

  const codes = await db
    .insert(schema.simperCodes)
    .values([{ name: `${tag} C-FTW` }, { name: `${tag} C-BEBAS` }])
    .returning({ id: schema.simperCodes.id });
  [codeFtw, codeFree] = codes.map((c) => c.id) as [string, string];
  made.codes.push(codeFtw, codeFree);

  const types = await db
    .insert(schema.unitTypes)
    .values([{ name: FTW_TYPE }, { name: FREE_TYPE }])
    .returning({ id: schema.unitTypes.id });
  const [typeFtw, typeFree] = types.map((t) => t.id) as [string, string];
  made.types.push(typeFtw, typeFree);
  // The equipment panel groups by class; named as the types are.
  const classes = await db
    .insert(schema.unitClasses)
    .values([{ name: FTW_TYPE }, { name: FREE_TYPE }])
    .returning({ id: schema.unitClasses.id });
  const [classFtw, classFree] = classes.map((c) => c.id) as [string, string];
  made.classes.push(classFtw, classFree);
  const [model] = await db
    .insert(schema.unitModels)
    .values({ name: `${tag} model` })
    .returning({ id: schema.unitModels.id });
  const [brand] = await db
    .insert(schema.unitBrands)
    .values({ name: `${tag} merk` })
    .returning({ id: schema.unitBrands.id });
  made.models.push(model!.id);
  made.brands.push(brand!.id);
  const kind = { modelId: model!.id, brandId: brand!.id };

  /* Both in allocation (support) and in service. The FTW one is on standby:
     the equipment panel must still count it ready (owner, 2026-10-09) — the
     engine crews standby units. */
  const units = await db
    .insert(schema.units)
    .values([
      {
        code: `${tag}-F`,
        typeId: typeFtw,
        classId: classFtw,
        ...kind,
        simperCodeId: codeFtw,
        ftw: true,
        active: true,
        standby: true,
        fleetSupport: true,
      },
      {
        code: `${tag}-B`,
        typeId: typeFree,
        classId: classFree,
        ...kind,
        simperCodeId: codeFree,
        ftw: false,
        active: true,
        fleetSupport: true,
      },
    ])
    .returning({ id: schema.units.id });
  [unitFtw, unitFree] = units.map((u) => u.id) as [string, string];
  made.units.push(unitFtw, unitFree);

  const [doc] = await db
    .insert(schema.rosterDocuments)
    .values({
      departmentId,
      month: MONTH,
      fileName: `${tag}.xlsx`,
      source: "unggul",
    })
    .returning({ id: schema.rosterDocuments.id });
  docId = doc!.id;
  made.docs.push(docId);

  // FTW unit: one who passed, one who tapped and never uploaded.
  await person({ unit: unitFtw, skill: codeFtw, tapped: true, ftw: "pass" });
  await person({ unit: unitFtw, skill: codeFtw, tapped: true });
  // No-FTW unit: a paired one and a spare who tapped and never uploaded —
  // nobody asked them to — and one who never tapped.
  await person({ unit: unitFree, skill: codeFree, tapped: true });
  await person({ skill: codeFree, tapped: true });
  await person({ unit: unitFree, skill: codeFree, tapped: false });
  // On standby for the day (an induction hold): tapped, no upload.
  await person({
    unit: unitFtw,
    skill: codeFtw,
    tapped: true,
    status: "standby",
  });
});

afterAll(async () => {
  if (made.niks.length) {
    await db
      .delete(schema.fingerReadings)
      .where(inArray(schema.fingerReadings.nik, made.niks));
    await db
      .delete(schema.ftwReadings)
      .where(inArray(schema.ftwReadings.nik, made.niks));
  }
  // Roster rows go with their document; they hold the employees.
  if (made.docs.length)
    await db
      .delete(schema.rosterDocuments)
      .where(inArray(schema.rosterDocuments.id, made.docs));
  if (made.employees.length) {
    await db
      .delete(schema.fleetPlanSlots)
      .where(inArray(schema.fleetPlanSlots.employeeId, made.employees));
  }
  if (made.employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
  if (made.units.length)
    await db.delete(schema.units).where(inArray(schema.units.id, made.units));
  if (made.classes.length)
    await db
      .delete(schema.unitClasses)
      .where(inArray(schema.unitClasses.id, made.classes));
  if (made.models.length)
    await db
      .delete(schema.unitModels)
      .where(inArray(schema.unitModels.id, made.models));
  if (made.brands.length)
    await db
      .delete(schema.unitBrands)
      .where(inArray(schema.unitBrands.id, made.brands));
  if (made.types.length)
    await db
      .delete(schema.unitTypes)
      .where(inArray(schema.unitTypes.id, made.types));
  if (made.codes.length)
    await db
      .delete(schema.simperCodes)
      .where(inArray(schema.simperCodes.id, made.codes));
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

describe("the operator ratio (2026-10-09 trial)", () => {
  test("someone who tapped on a unit that asks no FTW is ready, not missing", async () => {
    const { operators } = await dashboardAnalytics(DATE, "night");
    expect(row(operators, FREE_TYPE)).toEqual({
      category: FREE_TYPE,
      ready: 2, // the paired operator and the spare
      noFinger: 1,
      noFtw: 0,
    });
  });

  test("someone who owes an FTW and never uploaded has not passed it", async () => {
    const { operators } = await dashboardAnalytics(DATE, "night");
    expect(row(operators, FTW_TYPE)).toEqual({
      category: FTW_TYPE,
      ready: 1,
      noFinger: 0,
      noFtw: 1,
    });
  });

  test("a standby employee is not on the ratio at all", async () => {
    const { operators } = await dashboardAnalytics(DATE, "night");
    const counted = [FREE_TYPE, FTW_TYPE]
      .map((c) => row(operators, c))
      .reduce((n, r) => n + r.ready + r.noFinger + r.noFtw, 0);
    // Six people on the roster; the one on standby is not counted.
    expect(counted).toBe(5);
  });
});

describe("the equipment panel", () => {
  test("a standby unit counts as ready (owner, 2026-10-09)", async () => {
    const { equipment } = await dashboardAnalytics(DATE, "night");
    const ftw = equipment.find((e) => e.unitClass === FTW_TYPE);
    expect(ftw).toMatchObject({ qty: 1, ready: 1 });
  });

  test("a broken-down unit still does not", async () => {
    await db
      .update(schema.units)
      .set({ breakdown: true })
      .where(inArray(schema.units.id, [unitFree]));
    const { equipment } = await dashboardAnalytics(DATE, "night");
    const free = equipment.find((e) => e.unitClass === FREE_TYPE);
    expect(free).toMatchObject({ qty: 1, ready: 0 });
  });
});
