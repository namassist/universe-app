/**
 * Unit operational status — the derived reading, the change, and the trail.
 *
 * The status itself is not a column: `breakdown` and `standby` are two flags
 * on `units`, and the reading ranks them worst-first (`breakdown` >
 * `standby` > `ready`). A transition therefore rewrites *both* flags every
 * time, so no combination of past changes can leave a unit both broken and
 * standing by. What the flags cannot hold — since when, and why — is
 * `unit_status_history`, appended inside the same transaction.
 *
 * A unit's location is its fleet's work area, whether it leads the fleet or
 * hauls in it. A unit no fleet holds has no location — an honest null, not a
 * blank to fill: parking areas are not recorded anywhere, and inventing a
 * column for them would put a second source of truth beside the fleet's.
 */

import { asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { UnitStatus } from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { db, schema } from "../db";
import {
  ErrorSchema,
  UnitStatusHistorySchema,
  UnitStatusRowSchema,
  UnitStatusSchema,
} from "./schemas";

/** The reading, ranked worst-first. Shared with the allocation board. */
export const statusOf = (u: {
  breakdown: boolean;
  standby: boolean;
}): UnitStatus => (u.breakdown ? "breakdown" : u.standby ? "standby" : "ready");

/** The write — both flags, every time, so transitions cannot compound. */
const FLAGS: Record<UnitStatus, { standby: boolean; breakdown: boolean }> = {
  ready: { standby: false, breakdown: false },
  standby: { standby: true, breakdown: false },
  breakdown: { standby: false, breakdown: true },
};

const notFound = { code: "unit_not_found", message: "Unit tidak ditemukan" };

/**
 * The active units with model, brand, and — where a fleet holds the unit as
 * leader or hauler — that fleet's work area.
 */
async function unitRows() {
  return db
    .select({
      id: schema.units.id,
      code: schema.units.code,
      modelName: schema.unitModels.name,
      brandName: schema.unitBrands.name,
      standby: schema.units.standby,
      breakdown: schema.units.breakdown,
      location: schema.workAreas.name,
    })
    .from(schema.units)
    .innerJoin(
      schema.unitModels,
      eq(schema.unitModels.id, schema.units.modelId)
    )
    .innerJoin(
      schema.unitBrands,
      eq(schema.unitBrands.id, schema.units.brandId)
    )
    .leftJoin(schema.fleetUnits, eq(schema.fleetUnits.unitId, schema.units.id))
    .leftJoin(
      schema.fleets,
      or(
        eq(schema.fleets.diggerUnitId, schema.units.id),
        eq(schema.fleets.id, schema.fleetUnits.fleetId)
      )
    )
    .leftJoin(
      schema.workAreas,
      eq(schema.workAreas.id, schema.fleets.workAreaId)
    )
    .where(eq(schema.units.active, true))
    .orderBy(asc(schema.units.code));
}

/** Latest change stamp per unit — one query however many units. */
async function latestChanges(unitIds: string[]): Promise<Map<string, Date>> {
  if (!unitIds.length) return new Map();
  const rows = await db
    .select({
      unitId: schema.unitStatusHistory.unitId,
      at: sql<Date>`max(${schema.unitStatusHistory.createdAt})`,
    })
    .from(schema.unitStatusHistory)
    .where(inArray(schema.unitStatusHistory.unitId, unitIds))
    .groupBy(schema.unitStatusHistory.unitId);
  return new Map(rows.map((r) => [r.unitId, new Date(r.at)]));
}

export const unitStatusRoutes = new Elysia({
  prefix: "/unit-status",
  tags: ["unit-status"],
})
  .use(requireAuth)

  .get(
    "/",
    async () => {
      const rows = await unitRows();
      const changed = await latestChanges(rows.map((r) => r.id));
      return rows.map((r) => ({
        id: r.id,
        code: r.code,
        modelName: r.modelName,
        brandName: r.brandName,
        status: statusOf(r),
        location: r.location,
        updatedAt: changed.get(r.id)?.toISOString() ?? null,
      }));
    },
    {
      auth: { menu: "unit-status", mode: "view" },
      response: {
        200: t.Array(UnitStatusRowSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List active units with their operational status" },
    }
  )

  .get(
    "/:code/history",
    async ({ params, status }) => {
      const [unit] = await db
        .select({ id: schema.units.id })
        .from(schema.units)
        .where(eq(schema.units.code, params.code))
        .limit(1);
      if (!unit) return status(404, notFound);

      const rows = await db
        .select()
        .from(schema.unitStatusHistory)
        .where(eq(schema.unitStatusHistory.unitId, unit.id))
        .orderBy(desc(schema.unitStatusHistory.createdAt));
      return rows.map((r) => ({
        id: r.id,
        status: r.status,
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      }));
    },
    {
      auth: { menu: "unit-status", mode: "view" },
      params: t.Object({ code: t.String({ minLength: 1 }) }),
      response: {
        200: t.Array(UnitStatusHistorySchema),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "A unit's status changes, newest first" },
    }
  )

  .post(
    "/:code",
    async ({ params, body, status }) => {
      const reason = body.reason.trim();
      if (!reason)
        return status(422, {
          code: "validation_failed",
          message: "Alasan perubahan status wajib diisi",
        });

      const [unit] = await db
        .select({ id: schema.units.id })
        .from(schema.units)
        .where(eq(schema.units.code, params.code))
        .limit(1);
      if (!unit) return status(404, notFound);

      // The flags and the trail move together or not at all: a history row
      // claiming a change the flags never took would answer "since when"
      // with a lie.
      await db.transaction(async (tx) => {
        await tx
          .update(schema.units)
          .set(FLAGS[body.status])
          .where(eq(schema.units.id, unit.id));
        await tx.insert(schema.unitStatusHistory).values({
          unitId: unit.id,
          status: body.status,
          reason,
        });
      });

      return { status: body.status };
    },
    {
      auth: { menu: "unit-status", mode: "manage" },
      params: t.Object({ code: t.String({ minLength: 1 }) }),
      body: t.Object({
        status: UnitStatusSchema,
        reason: t.String({ minLength: 1 }),
      }),
      response: {
        200: t.Object({ status: UnitStatusSchema }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Change a unit's status, with the reason on record" },
    }
  );
