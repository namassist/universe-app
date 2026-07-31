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

import { asc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Elysia, t } from "elysia";
import { FLEET_MAX_UNITS, FLEET_MIN_UNITS } from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { db, isUniqueViolation, schema } from "../db";
import { ErrorSchema, FleetSchema } from "./schemas";

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
 * for holding the units it already holds.
 */
async function refuseComposition(input: {
  diggerUnitId: string;
  workAreaId: string;
  busUnitId: string | null;
  unitIds: string[];
  selfId?: string;
}): Promise<string | null> {
  const { diggerUnitId, workAreaId, busUnitId, unitIds, selfId } = input;

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

  if (busUnitId && byId.get(busUnitId)!.typeName !== "BUS")
    return `Unit ${byId.get(busUnitId)!.code} bukan unit berjenis BUS`;

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
  const othersOnly = selfId ? ne(schema.fleetUnits.fleetId, selfId) : undefined;
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
  const leading = leaders.filter((l) => l.id !== selfId);
  if (leading.length)
    return `Unit ${leading
      .map((l) => byId.get(l.diggerUnitId)?.code ?? "?")
      .join(", ")} memimpin fleet lain dan tidak bisa menjadi anggota`;

  return null;
}

/** Distinct ids in submitted order — a doubled selection is not two haulers. */
const distinct = (ids: string[]) => [...new Set(ids)];

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
      auth: { menu: "fleet-setting", mode: "view" },
      response: {
        200: t.Array(FleetSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List fleets with their member units" },
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
        selfId: existing.id,
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
