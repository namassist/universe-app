/**
 * Fleet composition — a digger, its haulers, a work area, and optionally a
 * crew bus.
 *
 * The digger *is* the fleet's identity (there is no name column; every screen
 * says "Fleet EX8001"), so leading twice is a unique violation rather than a
 * rule this file remembers to check. Member exclusivity is likewise the
 * `fleet_units.unit_id` unique index — the prechecks below exist to name the
 * offending unit in the refusal, and the index catches what a race slips past
 * them.
 *
 * What the route enforces beyond the schema: the work area is of type Mining
 * (a fleet operates in the pit), the bus is a unit of type BUS, the digger is
 * not offered as its own hauler, and the member list stays within the shared
 * bounds. What it deliberately does NOT enforce: "digger-ness" of the leader.
 * The catalogues carry no fleet-leader flag — the screen derives it from type
 * and class as a heuristic, and a heuristic is not a thing to refuse on.
 */

import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Elysia, t } from "elysia";
import {
  FLEET_MAX_UNITS,
  FLEET_MIN_UNITS,
  FLEET_TRANSPORT_TYPES_TEXT,
  isFleetTransportType,
  type FleetImportPreview,
} from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { db, isUniqueViolation, schema } from "../db";
import { isNotFleetConfigured } from "../fleet-scope";
import {
  buildTemplate,
  validateFleetWorkbook,
  type FleetCatalogues,
  type ParsedFleetRow,
} from "./fleets-import";
import { MAX_IMPORT_BYTES } from "./import-columns";
import {
  ErrorSchema,
  FleetImportPreviewSchema,
  FleetSchema,
  ImportResultSchema,
  NoFleetSchema,
} from "./schemas";

const digger = alias(schema.units, "digger_unit");
const bus = alias(schema.units, "bus_unit");

const fleetColumns = {
  id: schema.fleets.id,
  diggerUnitId: schema.fleets.diggerUnitId,
  diggerCode: digger.code,
  workAreaId: schema.fleets.workAreaId,
  workAreaName: schema.workAreas.name,
  busUnitId: schema.fleets.busUnitId,
  busCode: bus.code,
  active: schema.fleets.active,
  createdAt: schema.fleets.createdAt,
};

function fleetQuery() {
  return db
    .select(fleetColumns)
    .from(schema.fleets)
    .innerJoin(digger, eq(digger.id, schema.fleets.diggerUnitId))
    .innerJoin(
      schema.workAreas,
      eq(schema.workAreas.id, schema.fleets.workAreaId)
    )
    .leftJoin(bus, eq(bus.id, schema.fleets.busUnitId));
}

type FleetRow = Awaited<ReturnType<typeof fleetQuery>>[number];

/** Member codes for a set of fleets, one query however many fleets. */
async function membersOf(
  fleetIds: string[]
): Promise<Map<string, { id: string; code: string }[]>> {
  const map = new Map<string, { id: string; code: string }[]>(
    fleetIds.map((id) => [id, []])
  );
  if (!fleetIds.length) return map;
  const rows = await db
    .select({
      fleetId: schema.fleetUnits.fleetId,
      id: schema.units.id,
      code: schema.units.code,
    })
    .from(schema.fleetUnits)
    .innerJoin(schema.units, eq(schema.units.id, schema.fleetUnits.unitId))
    .where(inArray(schema.fleetUnits.fleetId, fleetIds))
    .orderBy(asc(schema.units.code));
  for (const row of rows)
    map.get(row.fleetId)?.push({ id: row.id, code: row.code });
  return map;
}

function toFleet(row: FleetRow, units: { id: string; code: string }[]) {
  return {
    id: row.id,
    diggerUnitId: row.diggerUnitId,
    diggerCode: row.diggerCode,
    workAreaId: row.workAreaId,
    workAreaName: row.workAreaName,
    busUnitId: row.busUnitId,
    busCode: row.busCode,
    units,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

const notFound = { code: "fleet_not_found", message: "Fleet tidak ditemukan" };

const invalid = (message: string) => ({ code: "validation_failed", message });

/**
 * Everything a create or edit has to agree with, checked in one place.
 *
 * Returns the refusal message, or null when the composition is sound. The
 * caller passes its own fleet id on edit so the checks do not refuse a fleet
 * for holding the units it already holds — and the spreadsheet import passes
 * *every* fleet its file replaces, so two rows may trade a hauler without
 * either being refused for membership the same upload dissolves.
 */
export async function refuseComposition(input: {
  diggerUnitId: string;
  workAreaId: string;
  busUnitId: string | null;
  unitIds: string[];
  selfIds?: string[];
}): Promise<string | null> {
  const { diggerUnitId, workAreaId, busUnitId, unitIds } = input;
  const selfIds = input.selfIds ?? [];

  if (unitIds.includes(diggerUnitId))
    return "Digger tidak bisa sekaligus menjadi anggota fleet-nya sendiri";

  // Every unit named — digger, bus, members — must exist. One query, and the
  // refusal names what is missing rather than which constraint would fire.
  const askedIds = [
    diggerUnitId,
    ...(busUnitId ? [busUnitId] : []),
    ...unitIds,
  ];
  const found = await db
    .select({
      id: schema.units.id,
      code: schema.units.code,
      typeName: schema.unitTypes.name,
    })
    .from(schema.units)
    .innerJoin(schema.unitTypes, eq(schema.unitTypes.id, schema.units.typeId))
    .where(inArray(schema.units.id, askedIds));
  const byId = new Map(found.map((u) => [u.id, u]));
  if (!byId.has(diggerUnitId)) return "Digger yang dipilih tidak ada di master";
  if (busUnitId && !byId.has(busUnitId))
    return "Bus yang dipilih tidak ada di master";
  const missing = unitIds.filter((id) => !byId.has(id));
  if (missing.length)
    return `${missing.length} unit anggota tidak ada di master`;

  if (busUnitId && !isFleetTransportType(byId.get(busUnitId)!.typeName))
    return `Unit ${byId.get(busUnitId)!.code} bukan ${FLEET_TRANSPORT_TYPES_TEXT}`;

  const [area] = await db
    .select({ type: schema.workAreas.type })
    .from(schema.workAreas)
    .where(eq(schema.workAreas.id, workAreaId))
    .limit(1);
  if (!area) return "Area kerja yang dipilih tidak ada di master";
  if (area.type !== "Mining")
    return "Lokasi fleet harus area kerja bertipe Mining";

  // Exclusivity, named. The digger may not haul for anyone, and a member may
  // not already haul elsewhere or lead a fleet of its own. The unique indexes
  // hold all of this too — these queries exist for the message.
  const othersOnly = selfIds.length
    ? notInArray(schema.fleetUnits.fleetId, selfIds)
    : undefined;
  const taken = await db
    .select({ unitId: schema.fleetUnits.unitId, code: schema.units.code })
    .from(schema.fleetUnits)
    .innerJoin(schema.units, eq(schema.units.id, schema.fleetUnits.unitId))
    .where(
      othersOnly
        ? sql`${inArray(schema.fleetUnits.unitId, askedIds)} and ${othersOnly}`
        : inArray(schema.fleetUnits.unitId, askedIds)
    );
  if (taken.some((r) => r.unitId === diggerUnitId))
    return `Unit ${byId.get(diggerUnitId)!.code} sudah menjadi anggota fleet lain`;
  const takenMembers = taken.filter((r) => unitIds.includes(r.unitId));
  if (takenMembers.length)
    return `Unit ${takenMembers.map((r) => r.code).join(", ")} sudah menjadi anggota fleet lain`;

  const leaders = await db
    .select({ id: schema.fleets.id, diggerUnitId: schema.fleets.diggerUnitId })
    .from(schema.fleets)
    .where(inArray(schema.fleets.diggerUnitId, unitIds));
  const leading = leaders.filter((l) => !selfIds.includes(l.id));
  if (leading.length)
    return `Unit ${leading
      .map((l) => byId.get(l.diggerUnitId)?.code ?? "?")
      .join(", ")} memimpin fleet lain dan tidak bisa menjadi anggota`;

  return null;
}

/** Distinct ids in submitted order — a doubled selection is not two haulers. */
const distinct = (ids: string[]) => [...new Set(ids)];

/* ------------------------------------------------------------- no-fleet */

/**
 * The no-fleet entry's units: every active unit that belongs to no formation.
 *
 * Derived, never stored (owner, 2026-08-31). Formations are reshuffled often,
 * and a stored list of "everything else" goes stale the moment one is edited —
 * silently, because nothing about a stale row looks wrong. Deriving it means
 * the entry is correct by construction: a unit pulled out of a fleet is in
 * here on the next read, and one added to a fleet leaves without anyone
 * remembering to remove it.
 *
 * This entry is **not allocated.** It exists so a machine cannot drop out of
 * allocation unnoticed, which is a question about visibility rather than a
 * second scope for the engine — see `fleet-scope.ts`.
 */
async function noFleetUnits(): Promise<{ id: string; code: string }[]> {
  return db
    .select({ id: schema.units.id, code: schema.units.code })
    .from(schema.units)
    .where(
      and(eq(schema.units.active, true), isNotFleetConfigured(schema.units.id))
    )
    .orderBy(asc(schema.units.code));
}

/* --------------------------------------------------------------- import */

/** Everything the parser needs to resolve codes and diff against. */
async function importCatalogues(): Promise<FleetCatalogues> {
  const units = await db
    .select({
      id: schema.units.id,
      code: schema.units.code,
      typeName: schema.unitTypes.name,
    })
    .from(schema.units)
    .innerJoin(schema.unitTypes, eq(schema.unitTypes.id, schema.units.typeId));
  const areas = await db
    .select({
      id: schema.workAreas.id,
      name: schema.workAreas.name,
      type: schema.workAreas.type,
    })
    .from(schema.workAreas);
  const fleets = await fleetQuery();
  const members = await membersOf(fleets.map((f) => f.id));
  return {
    unitsByCode: new Map(units.map((u) => [u.code.toLowerCase(), u])),
    areasByName: new Map(areas.map((a) => [a.name.toLowerCase(), a])),
    fleetsByDigger: new Map(
      fleets.map((f) => [
        f.diggerCode.toLowerCase(),
        {
          id: f.id,
          areaName: f.workAreaName,
          busCode: f.busCode,
          memberCodes: (members.get(f.id) ?? []).map((m) => m.code),
        },
      ])
    ),
  };
}

type FleetImportOutcome = {
  preview: FleetImportPreview;
  rows: ParsedFleetRow[];
};

/**
 * Parse, then hold every surviving row against `refuseComposition` — the same
 * function the form goes through. `selfIds` carries every fleet the file
 * replaces, so exclusivity is judged against the world *after* this upload.
 */
async function parseFleetImport(
  file: File
): Promise<FleetImportOutcome | { code: string; message: string }> {
  const parsed = await validateFleetWorkbook(
    await file.arrayBuffer(),
    await importCatalogues()
  );
  if ("code" in parsed) return parsed;

  const selfIds = parsed.rows
    .map((r) => r.selfId)
    .filter((id): id is string => id !== null);

  const rows: ParsedFleetRow[] = [];
  const errors = [...parsed.errors];
  for (const row of parsed.rows) {
    const refusal = await refuseComposition({
      diggerUnitId: row.diggerUnitId,
      workAreaId: row.workAreaId,
      busUnitId: row.busUnitId,
      unitIds: row.unitIds,
      selfIds,
    });
    if (refusal) {
      errors.push({
        row: String(row.preview.row),
        nik: row.preview.digger,
        emp: row.preview.units.join(", "),
        issue: refusal,
        badgeVariant: "danger",
        badge: "Error",
      });
      continue;
    }
    rows.push(row);
  }

  errors.sort((a, b) => Number(a.row) - Number(b.row));
  return {
    preview: {
      fileName: file.name,
      newCount: rows.filter((r) => r.preview.kind === "new").length,
      updatedCount: rows.filter((r) => r.preview.kind === "updated").length,
      errorCount: errors.length,
      rows: rows.map((r) => r.preview),
      errors,
    },
    rows,
  };
}

const fleetBody = {
  diggerUnitId: t.String({ format: "uuid" }),
  workAreaId: t.String({ format: "uuid" }),
  busUnitId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
  unitIds: t.Array(t.String({ format: "uuid" }), {
    minItems: FLEET_MIN_UNITS,
    maxItems: FLEET_MAX_UNITS,
  }),
  active: t.Optional(t.Boolean()),
};

export const fleetsRoutes = new Elysia({ prefix: "/fleets", tags: ["fleets"] })
  .use(requireAuth)

  .get(
    "/",
    async () => {
      const rows = await fleetQuery().orderBy(asc(digger.code));
      const members = await membersOf(rows.map((r) => r.id));
      return rows.map((r) => toFleet(r, members.get(r.id) ?? []));
    },
    {
      /**
       * Readable from the Display menu too, because that is where a fleet wall
       * is pointed at its formations and the picker has to offer the real
       * ones. Only this list: creating, editing and disbanding a fleet stay
       * `fleet-setting` alone. What it discloses — digger codes, work areas,
       * member units — is what the TV shows in the yard anyway.
       */
      auth: { menu: ["fleet-setting", "display-fleet"], mode: "view" },
      response: {
        200: t.Array(FleetSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List fleets with their member units" },
    }
  )

  /* -------------------------------------------------------------- no-fleet
     Declared before /:id so "no-fleet" is never parsed as a fleet id.

     There is no row behind this entry and so no way to delete it: it is a
     fixed part of Fleet Setting, and "cannot be deleted" is a property of
     having nothing to delete rather than a rule someone enforces. It is
     read-only for the same reason — its membership is derived from the
     formations, so there is nothing here to edit. */

  .get("/no-fleet", async () => ({ units: await noFleetUnits() }), {
    auth: { menu: ["fleet-setting", "display-fleet"], mode: "view" },
    response: {
      200: NoFleetSchema,
      401: ErrorSchema,
      403: ErrorSchema,
    },
    detail: {
      summary: "Active units belonging to no formation — outside allocation",
    },
  })

  /* ---------------------------------------------------------------- import
     Declared before /:id so "import" is never parsed as a fleet id. */

  .get(
    "/import/template",
    async ({ set }) => {
      set.headers["content-type"] =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      set.headers["content-disposition"] =
        'attachment; filename="template_fleet.xlsx"';
      return new Response(new Uint8Array(await buildTemplate()));
    },
    {
      auth: { menu: "fleet-setting", mode: "manage" },
      // Described by hand rather than with a `response` schema: the body is a
      // binary workbook, and a TypeBox schema would try to validate it.
      detail: {
        summary: "Download the fleet import template (.xlsx)",
        responses: {
          200: {
            description: "An .xlsx with the columns digger, area, bus, units",
            content: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                { schema: { type: "string", format: "binary" } },
            },
          },
          401: { description: "No session" },
          403: { description: "Lacks manage on the fleet-setting menu" },
        },
      },
    }
  )

  .post(
    "/import/validate",
    async ({ body, status }) => {
      const outcome = await parseFleetImport(body.file);
      if ("code" in outcome) return status(422, outcome);
      return outcome.preview;
    },
    {
      auth: { menu: "fleet-setting", mode: "manage" },
      body: t.Object({ file: t.File({ maxSize: MAX_IMPORT_BYTES }) }),
      response: {
        200: FleetImportPreviewSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: {
        summary: "Validate a fleet spreadsheet and preview the changes",
      },
    }
  )

  .post(
    "/import/commit",
    async ({ body, status }) => {
      // Re-validated rather than trusted from the client: the preview the
      // caller saw is advisory, this parse is what gets written.
      const outcome = await parseFleetImport(body.file);
      if ("code" in outcome) return status(422, outcome);
      if (outcome.preview.errorCount > 0)
        return status(422, {
          code: "validation_failed",
          message: `${outcome.preview.errorCount} baris masih bermasalah`,
        });

      const updated = outcome.rows.filter((r) => r.selfId !== null);
      const created = outcome.rows.filter((r) => r.selfId === null);

      try {
        // One transaction, ordered so that every membership the file
        // dissolves is gone before any it grants exists — two fleets trading
        // a hauler must not trip the unique index mid-write.
        await db.transaction(async (tx) => {
          if (updated.length)
            await tx.delete(schema.fleetUnits).where(
              inArray(
                schema.fleetUnits.fleetId,
                updated.map((r) => r.selfId!)
              )
            );
          for (const row of updated)
            await tx
              .update(schema.fleets)
              .set({
                workAreaId: row.workAreaId,
                busUnitId: row.busUnitId,
              })
              .where(eq(schema.fleets.id, row.selfId!));
          for (const row of created) {
            const [fleet] = await tx
              .insert(schema.fleets)
              .values({
                diggerUnitId: row.diggerUnitId,
                workAreaId: row.workAreaId,
                busUnitId: row.busUnitId,
              })
              .returning({ id: schema.fleets.id });
            row.selfId = fleet!.id;
          }
          await tx
            .insert(schema.fleetUnits)
            .values(
              outcome.rows.flatMap((row) =>
                row.unitIds.map((unitId) => ({ fleetId: row.selfId!, unitId }))
              )
            );
        });
      } catch (error) {
        // Validation reads the database a moment before the write: another
        // request can take a digger or a hauler in between.
        if (isUniqueViolation(error, "fleets_digger_unit_id_unique"))
          return status(409, {
            code: "fleet_exists",
            message:
              "Sebuah digger dalam file ini baru saja memimpin fleet lain — validasi ulang filenya",
          });
        if (isUniqueViolation(error, "fleet_units_unit_id_unique"))
          return status(409, {
            code: "unit_in_fleet",
            message:
              "Sebuah unit dalam file ini baru saja dipakai fleet lain — validasi ulang filenya",
          });
        throw error;
      }

      return { created: created.length, updated: updated.length };
    },
    {
      auth: { menu: "fleet-setting", mode: "manage" },
      body: t.Object({ file: t.File({ maxSize: MAX_IMPORT_BYTES }) }),
      response: {
        200: ImportResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Commit a validated fleet spreadsheet" },
    }
  )

  .post(
    "/",
    async ({ body, status }) => {
      const unitIds = distinct(body.unitIds);
      if (unitIds.length < FLEET_MIN_UNITS)
        return status(422, invalid("Fleet butuh minimal satu unit anggota"));

      const refusal = await refuseComposition({
        diggerUnitId: body.diggerUnitId,
        workAreaId: body.workAreaId,
        busUnitId: body.busUnitId ?? null,
        unitIds,
      });
      if (refusal) return status(422, invalid(refusal));

      try {
        const id = await db.transaction(async (tx) => {
          const [fleet] = await tx
            .insert(schema.fleets)
            .values({
              diggerUnitId: body.diggerUnitId,
              workAreaId: body.workAreaId,
              busUnitId: body.busUnitId ?? null,
              active: body.active ?? true,
            })
            .returning({ id: schema.fleets.id });
          await tx
            .insert(schema.fleetUnits)
            .values(unitIds.map((unitId) => ({ fleetId: fleet!.id, unitId })));
          return fleet!.id;
        });

        const [row] = await fleetQuery().where(eq(schema.fleets.id, id));
        const members = await membersOf([id]);
        return status(201, toFleet(row!, members.get(id) ?? []));
      } catch (error) {
        // The two exclusivity races the prechecks cannot see: another request
        // claimed the digger, or one of the members, between check and insert.
        if (isUniqueViolation(error, "fleets_digger_unit_id_unique"))
          return status(409, {
            code: "fleet_exists",
            message: "Digger ini sudah memimpin fleet lain",
          });
        if (isUniqueViolation(error, "fleet_units_unit_id_unique"))
          return status(409, {
            code: "unit_in_fleet",
            message: "Salah satu unit baru saja dipakai fleet lain",
          });
        throw error;
      }
    },
    {
      auth: { menu: "fleet-setting", mode: "manage" },
      body: t.Object(fleetBody),
      response: {
        201: FleetSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Create a fleet" },
    }
  )

  .patch(
    "/:id",
    async ({ params, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.fleets)
        .where(eq(schema.fleets.id, params.id))
        .limit(1);
      if (!existing) return status(404, notFound);

      const unitIds = distinct(body.unitIds);
      if (unitIds.length < FLEET_MIN_UNITS)
        return status(422, invalid("Fleet butuh minimal satu unit anggota"));

      const refusal = await refuseComposition({
        diggerUnitId: body.diggerUnitId,
        workAreaId: body.workAreaId,
        busUnitId: body.busUnitId ?? null,
        unitIds,
        selfIds: [existing.id],
      });
      if (refusal) return status(422, invalid(refusal));

      try {
        // The member list is replaced, not patched: the dialog submits the
        // whole selection, and a diff would reimplement what delete + insert
        // in one transaction already guarantees.
        await db.transaction(async (tx) => {
          await tx
            .update(schema.fleets)
            .set({
              diggerUnitId: body.diggerUnitId,
              workAreaId: body.workAreaId,
              busUnitId: body.busUnitId ?? null,
              ...(body.active !== undefined ? { active: body.active } : {}),
            })
            .where(eq(schema.fleets.id, existing.id));
          await tx
            .delete(schema.fleetUnits)
            .where(eq(schema.fleetUnits.fleetId, existing.id));
          await tx
            .insert(schema.fleetUnits)
            .values(
              unitIds.map((unitId) => ({ fleetId: existing.id, unitId }))
            );
        });
      } catch (error) {
        if (isUniqueViolation(error, "fleets_digger_unit_id_unique"))
          return status(409, {
            code: "fleet_exists",
            message: "Digger ini sudah memimpin fleet lain",
          });
        if (isUniqueViolation(error, "fleet_units_unit_id_unique"))
          return status(409, {
            code: "unit_in_fleet",
            message: "Salah satu unit baru saja dipakai fleet lain",
          });
        throw error;
      }

      const [row] = await fleetQuery().where(eq(schema.fleets.id, existing.id));
      const members = await membersOf([existing.id]);
      return toFleet(row!, members.get(existing.id) ?? []);
    },
    {
      auth: { menu: "fleet-setting", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object(fleetBody),
      response: {
        200: FleetSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Edit a fleet, replacing its member list" },
    }
  )

  .delete(
    "/:id",
    async ({ params, status }) => {
      // Membership rows die with the fleet (cascade) — they are its edge
      // list. The units themselves are untouched and immediately offerable
      // to another fleet.
      const [row] = await db
        .delete(schema.fleets)
        .where(eq(schema.fleets.id, params.id))
        .returning({ id: schema.fleets.id });
      if (!row) return status(404, notFound);
      return { ok: true };
    },
    {
      auth: { menu: "fleet-setting", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Delete a fleet, releasing its members" },
    }
  );
