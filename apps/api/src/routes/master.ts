/**
 * The nine master catalogues, behind one generic route surface (design D3).
 *
 * D1 gives each catalogue its own table, so a foreign key into it constrains
 * something real. D3 is the compromise that keeps that from multiplying
 * upwards: the tables are nine, the handlers are one. `KIND_TABLES` resolves a
 * `:kind` to its table, its column projection, and how a reference to it is
 * counted, and the handler body is written once.
 *
 * Authorization is per catalogue, not per group. The macro can only gate on a
 * statically declared menu list, so the route declares all nine and the handler
 * then narrows to the *requested* one — the same shape `devices.ts` uses to
 * stop a fleet-board grant revoking an attendance TV. Declaring the union alone
 * would let `manage` on `kelas-unit` create a department.
 */

import { asc, eq, inArray, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  MASTER_KINDS,
  type AccessMode,
  type EffectivePermissions,
  type MasterKind,
  type MenuSlug,
} from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import {
  db,
  isForeignKeyViolation,
  isUniqueViolation,
  schema,
  type NamedCatalogue,
} from "../db";
import {
  catalogueTarget,
  catalogueTemplate,
  catalogueWorkbook,
  MAX_IMPORT_BYTES,
  readWorkbook,
  validateWorkbook,
  type CatalogueExisting,
} from "./master-import";
import {
  ErrorSchema,
  MasterBulkDeleteResultSchema,
  MasterImportPreviewSchema,
  MasterImportResultSchema,
  MasterKindSchema,
  MasterRecordSchema,
  OptionalAreaTypeSchema,
} from "./schemas";

/**
 * Which menu owns which catalogue.
 *
 * Today every kind is also its own menu slug, so this is the identity map —
 * written out rather than derived, because "the kind happens to equal the slug"
 * is a coincidence of naming, and the day a catalogue is governed by a menu of
 * a different name this file should need one line changed rather than a rework.
 */
const MENU_OF_KIND: Record<MasterKind, MenuSlug> = {
  "jenis-unit": "jenis-unit",
  "model-unit": "model-unit",
  "merk-unit": "merk-unit",
  "kelas-unit": "kelas-unit",
  simper: "simper",
  "kode-simper": "kode-simper",
  departemen: "departemen",
  "area-kerja": "area-kerja",
  mess: "mess",
};

/** Any master grant opens the surface; the handler narrows to the kind asked for. */
const MASTER_MENUS: MenuSlug[] = MASTER_KINDS.map((k) => MENU_OF_KIND[k]);

type KindConfig = {
  table: NamedCatalogue;
  /** Which optional column this catalogue carries, if any. */
  extra: "none" | "description" | "type";
  /**
   * How many rows point at this one. `null` where nothing references the
   * catalogue yet — work areas, mess, and permit types are all waiting on the
   * `employees` table (design D13), so a foreign-key violation on them is
   * currently impossible rather than merely unlikely.
   */
  countReferences: ((id: string) => Promise<number>) | null;
};

/** Units are the only referrer that exists today. */
const unitsReferencing = (column: AnyPgColumn) => async (id: string) => {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.units)
    .where(eq(column, id));
  return row?.count ?? 0;
};

const KIND_TABLES: Record<MasterKind, KindConfig> = {
  "jenis-unit": {
    table: schema.unitTypes,
    extra: "none",
    countReferences: unitsReferencing(schema.units.typeId),
  },
  "model-unit": {
    table: schema.unitModels,
    extra: "none",
    countReferences: unitsReferencing(schema.units.modelId),
  },
  "merk-unit": {
    table: schema.unitBrands,
    extra: "none",
    countReferences: unitsReferencing(schema.units.brandId),
  },
  "kelas-unit": {
    table: schema.unitClasses,
    extra: "description",
    countReferences: unitsReferencing(schema.units.classId),
  },
  simper: {
    table: schema.simperTypes,
    extra: "description",
    countReferences: null,
  },
  "kode-simper": {
    table: schema.simperCodes,
    extra: "description",
    countReferences: unitsReferencing(schema.units.simperCodeId),
  },
  departemen: {
    table: schema.departments,
    extra: "description",
    countReferences: unitsReferencing(schema.units.departmentId),
  },
  "area-kerja": {
    table: schema.workAreas,
    extra: "type",
    countReferences: null,
  },
  mess: { table: schema.mess, extra: "none", countReferences: null },
};

/**
 * The columns a kind projects — never `select *`, so a column added to a
 * catalogue reaches the wire only once someone decides it should.
 *
 * The two casts are the price of one handler over nine tables: `NamedCatalogue`
 * describes only the four columns every catalogue shares, and `extra` is what
 * says whether this particular one also has `description` or `type`. The map
 * and the table definitions are the pairing that keeps them honest.
 */
function projection(config: KindConfig): Record<string, AnyPgColumn> {
  const table = config.table;
  const extras: Record<string, AnyPgColumn> =
    config.extra === "description"
      ? {
          description: (table as unknown as { description: AnyPgColumn })
            .description,
        }
      : config.extra === "type"
        ? { type: (table as unknown as { type: AnyPgColumn }).type }
        : {};
  return {
    id: table.id,
    name: table.name,
    active: table.active,
    createdAt: table.createdAt,
    ...extras,
  };
}

type CatalogueRow = {
  id: string;
  name: string;
  active: boolean;
  createdAt: Date;
  description?: string;
  type?: string;
};

type MasterRecord = (typeof MasterRecordSchema)["static"];

function toRecord(row: CatalogueRow): MasterRecord {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    ...(row.description !== undefined ? { description: row.description } : {}),
    ...(row.type !== undefined ? { type: row.type } : {}),
  } as MasterRecord;
}

/** `manage` satisfies `view`; `view` never satisfies `manage`. */
function holds(
  permissions: EffectivePermissions,
  kind: MasterKind,
  mode: AccessMode
): boolean {
  const held = permissions[MENU_OF_KIND[kind]];
  if (held === undefined) return false;
  return mode === "view" ? true : held === "manage";
}

/* --------------------------------------------------------- import / export */

/** Every row of a catalogue, in the shape the import engine compares against. */
async function catalogueRows(config: KindConfig): Promise<CatalogueExisting[]> {
  const rows = (await db
    .select(projection(config))
    .from(config.table)
    .orderBy(asc(config.table.name))) as CatalogueRow[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    type: r.type,
    active: r.active,
  }));
}

/** Keyed lowercase, which is the comparison the `lower(name)` index enforces. */
async function catalogueMap(
  config: KindConfig
): Promise<Map<string, CatalogueExisting>> {
  const rows = await catalogueRows(config);
  return new Map(rows.map((r) => [r.name.toLowerCase(), r]));
}

async function previewCatalogue(kind: MasterKind, file: File) {
  const workbook = await readWorkbook(await file.arrayBuffer());
  if ("code" in workbook) return workbook;
  const config = KIND_TABLES[kind];
  return validateWorkbook(
    file.name,
    catalogueTarget(kind, config.extra, await catalogueMap(config)),
    workbook
  );
}

const forbidden = (kind: MasterKind) => ({
  code: "forbidden",
  message: `Tidak punya akses ke master ${MENU_OF_KIND[kind]}`,
});

const notFound = { code: "master_not_found", message: "Data tidak ditemukan" };

const duplicate = (name: string) => ({
  code: "master_exists",
  message: `"${name}" sudah ada di master ini`,
});

export const masterRoutes = new Elysia({
  prefix: "/master",
  tags: ["master"],
})
  .use(requireAuth)

  .get(
    "/:kind",
    async ({ params, query, permissions, status }) => {
      if (!holds(permissions, params.kind, "view"))
        return status(403, forbidden(params.kind));

      const config = KIND_TABLES[params.kind];
      const rows = (await db
        .select(projection(config))
        .from(config.table)
        .where(
          query.active === undefined
            ? undefined
            : eq(config.table.active, query.active)
        )
        .orderBy(asc(config.table.name))) as CatalogueRow[];
      return rows.map(toRecord);
    },
    {
      auth: { menu: MASTER_MENUS, mode: "view" },
      params: t.Object({ kind: MasterKindSchema }),
      // `active=true` is what a selection list asks for; the management screen
      // omits it and sees inactive rows too (spec: an inactive record stays
      // visible where it is managed, and disappears where it is chosen).
      query: t.Object({ active: t.Optional(t.Boolean()) }),
      response: {
        200: t.Array(MasterRecordSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List a master catalogue" },
    }
  )

  .post(
    "/:kind",
    async ({ params, body, permissions, status }) => {
      if (!holds(permissions, params.kind, "manage"))
        return status(403, forbidden(params.kind));

      const config = KIND_TABLES[params.kind];
      const name = body.name.trim();
      if (!name)
        return status(422, {
          code: "validation_failed",
          message: "Nama tidak boleh kosong",
        });
      if (config.extra === "type" && body.type === undefined)
        return status(422, {
          code: "validation_failed",
          message: "Tipe area wajib diisi",
        });

      try {
        const [row] = (await db
          .insert(config.table)
          .values({
            name,
            active: body.active ?? true,
            ...(config.extra === "description"
              ? { description: body.description?.trim() ?? "" }
              : {}),
            ...(config.extra === "type" ? { type: body.type } : {}),
          })
          .returning(projection(config))) as CatalogueRow[];
        return status(201, toRecord(row!));
      } catch (error) {
        // The unique index is over lower(name), so this is exactly the
        // case-insensitive duplicate the catalogue refuses (design D11).
        if (isUniqueViolation(error)) return status(409, duplicate(name));
        throw error;
      }
    },
    {
      auth: { menu: MASTER_MENUS, mode: "manage" },
      params: t.Object({ kind: MasterKindSchema }),
      body: t.Object({
        name: t.String({ minLength: 1 }),
        description: t.Optional(t.String()),
        type: OptionalAreaTypeSchema,
        active: t.Optional(t.Boolean()),
      }),
      response: {
        201: MasterRecordSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Create a master catalogue record" },
    }
  )

  /* ----------------------------------------------------------- export
     Declared before /:kind/:id so "export" is never parsed as a record id. */

  .get(
    "/:kind/export",
    async ({ params, permissions, set, status }) => {
      if (!holds(permissions, params.kind, "view"))
        return status(403, forbidden(params.kind));

      const config = KIND_TABLES[params.kind];
      const rows = await catalogueRows(config);
      set.headers["content-type"] =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      set.headers["content-disposition"] =
        `attachment; filename="${params.kind}.xlsx"`;
      return new Response(
        new Uint8Array(await catalogueWorkbook(params.kind, config.extra, rows))
      );
    },
    {
      auth: { menu: MASTER_MENUS, mode: "view" },
      params: t.Object({ kind: MasterKindSchema }),
      // Described by hand rather than with a `response` schema: the body is a
      // binary workbook, and TypeBox would try to validate it as an object.
      detail: {
        summary: "Export a catalogue as a spreadsheet",
        responses: {
          200: {
            description:
              "An .xlsx whose columns are exactly what this kind's import accepts",
            content: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                { schema: { type: "string", format: "binary" } },
            },
          },
          401: { description: "No session" },
          403: { description: "Lacks view on this catalogue's menu" },
        },
      },
    }
  )

  /**
   * The blank template, distinct from the export above.
   *
   * `manage` rather than `view`, matching the account template: a template is
   * only useful to someone who may import, and the account import already sets
   * that precedent.
   */
  .get(
    "/:kind/import/template",
    async ({ params, permissions, set, status }) => {
      if (!holds(permissions, params.kind, "manage"))
        return status(403, forbidden(params.kind));
      set.headers["content-type"] =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      set.headers["content-disposition"] =
        `attachment; filename="template_${params.kind}.xlsx"`;
      return new Response(new Uint8Array(await catalogueTemplate(params.kind)));
    },
    {
      auth: { menu: MASTER_MENUS, mode: "manage" },
      params: t.Object({ kind: MasterKindSchema }),
      // Described by hand: the body is a binary workbook, and a TypeBox
      // `response` schema would try to validate it as an object.
      detail: {
        summary: "Download this catalogue's import template (.xlsx)",
        responses: {
          200: {
            description:
              "An .xlsx with this kind's import columns and one example row",
            content: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                { schema: { type: "string", format: "binary" } },
            },
          },
          401: { description: "No session" },
          403: { description: "Lacks manage on this catalogue's menu" },
        },
      },
    }
  )

  .post(
    "/:kind/import/preview",
    async ({ params, body, permissions, status }) => {
      if (!holds(permissions, params.kind, "manage"))
        return status(403, forbidden(params.kind));
      const result = await previewCatalogue(params.kind, body.file);
      if ("code" in result) return status(422, result);
      return result.preview;
    },
    {
      auth: { menu: MASTER_MENUS, mode: "manage" },
      params: t.Object({ kind: MasterKindSchema }),
      body: t.Object({ file: t.File({ maxSize: MAX_IMPORT_BYTES }) }),
      response: {
        200: MasterImportPreviewSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: {
        summary: "Preview a catalogue import — writes nothing",
      },
    }
  )

  .post(
    "/:kind/import",
    async ({ params, body, permissions, status }) => {
      if (!holds(permissions, params.kind, "manage"))
        return status(403, forbidden(params.kind));

      // Re-parsed rather than trusting a preview handed back by the client: the
      // preview the caller saw is advisory, this parse is what gets written.
      const result = await previewCatalogue(params.kind, body.file);
      if ("code" in result) return status(422, result);
      if (result.preview.errorCount > 0)
        return status(422, {
          code: "validation_failed",
          message: `${result.preview.errorCount} baris masih bermasalah`,
        });

      const config = KIND_TABLES[params.kind];
      let created = 0;
      let updated = 0;

      // One transaction for the whole file (design D10). A partially applied
      // import of a thousand rows is worse than a rejected one, because the
      // operator cannot tell which half landed.
      await db.transaction(async (tx) => {
        for (const row of result.accepted) {
          const values: Record<string, unknown> = {
            name: row.parsed.name,
            active: row.parsed.active,
            ...(config.extra === "description"
              ? { description: row.parsed.description ?? "" }
              : {}),
            ...(config.extra === "type" ? { type: row.parsed.type } : {}),
          };
          if (row.current) {
            // An unchanged row is skipped rather than rewritten, which is what
            // makes re-importing an untouched export report zero changed.
            if (!row.changed) continue;
            await tx
              .update(config.table)
              .set(values)
              .where(eq(config.table.id, row.current.id));
            updated++;
          } else {
            await tx.insert(config.table).values(values);
            created++;
          }
        }
      });

      // `mastersCreated` is the unit import's concern — a catalogue import has
      // no references to satisfy, so it never creates anything but its own rows.
      return { created, updated, mastersCreated: 0 };
    },
    {
      auth: { menu: MASTER_MENUS, mode: "manage" },
      params: t.Object({ kind: MasterKindSchema }),
      body: t.Object({ file: t.File({ maxSize: MAX_IMPORT_BYTES }) }),
      response: {
        200: MasterImportResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Apply a previewed catalogue import" },
    }
  )

  /**
   * Delete a hand-picked selection — deliberately *not* all-or-nothing.
   *
   * The import above commits in one transaction because an operator cannot tell
   * which half of a thousand-row file landed. That reasoning does not carry
   * here: these rows were picked by hand, and the response names every one that
   * was refused. Rolling the whole selection back because a single entry is
   * still referenced would make deleting nine unused records depend on finding
   * the tenth by trial.
   *
   * Hence one statement per id rather than a single `delete … in (…)`: in
   * Postgres a foreign-key violation aborts the surrounding transaction, so a
   * set delete can only ever be all-or-nothing. The per-id loop is what buys
   * partial success, and the cost is bounded by `maxItems`.
   *
   * `POST /:kind/bulk-delete`, not `DELETE /:kind`: the latter reads as "delete
   * this catalogue", and bodies on DELETE are poorly supported by proxies.
   */
  .post(
    "/:kind/bulk-delete",
    async ({ params, body, permissions, status }) => {
      if (!holds(permissions, params.kind, "manage"))
        return status(403, forbidden(params.kind));

      const config = KIND_TABLES[params.kind];
      // Distinct, so a client that sends the same id twice cannot inflate the
      // count it gets back.
      const ids = [...new Set(body.ids)];

      const existing = (await db
        .select({ id: config.table.id, name: config.table.name })
        .from(config.table)
        .where(inArray(config.table.id, ids))) as {
        id: string;
        name: string;
      }[];
      const nameById = new Map(existing.map((r) => [r.id, r.name]));

      let deleted = 0;
      const blocked: { id: string; name: string; references: number }[] = [];

      for (const id of ids) {
        const name = nameById.get(id);
        // Already gone — a concurrent delete, or a list the caller had open for
        // a while. The end state asked for holds, so it counts as deleted
        // rather than as a 404 that would make the whole call look failed.
        if (name === undefined) {
          deleted++;
          continue;
        }
        try {
          await db.delete(config.table).where(eq(config.table.id, id));
          deleted++;
        } catch (error) {
          if (!isForeignKeyViolation(error)) throw error;
          blocked.push({
            id,
            name,
            references: (await config.countReferences?.(id)) ?? 0,
          });
        }
      }

      return { deleted, blocked };
    },
    {
      auth: { menu: MASTER_MENUS, mode: "manage" },
      params: t.Object({ kind: MasterKindSchema }),
      body: t.Object({
        ids: t.Array(t.String({ format: "uuid" }), {
          minItems: 1,
          maxItems: 200,
        }),
      }),
      response: {
        200: MasterBulkDeleteResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Delete several master catalogue records at once" },
    }
  )

  .patch(
    "/:kind/:id",
    async ({ params, body, permissions, status }) => {
      if (!holds(permissions, params.kind, "manage"))
        return status(403, forbidden(params.kind));

      const config = KIND_TABLES[params.kind];
      const name = body.name?.trim();
      if (body.name !== undefined && !name)
        return status(422, {
          code: "validation_failed",
          message: "Nama tidak boleh kosong",
        });

      try {
        const [row] = (await db
          .update(config.table)
          .set({
            ...(name !== undefined ? { name } : {}),
            ...(body.active !== undefined ? { active: body.active } : {}),
            ...(config.extra === "description" && body.description !== undefined
              ? { description: body.description.trim() }
              : {}),
            ...(config.extra === "type" && body.type !== undefined
              ? { type: body.type }
              : {}),
          })
          .where(eq(config.table.id, params.id))
          .returning(projection(config))) as CatalogueRow[];
        if (!row) return status(404, notFound);
        return toRecord(row);
      } catch (error) {
        if (isUniqueViolation(error)) return status(409, duplicate(name ?? ""));
        throw error;
      }
    },
    {
      auth: { menu: MASTER_MENUS, mode: "manage" },
      params: t.Object({
        kind: MasterKindSchema,
        id: t.String({ format: "uuid" }),
      }),
      body: t.Object({
        name: t.Optional(t.String()),
        description: t.Optional(t.String()),
        type: OptionalAreaTypeSchema,
        active: t.Optional(t.Boolean()),
      }),
      response: {
        200: MasterRecordSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Edit a master catalogue record" },
    }
  )

  .delete(
    "/:kind/:id",
    async ({ params, permissions, status }) => {
      if (!holds(permissions, params.kind, "manage"))
        return status(403, forbidden(params.kind));

      const config = KIND_TABLES[params.kind];
      try {
        const [row] = await db
          .delete(config.table)
          .where(eq(config.table.id, params.id))
          .returning({ id: config.table.id });
        if (!row) return status(404, notFound);
        return { ok: true };
      } catch (error) {
        if (!isForeignKeyViolation(error)) throw error;
        // The database already refused it; the count is read only to say how
        // many, which is the difference between "cannot delete" and a message
        // an operator can act on.
        const count = (await config.countReferences?.(params.id)) ?? 0;
        return status(409, {
          code: "master_in_use",
          message: `Masih dipakai oleh ${count} unit — nonaktifkan saja bila sudah tidak terpakai`,
        });
      }
    },
    {
      auth: { menu: MASTER_MENUS, mode: "manage" },
      params: t.Object({
        kind: MasterKindSchema,
        id: t.String({ format: "uuid" }),
      }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
      },
      detail: { summary: "Delete a master catalogue record" },
    }
  );

/* Re-exported so the unit, import, and export routes resolve a kind the same
   way this one does rather than keeping a second copy of the mapping. */
export { holds, KIND_TABLES, MASTER_MENUS, MENU_OF_KIND, projection, toRecord };
export type { CatalogueRow, KindConfig };
