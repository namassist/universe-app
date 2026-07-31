/**
 * The unit registry and the bus departure schedule.
 *
 * A unit's class, type, model, brand, qualification code, and department are
 * foreign keys (design D2), so the interesting work here is not CRUD — it is
 * turning "this class does not exist" into an answer that names the field,
 * rather than a 500 from a constraint the caller cannot see.
 *
 * References are resolved before the write rather than after: the database
 * would refuse a bad key anyway, but a foreign-key violation says only that
 * *something* did not resolve, and a form with six catalogue dropdowns needs to
 * know which one. The resolve is a read of rows the caller is about to write
 * against, so it costs one query and buys a usable error.
 */

import { and, asc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";

import type { EffectivePermissions, PendingMaster } from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import {
  db,
  isForeignKeyViolation,
  isUniqueViolation,
  schema,
  type NamedCatalogue,
  type Transaction,
} from "../db";
import { holds } from "./master";
import {
  MAX_IMPORT_BYTES,
  readWorkbook,
  unitTarget,
  unitTemplate,
  unitWorkbook,
  validateWorkbook,
  type UnitDepartment,
  type UnitExisting,
} from "./master-import";
import {
  BusScheduleSchema,
  ErrorSchema,
  MasterImportPreviewSchema,
  MasterImportResultSchema,
  UnitBulkDeleteResultSchema,
  UnitSchema,
} from "./schemas";

/** The type name a bus schedule requires of its unit (design D6). */
const BUS_TYPE_NAME = "BUS";

/** `departmentId=none` — the units no department owns. Exported for the client. */
export const UNASSIGNED = "none";

/* Aliased so six joins onto six different catalogues stay readable. */
const cls = schema.unitClasses;
const typ = schema.unitTypes;
const mdl = schema.unitModels;
const brd = schema.unitBrands;
const spc = schema.simperCodes;
const dpt = schema.departments;

const unitColumns = {
  id: schema.units.id,
  code: schema.units.code,
  classId: schema.units.classId,
  className: cls.name,
  typeId: schema.units.typeId,
  typeName: typ.name,
  modelId: schema.units.modelId,
  modelName: mdl.name,
  brandId: schema.units.brandId,
  brandName: brd.name,
  simperCodeId: schema.units.simperCodeId,
  simperCodeName: spc.name,
  departmentId: schema.units.departmentId,
  departmentName: dpt.name,
  serial: schema.units.serial,
  engineBrand: schema.units.engineBrand,
  description: schema.units.description,
  ftw: schema.units.ftw,
  active: schema.units.active,
  standby: schema.units.standby,
  breakdown: schema.units.breakdown,
  createdAt: schema.units.createdAt,
};

/**
 * `leftJoin` for the two nullable references — the qualification code and the
 * department. An inner join on either would not merely lose a name: it would
 * drop the whole unit from every list, so a company-wide asset with no
 * department would silently cease to exist.
 *
 * The other four are `notNull` foreign keys, so an inner join can never drop a
 * row — and if it ever did, that would be a broken database rather than a query
 * to make lenient.
 */
function unitQuery() {
  return db
    .select(unitColumns)
    .from(schema.units)
    .innerJoin(cls, eq(cls.id, schema.units.classId))
    .innerJoin(typ, eq(typ.id, schema.units.typeId))
    .innerJoin(mdl, eq(mdl.id, schema.units.modelId))
    .innerJoin(brd, eq(brd.id, schema.units.brandId))
    .leftJoin(dpt, eq(dpt.id, schema.units.departmentId))
    .leftJoin(spc, eq(spc.id, schema.units.simperCodeId));
}

type UnitJoinRow = Awaited<ReturnType<typeof unitQuery>>[number];

function toUnit(row: UnitJoinRow) {
  return {
    ...row,
    simperCodeName: row.simperCodeName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/* ------------------------------------------------------- reference resolving */

type Reference = {
  field: string;
  label: string;
  id: string | null | undefined;
  table: NamedCatalogue;
};

/**
 * Confirm every supplied catalogue key exists, and say which one did not.
 *
 * One query per catalogue named, run together. `undefined` means the caller did
 * not mention the field (a PATCH leaving it alone); `null` means it explicitly
 * cleared one of the two optional references — the qualification code or the
 * department — which is allowed.
 */
async function unresolvedReference(
  references: Reference[]
): Promise<{ field: string; message: string } | null> {
  const named = references.filter((r) => typeof r.id === "string");
  const found = await Promise.all(
    named.map(async (r) => {
      const [row] = await db
        .select({ id: r.table.id })
        .from(r.table)
        .where(eq(r.table.id, r.id as string))
        .limit(1);
      return { reference: r, exists: Boolean(row) };
    })
  );
  const missing = found.find((f) => !f.exists);
  if (!missing) return null;
  return {
    field: missing.reference.field,
    // Names the field because a form with six catalogue dropdowns cannot act on
    // "a reference did not resolve".
    message: `${missing.reference.label} yang dipilih tidak ada di master`,
  };
}

function referencesOf(body: {
  classId?: string;
  typeId?: string;
  modelId?: string;
  brandId?: string;
  simperCodeId?: string | null;
  departmentId?: string | null;
}): Reference[] {
  return [
    { field: "classId", label: "Kelas unit", id: body.classId, table: cls },
    { field: "typeId", label: "Jenis unit", id: body.typeId, table: typ },
    { field: "modelId", label: "Model unit", id: body.modelId, table: mdl },
    { field: "brandId", label: "Merk unit", id: body.brandId, table: brd },
    {
      field: "simperCodeId",
      // A permit-type id lands here as "not in the master": `simper_code_id`
      // references `simper_codes`, so the two catalogues cannot be confused
      // (design D4) — the wrong one simply does not resolve.
      label: "Kode SIMPER",
      id: body.simperCodeId,
      table: spc,
    },
    {
      field: "departmentId",
      label: "Departemen",
      id: body.departmentId,
      table: dpt,
    },
  ];
}

/* --------------------------------------------------------- import / export */

/** The join row, in the shape the import engine compares and exports. */
const toExisting = (row: UnitJoinRow): UnitExisting => ({
  id: row.id,
  code: row.code,
  className: row.className,
  typeName: row.typeName,
  departmentId: row.departmentId,
  modelName: row.modelName,
  brandName: row.brandName,
  simperCodeName: row.simperCodeName,
  departmentName: row.departmentName,
  serial: row.serial,
  engineBrand: row.engineBrand,
  description: row.description,
  ftw: row.ftw,
  active: row.active,
});

/** name (lowercased) → row, matching how the `lower(name)` index compares. */
async function catalogueLookup(
  table: NamedCatalogue
): Promise<Map<string, { id: string; name: string }>> {
  const rows = (await db
    .select({ id: table.id, name: table.name })
    .from(table)) as {
    id: string;
    name: string;
  }[];
  return new Map(rows.map((r) => [r.name.toLowerCase(), r]));
}

/**
 * Every department a bare name could mean, keyed by that name lowercased.
 *
 * Not `catalogueLookup`: a department's name is unique only within its company
 * (design D2), so two companies may each hold a `MINING OPERATION` and a
 * name-keyed map would keep whichever row loaded last. The parser gets all of
 * them, plus the company that qualifies each, so an ambiguous cell can be
 * refused with a message naming the choices instead of resolved by accident.
 */
async function departmentLookup(): Promise<Map<string, UnitDepartment[]>> {
  const rows = await db
    .select({ id: dpt.id, name: dpt.name, company: schema.companies.name })
    .from(dpt)
    .innerJoin(schema.companies, eq(schema.companies.id, dpt.companyId));
  const byName = new Map<string, UnitDepartment[]>();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), row]);
  }
  return byName;
}

/**
 * Which catalogue table each addable kind writes to.
 *
 * The five a unit row can reference as a leaf value, and only those: this is
 * what a unit import is allowed to add to, not a general door into the master
 * surface. `departemen` is deliberately absent — a department belongs to a
 * company the unit sheet never names, so an unknown one refuses its row
 * rather than creating a record the `company_id` constraint would reject.
 */
const CREATABLE: Partial<Record<UnitRefKind, NamedCatalogue>> = {
  "kelas-unit": cls,
  "jenis-unit": typ,
  "model-unit": mdl,
  "merk-unit": brd,
  "kode-simper": spc,
};

type UnitRefKind =
  | "kelas-unit"
  | "jenis-unit"
  | "model-unit"
  | "merk-unit"
  | "kode-simper"
  | "departemen";

async function previewUnits(file: File, permissions: EffectivePermissions) {
  const workbook = await readWorkbook(await file.arrayBuffer());
  if ("code" in workbook) return workbook;

  const [classes, types, models, brands, simperCodes, departments] =
    await Promise.all([
      catalogueLookup(cls),
      catalogueLookup(typ),
      catalogueLookup(mdl),
      catalogueLookup(brd),
      catalogueLookup(spc),
      departmentLookup(),
    ]);

  const rows = await unitQuery();
  const existing = new Map(
    rows.map((r) => [r.code.toLowerCase(), toExisting(r)])
  );

  return validateWorkbook(
    file.name,
    unitTarget(
      existing,
      { classes, types, models, brands, simperCodes, departments },
      // `manage` on database-unit is what gets you here; it is not what lets
      // you write into a master. Each catalogue is asked for separately, and a
      // kind the caller cannot manage falls back to the old refusal.
      (kind) => holds(permissions, kind, "manage")
    ),
    workbook
  );
}

/**
 * Create the catalogue records the file referenced, and map each back to its id.
 *
 * `onConflictDoNothing` then re-read, rather than a bare insert: the catalogues
 * were read before the operator confirmed, and a name added in that gap should
 * resolve to the record that now exists instead of failing the whole import on
 * a unique violation.
 */
async function createPendingMasters(
  tx: Transaction,
  pending: PendingMaster[]
): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();
  for (const item of pending) {
    const table = CREATABLE[item.kind as UnitRefKind];
    // Belt and braces: the parser never emits a `departemen` pending entry,
    // and if one ever reached here it would be skipped rather than inserted
    // against the `company_id` the sheet cannot supply.
    if (!table) continue;
    // Cast for the same reason the master routes do: `NamedCatalogue` types the
    // shared columns as `AnyPgColumn`, so a projection over them infers `{}`.
    const [created] = (await tx
      .insert(table)
      .values({ name: item.name })
      .onConflictDoNothing()
      .returning({ id: table.id })) as { id: string }[];
    let id = created?.id;
    if (!id) {
      const [found] = (await tx
        .select({ id: table.id })
        .from(table)
        .where(sql`lower(${table.name}) = ${item.name.toLowerCase()}`)) as {
        id: string;
      }[];
      id = found?.id;
    }
    if (id) byKey.set(refKey(item.kind, item.name), id);
  }
  return byKey;
}

/** Catalogue plus name, lowercased — the same pairing the preview deduped on. */
const refKey = (kind: string, name: string) => `${kind} ${name.toLowerCase()}`;

const validationError = (issue: { field: string; message: string }) => ({
  code: "validation_failed",
  message: issue.message,
  issues: [issue],
});

const unitNotFound = {
  code: "unit_not_found",
  message: "Unit tidak ditemukan",
};

export const unitsRoutes = new Elysia({ prefix: "/units", tags: ["units"] })
  .use(requireAuth)

  .get(
    "/",
    async ({ query }) => {
      const needle = query.q?.trim();
      const filters = [
        // `none` rather than a uuid asks for the units no department owns —
        // company-wide assets, which are a category to filter for and not an
        // absence. No uuid can collide with the literal.
        query.departmentId === undefined || query.departmentId === ""
          ? undefined
          : query.departmentId === UNASSIGNED
            ? isNull(schema.units.departmentId)
            : eq(schema.units.departmentId, query.departmentId),
        query.active === undefined
          ? undefined
          : eq(schema.units.active, query.active),
        query.ftw === undefined ? undefined : eq(schema.units.ftw, query.ftw),
        // Searches the joined names as well as the unit's own columns, because
        // that is what the operator sees in the table they are searching.
        needle
          ? or(
              ilike(schema.units.code, `%${needle}%`),
              ilike(schema.units.serial, `%${needle}%`),
              ilike(schema.units.description, `%${needle}%`),
              ilike(schema.units.engineBrand, `%${needle}%`),
              ilike(mdl.name, `%${needle}%`),
              ilike(brd.name, `%${needle}%`),
              ilike(cls.name, `%${needle}%`),
              ilike(typ.name, `%${needle}%`),
              ilike(spc.name, `%${needle}%`),
              ilike(dpt.name, `%${needle}%`)
            )
          : undefined,
      ].filter((f) => f !== undefined);

      const rows = await unitQuery()
        .where(filters.length ? and(...filters) : undefined)
        .orderBy(asc(schema.units.code));
      return rows.map(toUnit);
    },
    {
      auth: { menu: "database-unit", mode: "view" },
      /**
       * No `classId` or `brandId`: `q` already matches both catalogue names,
       * so a dedicated parameter for each was a second way to ask the same
       * question — and one no caller was left using once the search covered it.
       */
      query: t.Object({
        q: t.Optional(t.String()),
        departmentId: t.Optional(t.String()),
        active: t.Optional(t.Boolean()),
        ftw: t.Optional(t.Boolean()),
      }),
      response: {
        200: t.Array(UnitSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List units with their resolved catalogue names" },
    }
  )

  /* ----------------------------------------------------------- export
     Declared before /:code so "export" is never parsed as a unit code. */

  .get(
    "/export",
    async ({ set }) => {
      const rows = await unitQuery().orderBy(asc(schema.units.code));
      set.headers["content-type"] =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      set.headers["content-disposition"] =
        'attachment; filename="database_unit.xlsx"';
      return new Response(
        new Uint8Array(await unitWorkbook(rows.map(toExisting)))
      );
    },
    {
      auth: { menu: "database-unit", mode: "view" },
      // Described by hand: the body is a binary workbook, and a TypeBox
      // `response` schema would try to validate it as an object.
      detail: {
        summary: "Export the unit registry as a spreadsheet",
        responses: {
          200: {
            description:
              "An .xlsx whose columns are exactly what the unit import accepts",
            content: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                { schema: { type: "string", format: "binary" } },
            },
          },
          401: { description: "No session" },
          403: { description: "Lacks view on database-unit" },
        },
      },
    }
  )

  /** The blank template, distinct from the export above. */
  .get(
    "/import/template",
    async ({ set }) => {
      set.headers["content-type"] =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      set.headers["content-disposition"] =
        'attachment; filename="template_database-unit.xlsx"';
      return new Response(new Uint8Array(await unitTemplate()));
    },
    {
      auth: { menu: "database-unit", mode: "manage" },
      detail: {
        summary: "Download the unit import template (.xlsx)",
        responses: {
          200: {
            description:
              "An .xlsx with the unit import columns and one example row",
            content: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                { schema: { type: "string", format: "binary" } },
            },
          },
          401: { description: "No session" },
          403: { description: "Lacks manage on database-unit" },
        },
      },
    }
  )

  .post(
    "/import/preview",
    async ({ body, permissions, status }) => {
      const result = await previewUnits(body.file, permissions);
      if ("code" in result) return status(422, result);
      return result.preview;
    },
    {
      auth: { menu: "database-unit", mode: "manage" },
      body: t.Object({ file: t.File({ maxSize: MAX_IMPORT_BYTES }) }),
      response: {
        200: MasterImportPreviewSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Preview a unit import — writes nothing" },
    }
  )

  .post(
    "/import",
    async ({ body, permissions, status }) => {
      // Re-parsed rather than trusting the preview the client saw. That is also
      // what re-checks the permissions behind every pending master addition:
      // the confirmation dialog is advisory, this parse decides.
      const result = await previewUnits(body.file, permissions);
      if ("code" in result) return status(422, result);
      if (result.preview.errorCount > 0)
        return status(422, {
          code: "validation_failed",
          message: `${result.preview.errorCount} baris masih bermasalah`,
        });

      let created = 0;
      let updated = 0;
      let mastersCreated = 0;

      // One transaction for the whole file (design D10) — and the catalogue
      // additions belong inside it. A run that fails halfway must not leave a
      // master seeded with types no unit ended up using.
      await db.transaction(async (tx) => {
        const resolved = await createPendingMasters(
          tx,
          result.preview.newMasters
        );
        mastersCreated = resolved.size;

        /**
         * The id, or the one just created for this name.
         *
         * A parsed row carries `null` where the catalogue had no match, which
         * is why nothing before this point could have written it. The name is
         * the only handle either side of the insert, and it is the same
         * lowercased pairing the preview deduped on.
         */
        const idFor = (
          kind: UnitRefKind,
          id: string | null,
          name: string
        ): string => id ?? resolved.get(refKey(kind, name))!;

        for (const row of result.accepted) {
          const p = row.parsed;
          const values = {
            code: p.code,
            classId: idFor("kelas-unit", p.classId, p.className),
            typeId: idFor("jenis-unit", p.typeId, p.typeName),
            modelId: idFor("model-unit", p.modelId, p.modelName),
            brandId: idFor("merk-unit", p.brandId, p.brandName),
            // A null *name* on either optional reference means the column was
            // blank — no qualification required, no owning department — as
            // opposed to a pending one, whose name is what resolves it.
            simperCodeId: p.simperCodeName
              ? idFor("kode-simper", p.simperCodeId, p.simperCodeName)
              : null,
            departmentId: p.departmentName
              ? idFor("departemen", p.departmentId, p.departmentName)
              : null,
            serial: p.serial,
            engineBrand: p.engineBrand,
            description: p.description,
            ftw: p.ftw,
            active: p.active,
          };
          if (row.current) {
            if (!row.changed) continue;
            await tx
              .update(schema.units)
              .set(values)
              .where(eq(schema.units.id, row.current.id));
            updated++;
          } else {
            await tx.insert(schema.units).values(values);
            created++;
          }
        }
      });

      return { created, updated, mastersCreated };
    },
    {
      auth: { menu: "database-unit", mode: "manage" },
      body: t.Object({ file: t.File({ maxSize: MAX_IMPORT_BYTES }) }),
      response: {
        200: MasterImportResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Apply a previewed unit import" },
    }
  )

  .get(
    "/:code",
    async ({ params, status }) => {
      const [row] = await unitQuery()
        .where(eq(schema.units.code, params.code))
        .limit(1);
      if (!row) return status(404, unitNotFound);
      return toUnit(row);
    },
    {
      auth: { menu: "database-unit", mode: "view" },
      params: t.Object({ code: t.String({ minLength: 1 }) }),
      response: {
        200: UnitSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "One unit by its code" },
    }
  )

  .post(
    "/",
    async ({ body, status }) => {
      const issue = await unresolvedReference(referencesOf(body));
      if (issue) return status(422, validationError(issue));

      const code = body.code.trim().toUpperCase();
      try {
        const [created] = await db
          .insert(schema.units)
          .values({
            code,
            classId: body.classId,
            typeId: body.typeId,
            modelId: body.modelId,
            brandId: body.brandId,
            simperCodeId: body.simperCodeId ?? null,
            departmentId: body.departmentId ?? null,
            serial: body.serial?.trim() ?? "",
            engineBrand: body.engineBrand?.trim() ?? "",
            description: body.description?.trim() ?? "",
            ftw: body.ftw ?? false,
            active: body.active ?? true,
            standby: body.standby ?? false,
            breakdown: body.breakdown ?? false,
          })
          .returning({ id: schema.units.id });
        const [row] = await unitQuery()
          .where(eq(schema.units.id, created!.id))
          .limit(1);
        return status(201, toUnit(row!));
      } catch (error) {
        if (isUniqueViolation(error))
          return status(409, {
            code: "unit_exists",
            message: `Unit ${code} sudah terdaftar`,
          });
        throw error;
      }
    },
    {
      auth: { menu: "database-unit", mode: "manage" },
      body: t.Object({
        code: t.String({ minLength: 1 }),
        classId: t.String({ format: "uuid" }),
        typeId: t.String({ format: "uuid" }),
        modelId: t.String({ format: "uuid" }),
        brandId: t.String({ format: "uuid" }),
        simperCodeId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
        // Optional like the qualification code: a unit no department owns is a
        // company-wide asset, not an unfinished record.
        departmentId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
        serial: t.Optional(t.String()),
        engineBrand: t.Optional(t.String()),
        description: t.Optional(t.String()),
        ftw: t.Optional(t.Boolean()),
        active: t.Optional(t.Boolean()),
        standby: t.Optional(t.Boolean()),
        breakdown: t.Optional(t.Boolean()),
      }),
      response: {
        201: UnitSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: t.Object({
          code: t.String(),
          message: t.String(),
          issues: t.Array(t.Object({ field: t.String(), message: t.String() })),
        }),
      },
      detail: { summary: "Create a unit" },
    }
  )

  .patch(
    "/:code",
    async ({ params, body, status }) => {
      const issue = await unresolvedReference(referencesOf(body));
      if (issue) return status(422, validationError(issue));

      try {
        const [updated] = await db
          .update(schema.units)
          .set({
            ...(body.code !== undefined
              ? { code: body.code.trim().toUpperCase() }
              : {}),
            ...(body.classId !== undefined ? { classId: body.classId } : {}),
            ...(body.typeId !== undefined ? { typeId: body.typeId } : {}),
            ...(body.modelId !== undefined ? { modelId: body.modelId } : {}),
            ...(body.brandId !== undefined ? { brandId: body.brandId } : {}),
            // `null` clears it — no qualification required, no owning
            // department; absent leaves it alone.
            ...(body.simperCodeId !== undefined
              ? { simperCodeId: body.simperCodeId }
              : {}),
            ...(body.departmentId !== undefined
              ? { departmentId: body.departmentId }
              : {}),
            ...(body.serial !== undefined
              ? { serial: body.serial.trim() }
              : {}),
            ...(body.engineBrand !== undefined
              ? { engineBrand: body.engineBrand.trim() }
              : {}),
            ...(body.description !== undefined
              ? { description: body.description.trim() }
              : {}),
            ...(body.ftw !== undefined ? { ftw: body.ftw } : {}),
            ...(body.active !== undefined ? { active: body.active } : {}),
            ...(body.standby !== undefined ? { standby: body.standby } : {}),
            ...(body.breakdown !== undefined
              ? { breakdown: body.breakdown }
              : {}),
          })
          .where(eq(schema.units.code, params.code))
          .returning({ id: schema.units.id });
        if (!updated) return status(404, unitNotFound);
        const [row] = await unitQuery()
          .where(eq(schema.units.id, updated.id))
          .limit(1);
        return toUnit(row!);
      } catch (error) {
        if (isUniqueViolation(error))
          return status(409, {
            code: "unit_exists",
            message: `Unit ${body.code ?? params.code} sudah terdaftar`,
          });
        throw error;
      }
    },
    {
      auth: { menu: "database-unit", mode: "manage" },
      params: t.Object({ code: t.String({ minLength: 1 }) }),
      body: t.Object({
        code: t.Optional(t.String({ minLength: 1 })),
        classId: t.Optional(t.String({ format: "uuid" })),
        typeId: t.Optional(t.String({ format: "uuid" })),
        modelId: t.Optional(t.String({ format: "uuid" })),
        brandId: t.Optional(t.String({ format: "uuid" })),
        simperCodeId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
        departmentId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
        serial: t.Optional(t.String()),
        engineBrand: t.Optional(t.String()),
        description: t.Optional(t.String()),
        ftw: t.Optional(t.Boolean()),
        active: t.Optional(t.Boolean()),
        standby: t.Optional(t.Boolean()),
        breakdown: t.Optional(t.Boolean()),
      }),
      response: {
        200: UnitSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        422: t.Object({
          code: t.String(),
          message: t.String(),
          issues: t.Array(t.Object({ field: t.String(), message: t.String() })),
        }),
      },
      detail: { summary: "Edit a unit" },
    }
  )

  /**
   * Delete a hand-picked selection — deliberately *not* all-or-nothing, for the
   * same reason the master catalogues' bulk delete is not (see `master.ts`).
   * These units were ticked one by one, and the response names every one that
   * was refused, so a partial result is legible rather than mysterious.
   *
   * One statement per code, because in Postgres a foreign-key violation aborts
   * the surrounding transaction — a set delete could only ever be all-or-nothing.
   *
   * `POST …/bulk-delete` rather than `DELETE /units`: the latter reads as
   * "delete the registry", and Eden Treaty cannot address a path segment named
   * `delete` without colliding with the HTTP verb.
   */
  .post(
    "/bulk-delete",
    async ({ body }) => {
      // Distinct and normalised the same way a single delete is, so a caller
      // sending the same unit twice cannot inflate the count it gets back.
      const codes = [...new Set(body.codes.map((c) => c.trim().toUpperCase()))];

      let deleted = 0;
      const blocked: { code: string; reason: string }[] = [];

      for (const code of codes) {
        try {
          // A code that matches nothing counts as deleted: the end state the
          // caller asked for holds, and a stale list should not read as failure.
          await db.delete(schema.units).where(eq(schema.units.code, code));
          deleted++;
        } catch (error) {
          if (!isForeignKeyViolation(error)) throw error;
          blocked.push({
            code,
            // The only referrer today is a bus schedule (design D6), and the
            // schedule is one delete away — so the message says which, not
            // "this is referenced by something".
            reason: "Masih punya jadwal bus",
          });
        }
      }

      return { deleted, blocked };
    },
    {
      auth: { menu: "database-unit", mode: "manage" },
      body: t.Object({
        codes: t.Array(t.String({ minLength: 1 }), {
          minItems: 1,
          maxItems: 200,
        }),
      }),
      response: {
        200: UnitBulkDeleteResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Delete several units at once" },
    }
  )

  .delete(
    "/:code",
    async ({ params, status }) => {
      try {
        const [row] = await db
          .delete(schema.units)
          .where(eq(schema.units.code, params.code))
          .returning({ id: schema.units.id });
        if (!row) return status(404, unitNotFound);
        return { ok: true };
      } catch (error) {
        if (!isForeignKeyViolation(error)) throw error;
        // Today the only referrer is a bus schedule; the message says so rather
        // than guessing, and the schedule is one delete away.
        return status(409, {
          code: "unit_in_use",
          message:
            "Unit masih punya jadwal bus — hapus jadwalnya dulu, atau nonaktifkan unitnya",
        });
      }
    },
    {
      auth: { menu: "database-unit", mode: "manage" },
      params: t.Object({ code: t.String({ minLength: 1 }) }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
      },
      detail: { summary: "Delete a unit" },
    }
  );

/* ------------------------------------------------------------ bus schedules */

const busColumns = {
  id: schema.busSchedules.id,
  unitId: schema.busSchedules.unitId,
  unitCode: schema.units.code,
  departAt: schema.busSchedules.departAt,
  active: schema.busSchedules.active,
  createdAt: schema.busSchedules.createdAt,
};

function busQuery() {
  return db
    .select(busColumns)
    .from(schema.busSchedules)
    .innerJoin(schema.units, eq(schema.units.id, schema.busSchedules.unitId));
}

/** Postgres `time` reads back as "HH:MM:SS"; the schedule is to the minute. */
const toBus = (row: Awaited<ReturnType<typeof busQuery>>[number]) => ({
  ...row,
  departAt: row.departAt.slice(0, 5),
  createdAt: row.createdAt.toISOString(),
});

/** The ids of units whose type is BUS — the only units a schedule may name. */
async function busUnitIds(): Promise<string[]> {
  const rows = await db
    .select({ id: schema.units.id })
    .from(schema.units)
    .innerJoin(schema.unitTypes, eq(schema.unitTypes.id, schema.units.typeId))
    .where(sql`upper(${schema.unitTypes.name}) = ${BUS_TYPE_NAME}`);
  return rows.map((r) => r.id);
}

const notABus = {
  code: "unit_not_bus",
  message: "Jadwal bus hanya untuk unit berjenis BUS",
};

export const busSchedulesRoutes = new Elysia({
  prefix: "/bus-schedules",
  tags: ["bus"],
})
  .use(requireAuth)

  .get(
    "/",
    async () => {
      const rows = await busQuery().orderBy(asc(schema.busSchedules.departAt));
      return rows.map(toBus);
    },
    {
      auth: { menu: "bus", mode: "view" },
      response: {
        200: t.Array(BusScheduleSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List bus departure schedules" },
    }
  )

  /**
   * The units a schedule may be created for. Its own route rather than a filter
   * on /units, because the Bus menu needs it to render an empty state and the
   * `bus` grant is what governs that screen — not `database-unit`.
   */
  .get(
    "/units",
    async () => {
      const ids = await busUnitIds();
      if (!ids.length) return [];
      const rows = await unitQuery().where(inArray(schema.units.id, ids));
      return rows.map(toUnit);
    },
    {
      auth: { menu: "bus", mode: "view" },
      response: {
        200: t.Array(UnitSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "Units of type BUS, eligible for a schedule" },
    }
  )

  .post(
    "/",
    async ({ body, status }) => {
      if (!(await busUnitIds()).includes(body.unitId))
        return status(422, notABus);
      try {
        const [created] = await db
          .insert(schema.busSchedules)
          .values({
            unitId: body.unitId,
            departAt: `${body.departAt}:00`,
            active: body.active ?? true,
          })
          .returning({ id: schema.busSchedules.id });
        const [row] = await busQuery()
          .where(eq(schema.busSchedules.id, created!.id))
          .limit(1);
        return status(201, toBus(row!));
      } catch (error) {
        // `unit_id` is unique: a bus has one departure time, so a second row is
        // a conflict rather than a second schedule (design D6).
        if (isUniqueViolation(error))
          return status(409, {
            code: "bus_schedule_exists",
            message: "Unit ini sudah punya jadwal keberangkatan",
          });
        throw error;
      }
    },
    {
      auth: { menu: "bus", mode: "manage" },
      body: t.Object({
        unitId: t.String({ format: "uuid" }),
        departAt: t.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" }),
        active: t.Optional(t.Boolean()),
      }),
      response: {
        201: BusScheduleSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Schedule a bus departure" },
    }
  )

  .patch(
    "/:id",
    async ({ params, body, status }) => {
      const [updated] = await db
        .update(schema.busSchedules)
        .set({
          ...(body.departAt !== undefined
            ? { departAt: `${body.departAt}:00` }
            : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        })
        .where(eq(schema.busSchedules.id, params.id))
        .returning({ id: schema.busSchedules.id });
      if (!updated)
        return status(404, {
          code: "bus_schedule_not_found",
          message: "Jadwal tidak ditemukan",
        });
      const [row] = await busQuery()
        .where(eq(schema.busSchedules.id, updated.id))
        .limit(1);
      return toBus(row!);
    },
    {
      auth: { menu: "bus", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        departAt: t.Optional(
          t.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" })
        ),
        active: t.Optional(t.Boolean()),
      }),
      response: {
        200: BusScheduleSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Change a bus departure time" },
    }
  )

  .delete(
    "/:id",
    async ({ params, status }) => {
      const [row] = await db
        .delete(schema.busSchedules)
        .where(eq(schema.busSchedules.id, params.id))
        .returning({ id: schema.busSchedules.id });
      if (!row)
        return status(404, {
          code: "bus_schedule_not_found",
          message: "Jadwal tidak ditemukan",
        });
      return { ok: true };
    },
    {
      auth: { menu: "bus", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Remove a bus departure schedule" },
    }
  );
