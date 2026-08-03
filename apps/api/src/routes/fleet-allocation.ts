/**
 * The PLAN board — standing unit ↔ operator pairings, served composed.
 *
 * A unit holds at most two operators, and they are a *shift pair*: one Day,
 * one Night. The pair is validated against the roster on the assignment date
 * — two operators the roster puts on the same shift cannot share a unit,
 * while an operator the roster does not know yet is allowed and flagged,
 * because a missing upload must not block the board from being built.
 *
 * Eligibility is the allocation engine's contract, applied at the pairing:
 * the operator's position enters fleet allocation (the flag the organisation
 * chain added for exactly this), the unit's qualification code — where it
 * has one — is among the operator's skills and their SIMPER is not expired,
 * and a unit a department owns takes only that department's operators. An
 * operator pairs with at most one unit; the unique index is the guarantee
 * and `busyAt` in the candidate list is its explanation.
 *
 * What this file deliberately is not: the ACTUAL generation. FTW and
 * fingerprint reads, spare FCFS substitution, and the per-shift document
 * belong to the engine behind `finger-ingest`/`spare-validate`, which stays
 * a no-op until those modules exist.
 */

import { and, asc, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Elysia, t } from "elysia";
import {
  rosterCodeKind,
  type RosterCodeKind,
  type UnitStatus,
} from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { db, isUniqueViolation, schema } from "../db";
import { localDate } from "../scheduler";
import { ErrorSchema, UnitStatusSchema } from "./schemas";
import { statusOf } from "./unit-status";

const FA_PLAN_MAX_OPS = 2;

const digger = alias(schema.units, "digger_unit");

/* ------------------------------------------------------------------ schemas */

const ShiftKindSchema = t.Nullable(
  t.Union([t.Literal("day"), t.Literal("night")])
);

const SlotSchema = t.Object({
  nik: t.String(),
  name: t.String(),
  simperTypeName: t.Nullable(t.String()),
  rosterShift: ShiftKindSchema,
});

const BoardUnitSchema = t.Object({
  id: t.String(),
  code: t.String(),
  modelName: t.String(),
  brandName: t.String(),
  status: UnitStatusSchema,
  location: t.Nullable(t.String()),
  /** The owning department's name — null for a global unit. */
  departmentName: t.Nullable(t.String()),
  fleet: t.Nullable(
    t.Object({ id: t.String(), diggerCode: t.String(), area: t.String() })
  ),
  slots: t.Array(SlotSchema),
});

const PlanBoardSchema = t.Object({
  units: t.Array(BoardUnitSchema),
  fleets: t.Array(t.Object({ id: t.String(), diggerCode: t.String() })),
  spares: t.Array(
    t.Object({
      nik: t.String(),
      name: t.String(),
      departmentName: t.String(),
      rosterShift: ShiftKindSchema,
    })
  ),
});

const CandidateSchema = t.Object({
  nik: t.String(),
  name: t.String(),
  simperTypeName: t.Nullable(t.String()),
  departmentName: t.String(),
  rosterShift: ShiftKindSchema,
  eligible: t.Boolean(),
  /** The unit code holding this operator, when that is what blocks them. */
  busyAt: t.Nullable(t.String()),
  /** True when the unit's current partner works the same shift today. */
  sameShift: t.Boolean(),
  /** False when the unit belongs to a department this operator is not in. */
  deptOk: t.Boolean(),
  /** False when the unit requires a code the operator does not hold. */
  skillOk: t.Boolean(),
  /** True when the operator holds the code but their SIMPER has lapsed. */
  expired: t.Boolean(),
});

/* ------------------------------------------------------------------ lookups */

/** day/night for a set of employees on one date — other kinds read as null. */
async function shiftKinds(
  employeeIds: string[],
  date: string
): Promise<Map<string, "day" | "night">> {
  const map = new Map<string, "day" | "night">();
  if (!employeeIds.length) return map;
  const rows = await db
    .select({
      employeeId: schema.rosterDays.employeeId,
      code: schema.rosterDays.code,
    })
    .from(schema.rosterDays)
    .where(
      and(
        eq(schema.rosterDays.date, date),
        inArray(schema.rosterDays.employeeId, employeeIds)
      )
    );
  for (const row of rows) {
    const kind: RosterCodeKind = rosterCodeKind(row.code);
    if (kind === "day" || kind === "night") map.set(row.employeeId, kind);
  }
  return map;
}

/**
 * The operators the plan may draw from: active people whose position enters
 * fleet allocation, with what eligibility needs to know about each.
 */
function allocatablePeople() {
  return db
    .select({
      id: schema.employees.id,
      nik: schema.employees.nik,
      name: schema.employees.name,
      departmentId: schema.employees.departmentId,
      departmentName: schema.departments.name,
      simperExp: schema.employees.simperExp,
      simperTypeName: schema.simperTypes.name,
    })
    .from(schema.employees)
    .innerJoin(
      schema.positions,
      eq(schema.positions.id, schema.employees.positionId)
    )
    .innerJoin(
      schema.departments,
      eq(schema.departments.id, schema.employees.departmentId)
    )
    .leftJoin(
      schema.simperTypes,
      eq(schema.simperTypes.id, schema.employees.simperTypeId)
    )
    .where(
      and(
        eq(schema.employees.status, "aktif"),
        eq(schema.positions.fleetAllocation, true)
      )
    )
    .orderBy(asc(schema.employees.name));
}

type SlotHolder = {
  employeeId: string;
  nik: string;
  name: string;
  simperTypeName: string | null;
};

/** unitId → slot holders, resolved for the board. */
async function slotsByUnit(): Promise<Map<string, SlotHolder[]>> {
  const rows = await db
    .select({
      unitId: schema.fleetPlanSlots.unitId,
      employeeId: schema.employees.id,
      nik: schema.employees.nik,
      name: schema.employees.name,
      simperTypeName: schema.simperTypes.name,
      createdAt: schema.fleetPlanSlots.createdAt,
    })
    .from(schema.fleetPlanSlots)
    .innerJoin(
      schema.employees,
      eq(schema.employees.id, schema.fleetPlanSlots.employeeId)
    )
    .leftJoin(
      schema.simperTypes,
      eq(schema.simperTypes.id, schema.employees.simperTypeId)
    )
    .orderBy(asc(schema.fleetPlanSlots.createdAt));
  const map = new Map<string, SlotHolder[]>();
  for (const row of rows) {
    const list = map.get(row.unitId) ?? [];
    list.push({
      employeeId: row.employeeId,
      nik: row.nik,
      name: row.name,
      simperTypeName: row.simperTypeName,
    });
    map.set(row.unitId, list);
  }
  return map;
}

const unitNotFound = {
  code: "unit_not_found",
  message: "Unit tidak ditemukan",
};

/** A unit as eligibility needs it, by code. */
async function unitByCode(code: string) {
  const [unit] = await db
    .select({
      id: schema.units.id,
      code: schema.units.code,
      simperCodeId: schema.units.simperCodeId,
      simperCodeName: schema.simperCodes.name,
      departmentId: schema.units.departmentId,
      departmentName: schema.departments.name,
    })
    .from(schema.units)
    .leftJoin(
      schema.simperCodes,
      eq(schema.simperCodes.id, schema.units.simperCodeId)
    )
    .leftJoin(
      schema.departments,
      eq(schema.departments.id, schema.units.departmentId)
    )
    .where(and(eq(schema.units.code, code), eq(schema.units.active, true)))
    .limit(1);
  return unit;
}

export const fleetAllocationRoutes = new Elysia({
  prefix: "/fleet-allocation",
  tags: ["fleet-allocation"],
})
  .use(requireAuth)

  .get(
    "/plan",
    async () => {
      const today = localDate(new Date());

      const unitRows = await db
        .select({
          id: schema.units.id,
          code: schema.units.code,
          modelName: schema.unitModels.name,
          brandName: schema.unitBrands.name,
          standby: schema.units.standby,
          breakdown: schema.units.breakdown,
          fleetId: schema.fleets.id,
          diggerCode: digger.code,
          area: schema.workAreas.name,
          departmentName: schema.departments.name,
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
        .leftJoin(
          schema.departments,
          eq(schema.departments.id, schema.units.departmentId)
        )
        .leftJoin(
          schema.fleetUnits,
          eq(schema.fleetUnits.unitId, schema.units.id)
        )
        .leftJoin(
          schema.fleets,
          or(
            eq(schema.fleets.diggerUnitId, schema.units.id),
            eq(schema.fleets.id, schema.fleetUnits.fleetId)
          )
        )
        .leftJoin(digger, eq(digger.id, schema.fleets.diggerUnitId))
        .leftJoin(
          schema.workAreas,
          eq(schema.workAreas.id, schema.fleets.workAreaId)
        )
        .where(eq(schema.units.active, true))
        .orderBy(asc(schema.units.code));

      const slots = await slotsByUnit();

      const people = await allocatablePeople();
      const paired = new Set(
        [...slots.values()].flatMap((list) => list.map((s) => s.employeeId))
      );
      const spares = people.filter((p) => !paired.has(p.id));

      const kinds = await shiftKinds(
        [...paired, ...spares.map((s) => s.id)],
        today
      );

      const fleetRows = await db
        .select({ id: schema.fleets.id, diggerCode: digger.code })
        .from(schema.fleets)
        .innerJoin(digger, eq(digger.id, schema.fleets.diggerUnitId))
        .orderBy(asc(digger.code));

      return {
        units: unitRows.map((u) => ({
          id: u.id,
          code: u.code,
          modelName: u.modelName,
          brandName: u.brandName,
          status: statusOf(u) as UnitStatus,
          location: u.area,
          departmentName: u.departmentName,
          fleet:
            u.fleetId && u.diggerCode && u.area
              ? { id: u.fleetId, diggerCode: u.diggerCode, area: u.area }
              : null,
          slots: (slots.get(u.id) ?? []).map((s) => ({
            nik: s.nik,
            name: s.name,
            simperTypeName: s.simperTypeName,
            rosterShift: kinds.get(s.employeeId) ?? null,
          })),
        })),
        fleets: fleetRows,
        spares: spares.map((s) => ({
          nik: s.nik,
          name: s.name,
          departmentName: s.departmentName,
          rosterShift: kinds.get(s.id) ?? null,
        })),
      };
    },
    {
      auth: { menu: "fleet-allocation", mode: "view" },
      response: {
        200: PlanBoardSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "The PLAN board, composed — units, pairs, spares" },
    }
  )

  .get(
    "/plan/candidates",
    async ({ query, status }) => {
      const unit = await unitByCode(query.unit);
      if (!unit) return status(404, unitNotFound);
      const today = localDate(new Date());

      const people = await allocatablePeople();

      // What blocks or clears each candidate, resolved in bulk: the unit the
      // plan already gave them, the skill the unit requires, and today's
      // shift beside the current partner's.
      const busyRows = await db
        .select({
          employeeId: schema.fleetPlanSlots.employeeId,
          unitId: schema.fleetPlanSlots.unitId,
          code: schema.units.code,
        })
        .from(schema.fleetPlanSlots)
        .innerJoin(
          schema.units,
          eq(schema.units.id, schema.fleetPlanSlots.unitId)
        );
      const busyAt = new Map(busyRows.map((r) => [r.employeeId, r.code]));

      const skilled = unit.simperCodeId
        ? new Set(
            (
              await db
                .select({ employeeId: schema.employeeSkills.employeeId })
                .from(schema.employeeSkills)
                .where(
                  eq(schema.employeeSkills.simperCodeId, unit.simperCodeId)
                )
            ).map((r) => r.employeeId)
          )
        : null;

      const kinds = await shiftKinds(
        people.map((p) => p.id),
        today
      );
      const partnerKinds = busyRows
        .filter((r) => r.unitId === unit.id)
        .map((r) => kinds.get(r.employeeId))
        .filter((k): k is "day" | "night" => k !== undefined);

      return people.map((p) => {
        const busy = busyAt.get(p.id) ?? null;
        const kind = kinds.get(p.id) ?? null;
        const sameShift = kind !== null && partnerKinds.includes(kind);
        const skillOk = skilled === null || skilled.has(p.id);
        const expired =
          skilled !== null &&
          skillOk &&
          p.simperExp !== null &&
          p.simperExp < today;
        const deptOk =
          unit.departmentId === null || p.departmentId === unit.departmentId;
        return {
          nik: p.nik,
          name: p.name,
          simperTypeName: p.simperTypeName,
          departmentName: p.departmentName,
          rosterShift: kind,
          eligible: !busy && skillOk && !expired && deptOk && !sameShift,
          busyAt: busy,
          sameShift,
          deptOk,
          skillOk,
          expired,
        };
      });
    },
    {
      auth: { menu: "fleet-allocation", mode: "view" },
      query: t.Object({ unit: t.String({ minLength: 1 }) }),
      response: {
        200: t.Array(CandidateSchema),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Who may be paired with this unit, and why not" },
    }
  )

  .post(
    "/plan/slots",
    async ({ body, status }) => {
      const unit = await unitByCode(body.unitCode);
      if (!unit) return status(404, unitNotFound);

      const [person] = await db
        .select({
          id: schema.employees.id,
          nik: schema.employees.nik,
          name: schema.employees.name,
          statusValue: schema.employees.status,
          departmentId: schema.employees.departmentId,
          simperExp: schema.employees.simperExp,
          positionName: schema.positions.name,
          fleetAllocation: schema.positions.fleetAllocation,
        })
        .from(schema.employees)
        .innerJoin(
          schema.positions,
          eq(schema.positions.id, schema.employees.positionId)
        )
        .where(eq(schema.employees.nik, body.nik))
        .limit(1);
      if (!person)
        return status(404, {
          code: "employee_not_found",
          message: "Karyawan tidak ditemukan",
        });

      const refuse = (message: string) =>
        status(422, { code: "validation_failed", message });

      if (person.statusValue !== "aktif")
        return refuse(`Karyawan ${person.nik} sudah tidak aktif`);
      if (!person.fleetAllocation)
        return refuse(
          `Posisi "${person.positionName}" tidak masuk alokasi fleet — tandai posisinya di master Posisi bila memang seharusnya`
        );
      if (unit.departmentId && person.departmentId !== unit.departmentId)
        return refuse(
          `Unit ${unit.code} milik departemen "${unit.departmentName}" — operatornya harus dari departemen itu`
        );
      if (unit.simperCodeId) {
        const [skill] = await db
          .select({ employeeId: schema.employeeSkills.employeeId })
          .from(schema.employeeSkills)
          .where(
            and(
              eq(schema.employeeSkills.employeeId, person.id),
              eq(schema.employeeSkills.simperCodeId, unit.simperCodeId)
            )
          )
          .limit(1);
        if (!skill)
          return refuse(
            `${person.name} tidak memegang kode SIMPER "${unit.simperCodeName}" yang unit ini butuhkan`
          );
        const today = localDate(new Date());
        if (person.simperExp !== null && person.simperExp < today)
          return refuse(
            `SIMPER ${person.name} kedaluwarsa ${person.simperExp} — perpanjang dulu sebelum dipasangkan`
          );
      }

      const today = localDate(new Date());

      try {
        const outcome = await db.transaction(async (tx) => {
          // The unit row is the lock: two assignments to one unit serialise
          // here, so the count below cannot be raced past the maximum.
          await tx
            .select({ id: schema.units.id })
            .from(schema.units)
            .where(eq(schema.units.id, unit.id))
            .for("update");

          const partners = await tx
            .select({ employeeId: schema.fleetPlanSlots.employeeId })
            .from(schema.fleetPlanSlots)
            .where(eq(schema.fleetPlanSlots.unitId, unit.id));
          if (partners.length >= FA_PLAN_MAX_OPS)
            return { refusal: "full" as const };

          // The pair is Day/Night: on today's roster, a partner on the same
          // shift means this is not a pair but a queue.
          if (partners.length) {
            const kinds = await shiftKinds(
              [...partners.map((p) => p.employeeId), person.id],
              today
            );
            const mine = kinds.get(person.id);
            const partnerKind = partners
              .map((p) => kinds.get(p.employeeId))
              .find((k) => k !== undefined);
            if (mine && partnerKind && mine === partnerKind)
              return { refusal: "same-shift" as const, kind: mine };
          }

          await tx
            .insert(schema.fleetPlanSlots)
            .values({ unitId: unit.id, employeeId: person.id });
          return { refusal: null };
        });

        if (outcome.refusal === "full")
          return status(409, {
            code: "unit_full",
            message: `Unit ${unit.code} sudah memegang ${FA_PLAN_MAX_OPS} operator`,
          });
        if (outcome.refusal === "same-shift")
          return refuse(
            `${person.name} dan pasangan unit ini sama-sama shift ${
              outcome.kind === "day" ? "pagi" : "malam"
            } hari ini — pasangan unit harus Day/Night`
          );
      } catch (error) {
        // The one race the checks cannot see: the operator was paired with
        // another unit between the read and this insert.
        if (isUniqueViolation(error, "fleet_plan_slots_employee_id_unique"))
          return status(409, {
            code: "operator_busy",
            message: `${person.name} baru saja dipasangkan dengan unit lain`,
          });
        throw error;
      }

      return status(201, {
        unitCode: unit.code,
        nik: person.nik,
        name: person.name,
      });
    },
    {
      auth: { menu: "fleet-allocation", mode: "manage" },
      body: t.Object({
        unitCode: t.String({ minLength: 1 }),
        nik: t.String({ minLength: 1 }),
      }),
      response: {
        201: t.Object({
          unitCode: t.String(),
          nik: t.String(),
          name: t.String(),
        }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Pair an operator with a unit in the PLAN" },
    }
  )

  .delete(
    "/plan/slots/:unitCode/:nik",
    async ({ params, status }) => {
      const [row] = await db
        .select({ slotId: schema.fleetPlanSlots.id })
        .from(schema.fleetPlanSlots)
        .innerJoin(
          schema.units,
          eq(schema.units.id, schema.fleetPlanSlots.unitId)
        )
        .innerJoin(
          schema.employees,
          eq(schema.employees.id, schema.fleetPlanSlots.employeeId)
        )
        .where(
          and(
            eq(schema.units.code, params.unitCode),
            eq(schema.employees.nik, params.nik)
          )
        )
        .limit(1);
      if (!row)
        return status(404, {
          code: "slot_not_found",
          message: "Pasangan unit-operator tidak ditemukan",
        });

      await db
        .delete(schema.fleetPlanSlots)
        .where(eq(schema.fleetPlanSlots.id, row.slotId));
      return { ok: true };
    },
    {
      auth: { menu: "fleet-allocation", mode: "manage" },
      params: t.Object({
        unitCode: t.String({ minLength: 1 }),
        nik: t.String({ minLength: 1 }),
      }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Release an operator from their planned unit" },
    }
  );
