/**
 * The fleet spreadsheet import: same rules as the form, plus the checks only
 * a file can need — duplicates inside itself, and units traded between two
 * fleets the same upload replaces.
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
  headers = ["digger", "area", "bus", "units"]
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
        schema.fleets.diggerUnitId,
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
    expect(headers).toEqual(["digger", "area", "bus", "units"]);
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
      form(await file([], ["digger", "area", "bus", "units", "warna"]))
    );
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toMatchObject({ code: "unknown_columns" });

    const missing = await postForm(
      "/fleets/import/validate",
      admin.cookie,
      form(await file([], ["digger", "bus"]))
    );
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({ code: "missing_columns" });
  });
});

/* ------------------------------------------------------------- validate */

describe("validation previews without writing", () => {
  test("a sound new fleet previews as new, members parsed from the cell", async () => {
    const preview = await validate([
      [
        digger1.code,
        miningName,
        busUnit.code,
        `${hauler1.code}, ${hauler2.code}`,
      ],
    ]);
    expect(preview.errorCount).toBe(0);
    expect(preview.newCount).toBe(1);
    expect(preview.rows[0]).toMatchObject({
      kind: "new",
      digger: digger1.code,
      bus: busUnit.code,
    });
    expect(preview.rows[0]!.units.sort()).toEqual(
      [hauler1.code, hauler2.code].sort()
    );

    // Nothing written: validation is a reading.
    const fleets = await db
      .select()
      .from(schema.fleets)
      .where(eq(schema.fleets.diggerUnitId, digger1.id));
    expect(fleets).toEqual([]);
  });

  test("the composition rules refuse by row, and name what is wrong", async () => {
    const preview = await validate([
      // Unknown digger code.
      ["ZZNOPE99", miningName, null, hauler1.code],
      // Unknown member code.
      [digger1.code, miningName, null, "ZZNOPE98"],
      // Blank area — the only thing the column can still get wrong.
      [digger2.code, "", null, hauler1.code],
      // Bus that is not a BUS.
      [digger3.code, miningName, hauler2.code, hauler1.code],
    ]);
    expect(preview.rows).toEqual([]);
    expect(preview.errorCount).toBe(4);
    const issues = preview.errors.map((e) => e.issue).join(" | ");
    expect(issues).toContain("ZZNOPE99");
    expect(issues).toContain("ZZNOPE98");
    expect(issues).toContain("area");
    expect(issues).toContain("BUS");
  });

  test("a manhaul truck is transport too, not only a bus", async () => {
    const preview = await validate([
      [digger1.code, miningName, manhaulUnit.code, hauler1.code],
    ]);
    expect(preview.errorCount).toBe(0);
    expect(preview.rows[0]).toMatchObject({ bus: manhaulUnit.code });
  });

  test("a digger cannot haul — for itself, or in another row", async () => {
    const preview = await validate([
      [digger1.code, miningName, null, digger1.code],
      [digger2.code, miningName, null, `${hauler1.code}, ${digger3.code}`],
      [digger3.code, miningName, null, hauler2.code],
    ]);
    // Row 2: self-haul. Rows 3 and 4: digger3 cannot lead one row and haul in
    // another, whichever way the conflict is reported.
    expect(preview.errorCount).toBeGreaterThanOrEqual(2);
    const issues = preview.errors.map((e) => e.issue).join(" | ");
    expect(issues).toContain(digger3.code);
  });

  test("duplicates inside the file are refused where they repeat", async () => {
    const preview = await validate([
      [digger1.code, miningName, null, hauler1.code],
      [digger1.code, miningName, null, hauler2.code],
      [digger2.code, miningName, null, hauler1.code],
    ]);
    expect(preview.errorCount).toBe(2);
    expect(preview.newCount).toBe(1);
    const issues = preview.errors.map((e) => e.issue).join(" | ");
    expect(issues).toContain("baris");
  });
});

/* ---------------------------------------------------------------- commit */

describe("the commit is all-or-nothing and mirrors the form", () => {
  test("view may not import", async () => {
    const response = await postForm(
      "/fleets/import/commit",
      viewer.cookie,
      form(await file([[digger1.code, miningName, null, hauler1.code]]))
    );
    expect(response.status).toBe(403);
  });

  test("a file with errors does not write a single row", async () => {
    const response = await postForm(
      "/fleets/import/commit",
      admin.cookie,
      form(
        await file([
          [digger1.code, miningName, null, hauler1.code],
          ["ZZNOPE97", miningName, null, hauler2.code],
        ])
      )
    );
    expect(response.status).toBe(422);
    const fleets = await db
      .select()
      .from(schema.fleets)
      .where(eq(schema.fleets.diggerUnitId, digger1.id));
    expect(fleets).toEqual([]);
  });

  test("a clean file creates, and a re-upload updates in place", async () => {
    const first = await postForm(
      "/fleets/import/commit",
      admin.cookie,
      form(
        await file([
          [
            digger1.code,
            miningName,
            busUnit.code,
            `${hauler1.code}, ${hauler2.code}`,
          ],
          [digger2.code, miningName, null, hauler3.code],
        ])
      )
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ created: 2, updated: 0 });

    // The re-upload previews as updates, naming what changes.
    const preview = await validate([
      [digger1.code, miningName, null, `${hauler1.code}, ${hauler4.code}`],
      [digger2.code, miningName, null, hauler3.code],
    ]);
    expect(preview.errorCount).toBe(0);
    expect(preview.updatedCount).toBe(2);
    const changed = preview.rows.find((r) => r.digger === digger1.code);
    expect(changed!.changes.length).toBeGreaterThan(0);

    const second = await postForm(
      "/fleets/import/commit",
      admin.cookie,
      form(
        await file([
          [digger1.code, miningName, null, `${hauler1.code}, ${hauler4.code}`],
          [digger2.code, miningName, null, hauler3.code],
        ])
      )
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ created: 0, updated: 2 });

    const [fleet] = await db
      .select({ id: schema.fleets.id, busUnitId: schema.fleets.busUnitId })
      .from(schema.fleets)
      .where(eq(schema.fleets.diggerUnitId, digger1.id));
    made.fleets.push(fleet!.id);
    expect(fleet!.busUnitId).toBeNull();
    const members = await db
      .select({ unitId: schema.fleetUnits.unitId })
      .from(schema.fleetUnits)
      .where(eq(schema.fleetUnits.fleetId, fleet!.id));
    expect(members.map((m) => m.unitId).sort()).toEqual(
      [hauler1.id, hauler4.id].sort()
    );
  });

  test("two fleets in one file may trade a hauler", async () => {
    // hauler1 currently hauls for digger1's fleet; the file hands it to
    // digger2 and gives digger1 hauler3 back. Neither row may be refused for
    // membership the same file dissolves.
    const preview = await validate([
      [digger1.code, miningName, null, `${hauler4.code}, ${hauler3.code}`],
      [digger2.code, miningName, null, hauler1.code],
    ]);
    expect(preview.errors).toEqual([]);

    const response = await postForm(
      "/fleets/import/commit",
      admin.cookie,
      form(
        await file([
          [digger1.code, miningName, null, `${hauler4.code}, ${hauler3.code}`],
          [digger2.code, miningName, null, hauler1.code],
        ])
      )
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ created: 0, updated: 2 });
  });

  test("membership held outside the file still refuses", async () => {
    // digger3 tries to take hauler1, which digger2's fleet (not in this
    // file) holds after the trade above.
    const preview = await validate([
      [digger3.code, miningName, null, hauler1.code],
    ]);
    expect(preview.errorCount).toBe(1);
    expect(preview.errors[0]!.issue).toContain(hauler1.code);
  });
});
