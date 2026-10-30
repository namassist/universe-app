/**
 * PLAN Generate routes — the spares onto today's empty units (owner, 2026-10-30).
 *
 * The rule is `planGenerate` in `../plan-generate`; this file loads what it
 * needs and writes its answer. Like Reset it is preview-then-confirm: the
 * dialog reads `GET /plan/generate/preview`, and `POST /plan/generate` repeats
 * the work under lock rather than trusting the preview, so what is written is
 * what the PLAN holds at that moment.
 *
 * Its own module because `fleet-allocation.ts` is already the PLAN board, the
 * dialog, the import and Reset; the helpers it shares with them (history,
 * actor, lock, capacity) are exported from there.
 */

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { RosterCode, ShiftKind } from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { db, isLockConflict, isUniqueViolation, schema } from "../db";
import { takesPartInAllocation } from "../fleet-scope";
import {
  generateShiftAt,
  generateToken,
  planGenerate,
  type GenerateOutcome,
  type GenerateSpare,
  type GenerateUnit,
} from "../plan-generate";
import { rosterDayInForce } from "../roster-in-force";
import { localDate } from "../scheduler";
import {
  PLAN_DEFAULT_LOCK,
  planActorOf,
  recordPlanChanges,
} from "./fleet-allocation";
import { ErrorSchema } from "./schemas";

type Reader = Pick<typeof db, "select">;

const ShiftSchema = t.Union([t.Literal("day"), t.Literal("night")]);

const PlanGeneratePreviewSchema = t.Object({
  date: t.String(),
  shift: ShiftSchema,
  assign: t.Array(
    t.Object({
      unit: t.String(),
      simperCode: t.Nullable(t.String()),
      priority: t.Nullable(t.Integer()),
      nik: t.String(),
      name: t.String(),
      released: t.Nullable(
        t.Object({
          nik: t.String(),
          name: t.String(),
          rosterCode: t.Nullable(t.String()),
          standby: t.Boolean(),
        })
      ),
    })
  ),
  unfilled: t.Array(
    t.Object({
      unit: t.String(),
      simperCode: t.Nullable(t.String()),
      priority: t.Nullable(t.Integer()),
    })
  ),
  sparesLeft: t.Integer(),
  /** Echoed by the commit: it writes only what this preview showed. */
  token: t.String(),
});

const PlanGenerateResultSchema = t.Object({
  assigned: t.Integer(),
  released: t.Integer(),
  unfilled: t.Integer(),
});

/** The units allocation is about, in the register's `asc(code)` order. */
const inAllocation = and(
  eq(schema.units.active, true),
  eq(schema.units.breakdown, false),
  takesPartInAllocation(schema.units.id, schema.units.fleetSupport)
);

async function rosterCodes(
  reader: Reader,
  employeeIds: string[],
  date: string
): Promise<Map<string, RosterCode>> {
  if (!employeeIds.length) return new Map();
  const rows = await reader
    .select({
      employeeId: schema.rosterDays.employeeId,
      code: schema.rosterDays.code,
    })
    .from(schema.rosterDays)
    .where(
      and(
        eq(schema.rosterDays.date, date),
        inArray(schema.rosterDays.employeeId, employeeIds),
        rosterDayInForce
      )
    );
  return new Map(rows.map((r) => [r.employeeId, r.code]));
}

/** How long the commit waits for another PLAN write before giving up. */
const LOCK_TIMEOUT = "5s";

/**
 * Everything `planGenerate` reads. `lockedIds` is the commit's: it reads only
 * the units it holds locked, so a unit entering allocation between the lock
 * and the read cannot be filled without its row lock.
 */
async function generateInput(
  reader: Reader,
  date: string,
  lockedIds?: string[]
) {
  const unitRows = await reader
    .select({
      id: schema.units.id,
      code: schema.units.code,
      simperCodeId: schema.units.simperCodeId,
      simperCodeName: schema.simperCodes.name,
      departmentId: schema.units.departmentId,
      departmentName: schema.departments.name,
      priority: schema.allocationPriorities.rank,
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
    .leftJoin(
      schema.allocationPriorities,
      eq(schema.allocationPriorities.description, schema.units.description)
    )
    .where(
      lockedIds
        ? and(inAllocation, inArray(schema.units.id, lockedIds))
        : inAllocation
    )
    .orderBy(asc(schema.units.code));

  const unitIds = unitRows.map((u) => u.id);
  const holderRows = unitIds.length
    ? await reader
        .select({
          slotId: schema.fleetPlanSlots.id,
          unitId: schema.fleetPlanSlots.unitId,
          employeeId: schema.employees.id,
          nik: schema.employees.nik,
          name: schema.employees.name,
          status: schema.employees.status,
        })
        .from(schema.fleetPlanSlots)
        .innerJoin(
          schema.employees,
          eq(schema.employees.id, schema.fleetPlanSlots.employeeId)
        )
        .where(inArray(schema.fleetPlanSlots.unitId, unitIds))
    : [];

  /* No PLAN slot anywhere: a left join that found none, rather than a
     correlated `not exists`, so every column stays qualified. */
  const spareRows = await reader
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
    .leftJoin(
      schema.fleetPlanSlots,
      eq(schema.fleetPlanSlots.employeeId, schema.employees.id)
    )
    .where(
      and(
        eq(schema.employees.status, "aktif"),
        eq(schema.positions.fleetAllocation, true),
        isNull(schema.fleetPlanSlots.id)
      )
    );

  const spareIds = spareRows.map((s) => s.id);
  const codes = await rosterCodes(
    reader,
    [...holderRows.map((h) => h.employeeId), ...spareIds],
    date
  );
  const skillRows = spareIds.length
    ? await reader
        .select({
          employeeId: schema.employeeSkills.employeeId,
          simperCodeId: schema.employeeSkills.simperCodeId,
        })
        .from(schema.employeeSkills)
        .where(inArray(schema.employeeSkills.employeeId, spareIds))
    : [];
  const skills = new Map<string, Set<string>>();
  for (const k of skillRows) {
    const set = skills.get(k.employeeId) ?? new Set<string>();
    set.add(k.simperCodeId);
    skills.set(k.employeeId, set);
  }

  const holders = new Map<string, GenerateUnit["holders"]>();
  for (const h of holderRows) {
    const list = holders.get(h.unitId) ?? [];
    list.push({
      employeeId: h.employeeId,
      nik: h.nik,
      name: h.name,
      status: h.status,
      rosterCode: codes.get(h.employeeId) ?? null,
    });
    holders.set(h.unitId, list);
  }

  const units: GenerateUnit[] = unitRows.map((u) => ({
    ...u,
    holders: holders.get(u.id) ?? [],
  }));
  const spares: GenerateSpare[] = spareRows.map((s) => ({
    ...s,
    rosterCode: codes.get(s.id) ?? null,
    simperCodeIds: skills.get(s.id) ?? new Set(),
  }));
  const slotIdOf = new Map(
    holderRows.map((h) => [`${h.unitId}|${h.employeeId}`, h.slotId])
  );
  return { units, spares, slotIdOf };
}

async function outcomeOf(
  reader: Reader,
  now: Date,
  lockedIds?: string[]
): Promise<{
  date: string;
  shift: ShiftKind;
  outcome: GenerateOutcome;
  slotIdOf: Map<string, string>;
}> {
  const date = localDate(now);
  const shift = generateShiftAt(now);
  const { units, spares, slotIdOf } = await generateInput(
    reader,
    date,
    lockedIds
  );
  return {
    date,
    shift,
    outcome: planGenerate({ units, spares, shift, today: date }),
    slotIdOf,
  };
}

/** Thrown inside the transaction to roll it back with a 409. */
class GenerateConflict extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export const planGenerateRoutes = new Elysia({
  prefix: "/fleet-allocation",
  tags: ["fleet-allocation"],
})
  .use(requireAuth)

  .get(
    "/plan/generate/preview",
    async () => {
      const { date, shift, outcome } = await outcomeOf(db, new Date());
      return {
        date,
        shift,
        assign: outcome.assign.map((a) => ({
          unit: a.unit,
          simperCode: a.simperCode,
          priority: a.priority,
          nik: a.nik,
          name: a.name,
          released: a.released && {
            nik: a.released.nik,
            name: a.released.name,
            rosterCode: a.released.rosterCode,
            standby: a.released.standby,
          },
        })),
        unfilled: outcome.unfilled.map((u) => ({
          unit: u.unit,
          simperCode: u.simperCode,
          priority: u.priority,
        })),
        sparesLeft: outcome.sparesLeft,
        token: generateToken(outcome),
      };
    },
    {
      auth: { menu: "fleet-allocation", mode: "view" },
      response: {
        200: PlanGeneratePreviewSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: {
        summary:
          "What Generate would do: the clock's shift, each empty unit's spare, the units left empty",
      },
    }
  )

  .post(
    "/plan/generate",
    async ({ body, status, principal }) => {
      const actor = planActorOf(principal);
      try {
        return await db.transaction(async (tx) => {
          // Give up rather than queue behind a long write: the dialog says
          // try again, which beats a spinner that never ends.
          await tx.execute(
            sql.raw(`set local lock_timeout = '${LOCK_TIMEOUT}'`)
          );
          await tx.execute(
            sql`select pg_advisory_xact_lock(${PLAN_DEFAULT_LOCK})`
          );
          // Every unit in allocation, sorted, so a dialog write on any of them
          // waits rather than slipping between this read and these writes.
          const locked = await tx
            .select({ id: schema.units.id })
            .from(schema.units)
            .where(inAllocation)
            .orderBy(asc(schema.units.id))
            .for("update");

          const { shift, outcome, slotIdOf } = await outcomeOf(
            tx,
            new Date(),
            locked.map((u) => u.id)
          );
          if (shift !== body.shift)
            throw new GenerateConflict(
              "shift_changed",
              "Shift sudah berganti sejak pratinjau — buka Generate lagi"
            );
          if (generateToken(outcome) !== body.token)
            throw new GenerateConflict(
              "preview_stale",
              "PLAN berubah sejak pratinjau — buka Generate lagi"
            );

          const toRelease = outcome.assign.flatMap((a) =>
            a.released
              ? [
                  {
                    unitId: a.unitId,
                    ...a.released,
                    slotId: slotIdOf.get(
                      `${a.unitId}|${a.released.employeeId}`
                    )!,
                  },
                ]
              : []
          );
          // `returning`, so a holder unpaired by hand a moment earlier does
          // not get a second "released" line in the history.
          const gone = new Set(
            toRelease.length
              ? (
                  await tx
                    .delete(schema.fleetPlanSlots)
                    .where(
                      inArray(
                        schema.fleetPlanSlots.id,
                        toRelease.map((r) => r.slotId)
                      )
                    )
                    .returning({ id: schema.fleetPlanSlots.id })
                ).map((r) => r.id)
              : []
          );
          const released = toRelease.filter((r) => gone.has(r.slotId));
          if (outcome.assign.length)
            await tx.insert(schema.fleetPlanSlots).values(
              outcome.assign.map((a) => ({
                unitId: a.unitId,
                employeeId: a.employeeId,
              }))
            );

          // Releases first, as in Reset: off the unit, then the spare on.
          await recordPlanChanges(
            tx,
            released.map((r) => ({
              unitId: r.unitId,
              employeeId: r.employeeId,
              nik: r.nik,
              name: r.name,
              action: "released" as const,
            })),
            "generate",
            actor
          );
          await recordPlanChanges(
            tx,
            outcome.assign.map((a) => ({
              unitId: a.unitId,
              employeeId: a.employeeId,
              nik: a.nik,
              name: a.name,
              action: "assigned" as const,
            })),
            "generate",
            actor
          );

          return {
            assigned: outcome.assign.length,
            released: released.length,
            unfilled: outcome.unfilled.length,
          };
        });
      } catch (error) {
        if (error instanceof GenerateConflict)
          return status(409, { code: error.code, message: error.message });
        // A spare paired by hand on a unit outside allocation meanwhile.
        if (isUniqueViolation(error, "fleet_plan_slots_employee_id_unique"))
          return status(409, {
            code: "operator_busy",
            message:
              "Seorang operator baru saja dipasangkan di papan — coba Generate lagi",
          });
        if (isLockConflict(error))
          return status(409, {
            code: "plan_busy",
            message: "PLAN sedang diubah di tempat lain — coba Generate lagi",
          });
        throw error;
      }
    },
    {
      auth: { menu: "fleet-allocation", mode: "manage" },
      body: t.Object({
        shift: ShiftSchema,
        token: t.String({ minLength: 1 }),
      }),
      response: {
        200: PlanGenerateResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: {
        summary:
          "Pair the shift's spares with its empty units in the PLAN, exactly as previewed (409 shift_changed, preview_stale, plan_busy)",
      },
    }
  );
