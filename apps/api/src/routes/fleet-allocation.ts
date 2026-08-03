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
  type PlanImportPreview,
  type RosterCodeKind,
  type UnitStatus,
} from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { db, isUniqueViolation, schema } from "../db";
import { localDate } from "../scheduler";
import {
  buildPlanTemplate,
  pairingConflicts,
  validatePlanWorkbook,
  type ParsedPlanRow,
  type PlanCatalogues,
} from "./fleet-allocation-import";
import { MAX_IMPORT_BYTES } from "./import-columns";
import {
  ErrorSchema,
  PlanImportPreviewSchema,
  PlanImportResultSchema,
  UnitStatusSchema,
} from "./schemas";
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
export async function shiftKinds(
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
export async function unitByCode(code: string) {
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

export type AllocUnit = NonNullable<Awaited<ReturnType<typeof unitByCode>>>;

/** An operator as eligibility needs them, by NIK. */
export async function personByNik(nik: string) {
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
    .where(eq(schema.employees.nik, nik))
    .limit(1);
  return person;
}

export type AllocPerson = NonNullable<Awaited<ReturnType<typeof personByNik>>>;

/**
 * The eligibility rules, worded once. The single-slot route and the
 * spreadsheet import both refuse through this — an import that validated
 * less would be the path operators route around the dialog through.
 *
 * Returns the refusal message, or null when the pairing is sound.
 */
export async function refusePairing(
  unit: AllocUnit,
  person: AllocPerson
): Promise<string | null> {
  if (person.statusValue !== "aktif")
    return `Karyawan ${person.nik} sudah tidak aktif`;
  if (!person.fleetAllocation)
    return `Posisi "${person.positionName}" tidak masuk alokasi fleet — tandai posisinya di master Posisi bila memang seharusnya`;
  if (unit.departmentId && person.departmentId !== unit.departmentId)
    return `Unit ${unit.code} milik departemen "${unit.departmentName}" — operatornya harus dari departemen itu`;
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
      return `${person.name} tidak memegang kode SIMPER "${unit.simperCodeName}" yang unit ini butuhkan`;
    const today = localDate(new Date());
    if (person.simperExp !== null && person.simperExp < today)
      return `SIMPER ${person.name} kedaluwarsa ${person.simperExp} — perpanjang dulu sebelum dipasangkan`;
  }
  return null;
}

/* -------------------------------------------------------------- import */

/** Everything the parser needs to resolve codes and read the current plan. */
async function planCatalogues(): Promise<PlanCatalogues> {
  const units = await db
    .select({ id: schema.units.id, code: schema.units.code })
    .from(schema.units)
    .where(eq(schema.units.active, true));
  const people = await db
    .select({
      id: schema.employees.id,
      nik: schema.employees.nik,
      name: schema.employees.name,
    })
    .from(schema.employees);
  const slots = await db
    .select({
      unitId: schema.fleetPlanSlots.unitId,
      unitCode: schema.units.code,
      employeeId: schema.fleetPlanSlots.employeeId,
    })
    .from(schema.fleetPlanSlots)
    .innerJoin(schema.units, eq(schema.units.id, schema.fleetPlanSlots.unitId));

  const heldByUnit = new Map<string, string[]>();
  for (const s of slots)
    heldByUnit.set(s.unitId, [
      ...(heldByUnit.get(s.unitId) ?? []),
      s.employeeId,
    ]);

  return {
    unitsByCode: new Map(units.map((u) => [u.code.toLowerCase(), u])),
    peopleByNik: new Map(people.map((p) => [p.nik, p])),
    slotOf: new Map(
      slots.map((s) => [
        s.employeeId,
        { unitId: s.unitId, unitCode: s.unitCode },
      ])
    ),
    heldByUnit,
  };
}

type PlanImportOutcome = {
  preview: PlanImportPreview;
  rows: ParsedPlanRow[];
};

/**
 * Parse, hold every surviving row against `refusePairing` — the same
 * function the dialog goes through — then judge capacity and the Day/Night
 * pair against the effective plan.
 */
async function parsePlanImport(
  file: File
): Promise<PlanImportOutcome | { code: string; message: string }> {
  const catalogues = await planCatalogues();
  const parsed = await validatePlanWorkbook(
    await file.arrayBuffer(),
    catalogues
  );
  if ("code" in parsed) return parsed;

  const errors = [...parsed.errors];
  const eligible: ParsedPlanRow[] = [];
  for (const row of parsed.rows) {
    const unit = await unitByCode(row.preview.unit);
    const person = await personByNik(row.preview.nik);
    // Both resolved a moment ago in the parse; vanishing between the two
    // reads is a re-validate case, not a crash.
    if (!unit || !person) continue;
    const refusal = await refusePairing(unit, person);
    if (refusal) {
      errors.push({
        row: String(row.preview.row),
        nik: row.preview.nik,
        emp: row.preview.name,
        issue: refusal,
        badgeVariant: "danger",
        badge: "Error",
      });
      continue;
    }
    eligible.push(row);
  }

  const today = localDate(new Date());
  const involved = new Set<string>(eligible.map((r) => r.employeeId));
  for (const held of catalogues.heldByUnit.values())
    for (const id of held) involved.add(id);
  const shiftOf = await shiftKinds([...involved], today);

  const conflicts = pairingConflicts(eligible, catalogues, shiftOf);
  errors.push(...conflicts.errors);
  errors.sort((a, b) => Number(a.row) - Number(b.row));

  const rows = conflicts.rows;
  return {
    preview: {
      fileName: file.name,
      newCount: rows.filter((r) => r.preview.kind === "new").length,
      movedCount: rows.filter((r) => r.preview.kind === "moved").length,
      unchangedCount: rows.filter((r) => r.preview.kind === "unchanged").length,
      errorCount: errors.length,
      rows: rows.map((r) => r.preview),
      errors,
    },
    rows,
  };
}

/**
 * A conflict the commit's own recheck finds under lock — the race between
 * validation's read and the write. Thrown to roll the transaction back.
 */
class PlanImportConflict extends Error {
  constructor(
    readonly httpStatus: 409 | 422,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
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

  /* -------------------------------------------------------------- import */

  .get(
    "/plan/import/template",
    async ({ set }) => {
      set.headers["content-type"] =
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      set.headers["content-disposition"] =
        'attachment; filename="template_plan.xlsx"';
      return new Response(new Uint8Array(await buildPlanTemplate()));
    },
    {
      auth: { menu: "fleet-allocation", mode: "manage" },
      // Described by hand rather than with a `response` schema: the body is a
      // binary workbook, and a TypeBox schema would try to validate it.
      detail: {
        summary: "Download the PLAN import template (.xlsx)",
        responses: {
          200: {
            description: "An .xlsx with the columns unit, nik",
            content: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                { schema: { type: "string", format: "binary" } },
            },
          },
          401: { description: "No session" },
          403: { description: "Lacks manage on the fleet-allocation menu" },
        },
      },
    }
  )

  .post(
    "/plan/import/validate",
    async ({ body, status }) => {
      const outcome = await parsePlanImport(body.file);
      if ("code" in outcome) return status(422, outcome);
      return outcome.preview;
    },
    {
      auth: { menu: "fleet-allocation", mode: "manage" },
      body: t.Object({ file: t.File({ maxSize: MAX_IMPORT_BYTES }) }),
      response: {
        200: PlanImportPreviewSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: {
        summary: "Validate a PLAN spreadsheet and preview the pairings",
      },
    }
  )

  .post(
    "/plan/import/commit",
    async ({ body, status }) => {
      // Re-validated rather than trusted from the client: the preview the
      // caller saw is advisory, this parse is what gets written.
      const outcome = await parsePlanImport(body.file);
      if ("code" in outcome) return status(422, outcome);
      if (outcome.preview.errorCount > 0)
        return status(422, {
          code: "validation_failed",
          message: `${outcome.preview.errorCount} baris masih bermasalah`,
        });

      const writes = outcome.rows.filter((r) => r.preview.kind !== "unchanged");
      const moved = writes.filter((r) => r.fromUnitId !== null);
      if (!writes.length) return { created: 0, moved: 0 };

      const today = localDate(new Date());

      try {
        await db.transaction(async (tx) => {
          // The unit rows are the locks, taken in one sorted set so two
          // imports (or an import and the dialog) serialise instead of
          // deadlocking. Everything the file touches is locked: targets,
          // and the units moves release.
          const lockIds = [
            ...new Set([
              ...writes.map((r) => r.unitId),
              ...moved.map((r) => r.fromUnitId!),
            ]),
          ].sort();
          await tx
            .select({ id: schema.units.id })
            .from(schema.units)
            .where(inArray(schema.units.id, lockIds))
            .for("update");

          if (moved.length)
            await tx.delete(schema.fleetPlanSlots).where(
              inArray(
                schema.fleetPlanSlots.employeeId,
                moved.map((r) => r.employeeId)
              )
            );
          await tx.insert(schema.fleetPlanSlots).values(
            writes.map((r) => ({
              unitId: r.unitId,
              employeeId: r.employeeId,
            }))
          );

          // The recheck under lock — validation read the plan a moment
          // before this transaction, and the dialog may have written in
          // between. Capacity and the pair rule are re-judged on what the
          // table now actually holds; a violation rolls the whole file back.
          const targets = [...new Set(writes.map((r) => r.unitId))];
          const codeOf = new Map(writes.map((r) => [r.unitId, r.preview.unit]));
          const held = await tx
            .select({
              unitId: schema.fleetPlanSlots.unitId,
              employeeId: schema.fleetPlanSlots.employeeId,
            })
            .from(schema.fleetPlanSlots)
            .where(inArray(schema.fleetPlanSlots.unitId, targets));
          const byUnit = new Map<string, string[]>();
          for (const h of held)
            byUnit.set(h.unitId, [
              ...(byUnit.get(h.unitId) ?? []),
              h.employeeId,
            ]);

          for (const [unitId, ids] of byUnit)
            if (ids.length > FA_PLAN_MAX_OPS)
              throw new PlanImportConflict(
                409,
                "unit_full",
                `Unit ${codeOf.get(unitId)} baru saja terisi penuh — validasi ulang filenya`
              );

          const kinds = await shiftKinds(
            held.map((h) => h.employeeId),
            today
          );
          for (const [unitId, ids] of byUnit) {
            if (ids.length < 2) continue;
            const pair = ids
              .map((id) => kinds.get(id))
              .filter((k): k is "day" | "night" => k !== undefined);
            if (pair.length === 2 && pair[0] === pair[1])
              throw new PlanImportConflict(
                422,
                "validation_failed",
                `Pasangan unit ${codeOf.get(unitId)} baru saja menjadi sama-sama shift ${
                  pair[0] === "day" ? "pagi" : "malam"
                } — validasi ulang filenya`
              );
          }
        });
      } catch (error) {
        if (error instanceof PlanImportConflict)
          return status(error.httpStatus, {
            code: error.code,
            message: error.message,
          });
        // The race the locks cannot see: an operator paired with another
        // unit between the read and this insert.
        if (isUniqueViolation(error, "fleet_plan_slots_employee_id_unique"))
          return status(409, {
            code: "operator_busy",
            message:
              "Seorang operator dalam file ini baru saja dipasangkan dengan unit lain — validasi ulang filenya",
          });
        throw error;
      }

      return {
        created: writes.length - moved.length,
        moved: moved.length,
      };
    },
    {
      auth: { menu: "fleet-allocation", mode: "manage" },
      body: t.Object({ file: t.File({ maxSize: MAX_IMPORT_BYTES }) }),
      response: {
        200: PlanImportResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Commit a validated PLAN spreadsheet" },
    }
  )

  .post(
    "/plan/slots",
    async ({ body, status }) => {
      const unit = await unitByCode(body.unitCode);
      if (!unit) return status(404, unitNotFound);

      const person = await personByNik(body.nik);
      if (!person)
        return status(404, {
          code: "employee_not_found",
          message: "Karyawan tidak ditemukan",
        });

      const refuse = (message: string) =>
        status(422, { code: "validation_failed", message });

      const refusal = await refusePairing(unit, person);
      if (refusal) return refuse(refusal);

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
