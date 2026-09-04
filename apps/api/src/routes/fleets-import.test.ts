/**
 * The fleet spreadsheet import: **one row per unit**, and the rules only a file
 * of that shape can break — a leader with no row of its own, members that
 * disagree about where they are working, and a unit listed twice.
 *
 * The file is the whole yard for one day, so it also takes things away: a
 * formation it never names is disbanded and a unit it never names drops out of
 * operation. Both are asserted here, because both are destructive.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/fleets-import.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import ExcelJS from "exceljs";
import { eq, inArray, sql } from "drizzle-orm";
import type { FleetImportPreview } from "@universe/contracts";

import { createSession, SESSION_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { fleetsRoutes } from "./fleets";

const app = new Elysia().use(fleetsRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji FleetImp ${uid()}`;

const made = {
  users: [] as string[],
  roles: [] as string[],
  fleets: [] as string[],
  units: [] as string[],
  catalogues: [] as {
    table: "classes" | "types" | "models" | "brands";
    id: string;
  }[],
};

let admin: { cookie: string };
let viewer: { cookie: string };

let miningName = "";
let busTypeId = "";
let busTypeCreated = false;
let manhaulTypeId = "";
let manhaulTypeCreated = false;

let digger1 = { id: "", code: "" };
let digger2 = { id: "", code: "" };
let digger3 = { id: "", code: "" };
let hauler1 = { id: "", code: "" };
let hauler2 = { id: "", code: "" };
let hauler3 = { id: "", code: "" };
let hauler4 = { id: "", code: "" };
let busUnit = { id: "", code: "" };
let manhaulUnit = { id: "", code: "" };

/* ------------------------------------------------------------- fixtures */

async function makeUser(mode: "view" | "manage") {
  const [role] = await db
    .insert(schema.roles)
    .values({ slug: `zz-fimp-${uid()}`, name: tag, scope: "all" })
    .returning({ id: schema.roles.id });
  made.roles.push(role!.id);
  await db
    .insert(schema.rolePermissions)
    .values([{ roleId: role!.id, menuSlug: "fleet-setting", mode }]);
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

async function makeUnit(
  code: string,
  typeId: string,
  refs: { classId: string; modelId: string; brandId: string }
) {
  const [row] = await db
    .insert(schema.units)
    .values({ code, typeId, ...refs })
    .returning({ id: schema.units.id, code: schema.units.code });
  made.units.push(row!.id);
  return { id: row!.id, code: row!.code };
}

const get = (path: string, cookie: string) =>
  app.handle(new Request(`http://localhost${path}`, { headers: { cookie } }));

const postForm = (path: string, cookie: string, form: FormData) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { cookie },
      body: form,
    })
  );

async function file(
  rows: (string | null)[][],
  headers = ["unit", "area", "fleet", "bus"]
): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Fleet");
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  const buffer = await wb.xlsx.writeBuffer();
  return new File([buffer], "fleet.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function form(f: File) {
  const fd = new FormData();
  fd.append("file", f);
  return fd;
}

async function validate(rows: (string | null)[][], headers?: string[]) {
  const response = await postForm(
    "/fleets/import/validate",
    admin.cookie,
    form(await file(rows, headers))
  );
  expect(response.status).toBe(200);
  return (await response.json()) as FleetImportPreview;
}

beforeAll(async () => {
  // scheduler.test.ts disconnects the shared client in its teardown, and bun
  // runs every file in one process.
  if (redis.status === "end") await redis.connect();

  admin = await makeUser("manage");
  viewer = await makeUser("view");

  const [cls] = await db
    .insert(schema.unitClasses)
    .values({ name: `${tag} CLASS` })
    .returning({ id: schema.unitClasses.id });
  made.catalogues.push({ table: "classes", id: cls!.id });
  const [typ] = await db
    .insert(schema.unitTypes)
    .values({ name: `${tag} TYPE` })
    .returning({ id: schema.unitTypes.id });
  made.catalogues.push({ table: "types", id: typ!.id });
  const [mdl] = await db
    .insert(schema.unitModels)
    .values({ name: `${tag} MODEL` })
    .returning({ id: schema.unitModels.id });
  made.catalogues.push({ table: "models", id: mdl!.id });
  const [brd] = await db
    .insert(schema.unitBrands)
    .values({ name: `${tag} BRAND` })
    .returning({ id: schema.unitBrands.id });
  made.catalogues.push({ table: "brands", id: brd!.id });

  const [existingBus] = await db
    .select({ id: schema.unitTypes.id })
    .from(schema.unitTypes)
    .where(sql`lower(${schema.unitTypes.name}) = 'bus'`)
    .limit(1);
  if (existingBus) {
    busTypeId = existingBus.id;
  } else {
    const [created] = await db
      .insert(schema.unitTypes)
      .values({ name: "BUS" })
      .returning({ id: schema.unitTypes.id });
    busTypeId = created!.id;
    busTypeCreated = true;
  }

  const [existingManhaul] = await db
    .select({ id: schema.unitTypes.id })
    .from(schema.unitTypes)
    .where(sql`lower(${schema.unitTypes.name}) = 'manhaul truck'`)
    .limit(1);
  if (existingManhaul) {
    manhaulTypeId = existingManhaul.id;
  } else {
    const [created] = await db
      .insert(schema.unitTypes)
      .values({ name: "MANHAUL TRUCK" })
      .returning({ id: schema.unitTypes.id });
    manhaulTypeId = created!.id;
    manhaulTypeCreated = true;
  }

  miningName = `${tag} PIT`;

  const refs = { classId: cls!.id, modelId: mdl!.id, brandId: brd!.id };
  digger1 = await makeUnit(`ZZFX1${uid()}`, typ!.id, refs);
  digger2 = await makeUnit(`ZZFX2${uid()}`, typ!.id, refs);
  digger3 = await makeUnit(`ZZFX3${uid()}`, typ!.id, refs);
  hauler1 = await makeUnit(`ZZFT1${uid()}`, typ!.id, refs);
  hauler2 = await makeUnit(`ZZFT2${uid()}`, typ!.id, refs);
  hauler3 = await makeUnit(`ZZFT3${uid()}`, typ!.id, refs);
  hauler4 = await makeUnit(`ZZFT4${uid()}`, typ!.id, refs);
  busUnit = await makeUnit(`ZZFB1${uid()}`, busTypeId, refs);
  manhaulUnit = await makeUnit(`ZZFM1${uid()}`, manhaulTypeId, refs);
});

afterAll(async () => {
  // Fleets created by commits are found by digger, not remembered by hand.
  const fleets = await db
    .select({ id: schema.fleets.id })
    .from(schema.fleets)
    .where(
      inArray(
        schema.fleets.leaderUnitId,
        made.units.length
          ? made.units
          : ["00000000-0000-0000-0000-000000000000"]
      )
    );
  const ids = [...new Set([...made.fleets, ...fleets.map((f) => f.id)])];
  if (ids.length)
    await db.delete(schema.fleets).where(inArray(schema.fleets.id, ids));
  if (made.units.length)
    await db.delete(schema.units).where(inArray(schema.units.id, made.units));
  for (const { table, id } of made.catalogues) {
    const target = {
      classes: schema.unitClasses,
      types: schema.unitTypes,
      models: schema.unitModels,
      brands: schema.unitBrands,
    }[table];
    await db.delete(target).where(eq(target.id, id));
  }
  if (busTypeCreated)
    await db.delete(schema.unitTypes).where(eq(schema.unitTypes.id, busTypeId));
  if (manhaulTypeCreated)
    await db
      .delete(schema.unitTypes)
      .where(eq(schema.unitTypes.id, manhaulTypeId));
  if (made.users.length)
    await db.delete(schema.users).where(inArray(schema.users.id, made.users));
  if (made.roles.length)
    await db.delete(schema.roles).where(inArray(schema.roles.id, made.roles));
});

/* ------------------------------------------------------------- template */

describe("the template names its columns", () => {
  test("downloads as an .xlsx with the four headers", async () => {
    const response = await get("/fleets/import/template", admin.cookie);
    expect(response.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await response.arrayBuffer());
    const headers = (wb.worksheets[0]!.getRow(1).values as string[])
      .slice(1)
      .map((v) => String(v).toLowerCase());
    expect(headers).toEqual(["unit", "area", "fleet", "bus"]);
  });

  test("view may not even fetch the template", async () => {
    const response = await get("/fleets/import/template", viewer.cookie);
    expect(response.status).toBe(403);
  });
});

/* ------------------------------------------------------------- headers */

describe("a file with the wrong columns is refused whole", () => {
  test("unknown and missing columns each name the accepted set", async () => {
    const unknown = await postForm(
      "/fleets/import/validate",
      admin.cookie,
      form(await file([], ["unit", "area", "fleet", "bus", "warna"]))
    );
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toMatchObject({ code: "unknown_columns" });

    const missing = await postForm(
      "/fleets/import/validate",
      admin.cookie,
      form(await file([], ["unit", "bus"]))
    );
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ code: "missing_columns" });
  });
});

/* ------------------------------------------------------------- roles */

/** The rows one sound formation is spelled out as, leader first. */
const fleetRows = (
  leader: string,
  members: string[],
  area = miningName,
  bus: string | null = null
) => [[leader, area, null, bus], ...members.map((m) => [m, area, leader, bus])];

describe("a row's role comes from the fleet cell alone", () => {
  test("a leader leaves it blank and its haulers name it", async () => {
    const preview = await validate(
      fleetRows(
        digger1.code,
        [hauler1.code, hauler2.code],
        miningName,
        busUnit.code
      )
    );
    expect(preview.errorCount).toBe(0);
    expect(preview.newCount).toBe(1);
    expect(preview.rows[0]).toMatchObject({
      kind: "new",
      leader: digger1.code,
      area: miningName,
    });
    expect(preview.rows[0]!.units.sort()).toEqual(
      [hauler1.code, hauler2.code].sort()
    );
    expect(preview.rows[0]!.transports).toEqual([busUnit.code]);

    // Nothing written: validation is a reading.
    const fleets = await db
      .select()
      .from(schema.fleets)
      .where(eq(schema.fleets.leaderUnitId, digger1.id));
    expect(fleets).toEqual([]);
  });

  test("blank and unnamed is a support unit, not an orphan", async () => {
    const preview = await validate([
      ...fleetRows(digger1.code, [hauler1.code]),
      [hauler3.code, `${tag} DISPOSAL`, null, busUnit.code],
    ]);
    expect(preview.errorCount).toBe(0);
    expect(preview.supportCount).toBe(1);
    expect(preview.support[0]).toMatchObject({
      unit: hauler3.code,
      area: `${tag} DISPOSAL`,
      transport: busUnit.code,
      breakdown: false,
    });
  });

  test("a leader with no row of its own is refused", async () => {
    // The file cannot say where that formation works or what it rides, and
    // inventing either would put a machine somewhere nobody wrote down.
    const preview = await validate([
      [hauler1.code, miningName, digger3.code, null],
    ]);
    expect(preview.errorCount).toBe(1);
    expect(preview.errors[0]!.issue).toContain("tidak punya barisnya sendiri");
  });

  test("a unit cannot lead one formation and haul for another", async () => {
    const preview = await validate([
      ...fleetRows(digger1.code, [hauler1.code]),
      // digger2 leads, and is also listed as one of digger1's haulers.
      [digger2.code, miningName, digger1.code, null],
      [hauler2.code, miningName, digger2.code, null],
    ]);
    expect(preview.errorCount).toBeGreaterThan(0);
    expect(preview.errors.some((e) => e.nik === digger2.code)).toBe(true);
  });

  test("a unit listed twice is refused where it repeats", async () => {
    const preview = await validate([
      ...fleetRows(digger1.code, [hauler1.code]),
      [hauler1.code, miningName, digger1.code, null],
    ]);
    expect(preview.errorCount).toBe(1);
    expect(preview.errors[0]!.issue).toContain("hanya boleh muncul sekali");
  });
});

/* ------------------------------------------------------------- area */

describe("one formation cannot span two areas", () => {
  test("a member in a different area is named, with both areas", async () => {
    const preview = await validate([
      [digger1.code, miningName, null, null],
      [hauler1.code, miningName, digger1.code, null],
      [hauler2.code, `${tag} LAIN`, digger1.code, null],
    ]);
    expect(preview.errorCount).toBe(1);
    expect(preview.errors[0]!.nik).toBe(hauler2.code);
    expect(preview.errors[0]!.issue).toContain(miningName);
  });

  test("support units may each work somewhere different", async () => {
    // They are not one formation — which is exactly why the rule above does
    // not reach them.
    const preview = await validate([
      [hauler1.code, `${tag} A`, null, null],
      [hauler2.code, `${tag} B`, null, null],
    ]);
    expect(preview.errorCount).toBe(0);
    expect(preview.supportCount).toBe(2);
  });
});

/* ------------------------------------------------------------- breakdown */

describe("BREAKDOWN in the area cell is a status", () => {
  test("both spellings are read, and the word is not kept as a place", async () => {
    const preview = await validate([
      [hauler1.code, "BREAKDOWN", null, null],
      [hauler2.code, "BREAK DOWN", null, null],
    ]);
    expect(preview.errorCount).toBe(0);
    expect(preview.breakdownCount).toBe(2);
    for (const row of preview.support) {
      expect(row.breakdown).toBe(true);
      // "BREAKDOWN" is not a location, so it is not recorded as one.
      expect(row.area).toBeNull();
    }
  });

  test("a broken unit cannot also be hauling for someone", async () => {
    const preview = await validate([
      ...fleetRows(digger1.code, [hauler1.code]),
      [hauler2.code, "BREAKDOWN", digger1.code, null],
    ]);
    expect(preview.errorCount).toBeGreaterThan(0);
    expect(preview.errors.some((e) => e.nik === hauler2.code)).toBe(true);
  });
});

/* ------------------------------------------------------------- transport */

describe("the transport cell", () => {
  test("finds one vehicle through three spellings", async () => {
    /* The file writes the same bus as "UDBU 09", "UDBU09" and "UD-BU09".
       Refusing two of the three would be reading the punctuation. */
    const spaced = busUnit.code.replace(/^(.{3})/, "$1 ");
    const preview = await validate(
      fleetRows(digger1.code, [hauler1.code], miningName, spaced)
    );
    expect(preview.errorCount).toBe(0);
    expect(preview.rows[0]!.transports).toEqual([busUnit.code]);
  });

  test("a manhaul truck is transport too, not only a bus", async () => {
    const preview = await validate(
      fleetRows(digger1.code, [hauler1.code], miningName, manhaulUnit.code)
    );
    expect(preview.errorCount).toBe(0);
    expect(preview.rows[0]!.transports).toEqual([manhaulUnit.code]);
  });

  test("an unknown vehicle and a non-vehicle each refuse by row", async () => {
    const preview = await validate([
      [digger1.code, miningName, null, "ZZNOBUS9"],
      [hauler1.code, miningName, digger1.code, hauler2.code],
    ]);
    /* The leader's row failing takes its formation with it, so there is a
       third error about the formation having no leader row — the two the test
       is about are named rather than counted. */
    expect(
      preview.errors.some((e) => e.issue.includes("tidak ada di master"))
    ).toBe(true);
    expect(preview.errors.some((e) => e.issue.includes("bukan"))).toBe(true);
  });

  test("two units of one formation may ride different vehicles", async () => {
    const preview = await validate([
      [digger1.code, miningName, null, busUnit.code],
      [hauler1.code, miningName, digger1.code, manhaulUnit.code],
    ]);
    expect(preview.errorCount).toBe(0);
    expect(preview.rows[0]!.transports.sort()).toEqual(
      [busUnit.code, manhaulUnit.code].sort()
    );
  });
});

/* ------------------------------------------------------------- commit */

describe("the commit writes the unit facts, not just the formation", () => {
  test("view may not import", async () => {
    const response = await postForm(
      "/fleets/import/commit",
      viewer.cookie,
      form(await file(fleetRows(digger1.code, [hauler1.code])))
    );
    expect(response.status).toBe(403);
  });

  test("a file with errors does not write a single row", async () => {
    const response = await postForm(
      "/fleets/import/commit",
      admin.cookie,
      form(
        await file([
          ...fleetRows(digger1.code, [hauler1.code]),
          ["ZZNOPE99", miningName, null, null],
        ])
      )
    );
    expect(response.status).toBe(422);
    const fleets = await db
      .select()
      .from(schema.fleets)
      .where(eq(schema.fleets.leaderUnitId, digger1.id));
    expect(fleets).toEqual([]);
  });

  test("area and transport land on every unit, support included", async () => {
    const response = await postForm(
      "/fleets/import/commit",
      admin.cookie,
      form(
        await file([
          ...fleetRows(
            digger1.code,
            [hauler1.code, hauler2.code],
            miningName,
            busUnit.code
          ),
          [hauler3.code, `${tag} DISPOSAL`, null, manhaulUnit.code],
          [hauler4.code, "BREAKDOWN", null, null],
        ])
      )
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ created: 1, support: 1 });

    const rows = await db
      .select({
        code: schema.units.code,
        workArea: schema.units.workArea,
        transportUnitId: schema.units.transportUnitId,
        fleetSupport: schema.units.fleetSupport,
        breakdown: schema.units.breakdown,
      })
      .from(schema.units)
      .where(
        inArray(schema.units.id, [
          digger1.id,
          hauler1.id,
          hauler3.id,
          hauler4.id,
        ])
      );
    const by = new Map(rows.map((r) => [r.code, r]));

    // The formation: its leader's area, on every member, with its ride.
    expect(by.get(digger1.code)).toMatchObject({
      workArea: miningName,
      transportUnitId: busUnit.id,
      fleetSupport: false,
    });
    expect(by.get(hauler1.code)).toMatchObject({
      workArea: miningName,
      transportUnitId: busUnit.id,
    });
    // The support unit: crewed, in no formation.
    expect(by.get(hauler3.code)).toMatchObject({
      workArea: `${tag} DISPOSAL`,
      transportUnitId: manhaulUnit.id,
      fleetSupport: true,
    });
    // The broken one: not crewed, and "BREAKDOWN" kept as a status only.
    expect(by.get(hauler4.code)).toMatchObject({
      breakdown: true,
      workArea: null,
      fleetSupport: false,
    });
  });

  test("a re-upload updates in place and moves a hauler between formations", async () => {
    const first = await postForm(
      "/fleets/import/commit",
      admin.cookie,
      form(
        await file([
          ...fleetRows(digger1.code, [hauler1.code, hauler2.code]),
          ...fleetRows(digger2.code, [hauler3.code]),
        ])
      )
    );
    expect(first.status).toBe(200);

    // hauler2 moves from digger1 to digger2 — two formations trading a unit
    // inside one upload, which the unique index would refuse mid-write.
    const second = await postForm(
      "/fleets/import/commit",
      admin.cookie,
      form(
        await file([
          ...fleetRows(digger1.code, [hauler1.code]),
          ...fleetRows(digger2.code, [hauler3.code, hauler2.code]),
        ])
      )
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ created: 0, updated: 2 });

    const [moved] = await db
      .select({ fleetId: schema.fleetUnits.fleetId })
      .from(schema.fleetUnits)
      .where(eq(schema.fleetUnits.unitId, hauler2.id));
    const [target] = await db
      .select({ id: schema.fleets.id })
      .from(schema.fleets)
      .where(eq(schema.fleets.leaderUnitId, digger2.id));
    expect(moved?.fleetId).toBe(target!.id);
  });

  test("a formation the file never names is disbanded, and listed first", async () => {
    await postForm(
      "/fleets/import/commit",
      admin.cookie,
      form(
        await file([
          ...fleetRows(digger1.code, [hauler1.code]),
          ...fleetRows(digger2.code, [hauler2.code]),
        ])
      )
    );

    // The next file drops digger2 entirely.
    const next = await file(fleetRows(digger1.code, [hauler1.code]));
    const preview = (await (
      await postForm("/fleets/import/validate", admin.cookie, form(next))
    ).json()) as FleetImportPreview;
    /* Named before it happens, which is the whole bargain: the file is the
       yard for one day, so absent does mean gone — and a wrong file says the
       same thing. */
    expect(preview.disband).toContain(digger2.code);
    expect(preview.released).toContain(hauler2.code);

    const commit = await postForm(
      "/fleets/import/commit",
      admin.cookie,
      form(await file(fleetRows(digger1.code, [hauler1.code])))
    );
    expect(commit.status).toBe(200);

    const gone = await db
      .select()
      .from(schema.fleets)
      .where(eq(schema.fleets.leaderUnitId, digger2.id));
    expect(gone).toEqual([]);

    // And the hauler it held stops taking part rather than lingering.
    const [released] = await db
      .select({
        workArea: schema.units.workArea,
        fleetSupport: schema.units.fleetSupport,
      })
      .from(schema.units)
      .where(eq(schema.units.id, hauler2.id));
    expect(released).toMatchObject({ workArea: null, fleetSupport: false });
  });

  test("a support unit the next file drops is released, not left behind", async () => {
    const first = await postForm(
      "/fleets/import/commit",
      admin.cookie,
      form(
        await file([
          ...fleetRows(digger1.code, [hauler1.code]),
          [hauler3.code, `${tag} DISPOSAL`, null, busUnit.code],
        ])
      )
    );
    expect(first.status).toBe(200);

    // The next day's file says nothing about hauler3 at all.
    const preview = await validate(fleetRows(digger1.code, [hauler1.code]));
    expect(preview.released).toContain(hauler3.code);

    const second = await postForm(
      "/fleets/import/commit",
      admin.cookie,
      form(await file(fleetRows(digger1.code, [hauler1.code])))
    );
    expect(second.status).toBe(200);

    const [row] = await db
      .select({
        fleetSupport: schema.units.fleetSupport,
        workArea: schema.units.workArea,
        transportUnitId: schema.units.transportUnitId,
      })
      .from(schema.units)
      .where(eq(schema.units.id, hauler3.id));
    /* Cleared outright rather than merely un-flagged: a machine nobody named
       today is not working anywhere, and a leftover area is what had the Unit
       Status screen naming a pit the unit had been pulled out of. */
    expect(row).toMatchObject({
      fleetSupport: false,
      workArea: null,
      transportUnitId: null,
    });
  });

  test("an area left behind by a hand-disbanded fleet is swept too", async () => {
    /*
     * Wider than allocation scope on purpose. Deleting a formation takes its
     * units out of allocation, but before 2026-09-04 nothing held their work
     * area — 245 units on the owner's site carried one while belonging to
     * nothing. The daily file is what knows they are no longer working.
     */
    await db
      .update(schema.units)
      .set({ workArea: `${tag} SISA` })
      .where(eq(schema.units.id, hauler4.id));

    const preview = await validate(fleetRows(digger1.code, [hauler1.code]));
    expect(preview.released).toContain(hauler4.code);

    const commit = await postForm(
      "/fleets/import/commit",
      admin.cookie,
      form(await file(fleetRows(digger1.code, [hauler1.code])))
    );
    expect(commit.status).toBe(200);

    const [row] = await db
      .select({ workArea: schema.units.workArea })
      .from(schema.units)
      .where(eq(schema.units.id, hauler4.id));
    expect(row?.workArea).toBeNull();
  });

  test("nothing outside the file can conflict with it any more", async () => {
    /*
     * Worth pinning because it used to be the opposite. When a file described
     * a few formations, a hauler held by one it did not mention was a genuine
     * conflict and the import refused it. The file is now the whole yard for
     * one day, so every existing formation is either rewritten by it or
     * disbanded by it — there is no "outside" left to conflict with, and a
     * hauler may move anywhere the file says.
     */
    const [outsider] = await db
      .insert(schema.fleets)
      .values({ leaderUnitId: digger3.id })
      .returning({ id: schema.fleets.id });
    made.fleets.push(outsider!.id);
    await db
      .insert(schema.fleetUnits)
      .values({ fleetId: outsider!.id, unitId: hauler4.id });

    const preview = await validate(
      fleetRows(digger1.code, [hauler1.code, hauler4.code])
    );
    expect(preview.errorCount).toBe(0);
    // The formation that held it is named as disbanded instead of refusing.
    expect(preview.disband).toContain(digger3.code);
  });
});
