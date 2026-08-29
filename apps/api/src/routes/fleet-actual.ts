/**
 * The Actual board: what became of the plan on one date, for one shift.
 *
 * The engine writes these rows at `spare-validate`; this route is how people
 * read and correct them. Corrections are ordinary writes — the board is never
 * frozen (owner, 2026-08-29), so there is no cutoff after which a supervisor
 * stops being able to fix it, and no history of what it said before.
 *
 * Generating is offered here as well as on the timeline because a board can be
 * wanted before its stage fires, or again after someone re-uploads a roster.
 * It **replaces**: one document per date × shift, so regenerating re-answers
 * the same morning rather than filing a second opinion about it.
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { SHIFT_KINDS, type ShiftKind } from "@universe/contracts";

import { buildBoard, storeBoard } from "../allocation";
import { requireAuth } from "../auth/macro";
import { db, schema } from "../db";
import { fingerInDeadline, judge } from "../readiness";
import { pairingRefusal } from "./fleet-allocation";
import { localDate } from "../scheduler";
import { normalizeNik } from "../sources/nik";
import {
  ActualBoardSchema,
  ActualCandidateSchema,
  ActualDocumentSchema,
  ErrorSchema,
} from "./schemas";

const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

const noBoard = {
  code: "board_not_found",
  message: "Papan untuk tanggal dan shift itu belum dibuat",
};

/** Params every board route shares. */
const BoardParams = t.Object({
  date: t.String({ pattern: DATE_PATTERN }),
  shift: t.UnionEnum(SHIFT_KINDS),
});

/** The slots of one board, joined to what a screen needs to name them. */
async function boardSlots(documentId: string) {
  return db
    .select({
      unitId: schema.fleetActualSlots.unitId,
      unitCode: schema.units.code,
      requiresFtw: schema.units.ftw,
      simperCodeName: schema.simperCodes.name,
      departmentName: schema.departments.name,
      employeeId: schema.fleetActualSlots.employeeId,
      source: schema.fleetActualSlots.source,
      tappedAt: schema.fleetActualSlots.tappedAt,
    })
    .from(schema.fleetActualSlots)
    .innerJoin(
      schema.units,
      eq(schema.units.id, schema.fleetActualSlots.unitId)
    )
    .leftJoin(
      schema.simperCodes,
      eq(schema.simperCodes.id, schema.units.simperCodeId)
    )
    .leftJoin(
      schema.departments,
      eq(schema.departments.id, schema.units.departmentId)
    )
    .where(eq(schema.fleetActualSlots.documentId, documentId))
    .orderBy(asc(schema.units.code));
}

async function documentOf(date: string, shift: ShiftKind) {
  const [doc] = await db
    .select()
    .from(schema.fleetActualDocuments)
    .where(
      and(
        eq(schema.fleetActualDocuments.date, date),
        eq(schema.fleetActualDocuments.shift, shift)
      )
    )
    .limit(1);
  return doc;
}

/** Names for the ids a board carries, in one query rather than per row. */
async function peopleNames(ids: string[]) {
  if (!ids.length) return new Map<string, { nik: string; name: string }>();
  const rows = await db
    .select({
      id: schema.employees.id,
      nik: schema.employees.nik,
      name: schema.employees.name,
    })
    .from(schema.employees)
    .where(inArray(schema.employees.id, ids));
  return new Map(rows.map((r) => [r.id, { nik: r.nik, name: r.name }]));
}

export const fleetActualRoutes = new Elysia({
  prefix: "/fleet-allocation/actual",
  tags: ["fleet-allocation"],
})
  .use(requireAuth)

  .get(
    "/",
    async () => {
      const docs = await db
        .select()
        .from(schema.fleetActualDocuments)
        .orderBy(
          desc(schema.fleetActualDocuments.date),
          asc(schema.fleetActualDocuments.shift)
        )
        .limit(60);
      const rows = await Promise.all(
        docs.map(async (doc) => {
          const slots = await boardSlots(doc.id);
          const crewed = slots.filter((s) => s.employeeId);
          return {
            date: doc.date,
            shift: doc.shift,
            generatedAt: doc.generatedAt.toISOString(),
            total: slots.length,
            viaPlan: crewed.filter((s) => s.source === "plan").length,
            viaSpare: crewed.filter((s) => s.source === "spare").length,
            viaManual: crewed.filter((s) => s.source === "manual").length,
            /** Units nobody is on — the number this screen exists for. */
            idle: slots.length - crewed.length,
          };
        })
      );
      return rows;
    },
    {
      auth: { menu: "fleet-allocation", mode: "view" },
      response: {
        200: t.Array(ActualDocumentSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List the generated boards" },
    }
  )

  .get(
    "/:date/:shift",
    async ({ params, status }) => {
      const doc = await documentOf(params.date, params.shift);
      if (!doc) return status(404, noBoard);
      const slots = await boardSlots(doc.id);
      const names = await peopleNames(
        slots.map((s) => s.employeeId).filter((id): id is string => !!id)
      );
      return {
        date: doc.date,
        shift: doc.shift,
        generatedAt: doc.generatedAt.toISOString(),
        slots: slots.map((s) => ({
          unitId: s.unitId,
          unitCode: s.unitCode,
          requiresFtw: s.requiresFtw,
          simperCodeName: s.simperCodeName,
          departmentName: s.departmentName,
          employeeId: s.employeeId,
          employeeNik: s.employeeId
            ? (names.get(s.employeeId)?.nik ?? null)
            : null,
          employeeName: s.employeeId
            ? (names.get(s.employeeId)?.name ?? null)
            : null,
          source: s.source,
          tappedAt: s.tappedAt,
        })),
      };
    },
    {
      auth: { menu: "fleet-allocation", mode: "view" },
      params: BoardParams,
      response: {
        200: ActualBoardSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "One board, unit by unit" },
    }
  )

  .post(
    "/:date/:shift/generate",
    async ({ params, status }) => {
      const deadline = await fingerInDeadline(params.shift);
      if (!deadline)
        return status(422, {
          code: "no_deadline",
          // The engine's own refusal, surfaced rather than defaulted: with no
          // deadline there is no pass rule, and either default is wrong in a
          // way nobody would see on the screen that resulted.
          message: `Tahap "Batas Finger In" untuk shift ${params.shift === "day" ? "siang" : "malam"} tidak aktif — atur dulu di menu Timeline`,
        });
      const board = await buildBoard(params.date, params.shift, deadline);
      await storeBoard(board);
      return { ok: true, units: board.slots.length };
    },
    {
      auth: { menu: "fleet-allocation", mode: "manage" },
      params: BoardParams,
      response: {
        200: t.Object({ ok: t.Boolean(), units: t.Number() }),
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Build the board now, replacing any existing one" },
    }
  )

  .get(
    "/:date/:shift/candidates/:unitId",
    async ({ params, status }) => {
      const doc = await documentOf(params.date, params.shift);
      if (!doc) return status(404, noBoard);
      const [unit] = await db
        .select({
          id: schema.units.id,
          code: schema.units.code,
          requiresFtw: schema.units.ftw,
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
        .where(eq(schema.units.id, params.unitId))
        .limit(1);
      if (!unit)
        return status(404, {
          code: "unit_not_found",
          message: "Unit tidak ditemukan",
        });

      const deadline = await fingerInDeadline(params.shift);
      const people = await db
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
        .innerJoin(
          schema.rosterDays,
          and(
            eq(schema.rosterDays.employeeId, schema.employees.id),
            eq(schema.rosterDays.date, params.date)
          )
        )
        .where(
          and(
            eq(schema.employees.status, "aktif"),
            eq(schema.positions.fleetAllocation, true),
            eq(schema.rosterDays.code, params.shift === "day" ? "D" : "N")
          )
        )
        .orderBy(asc(schema.employees.name));

      const ftw = await db
        .select()
        .from(schema.ftwReadings)
        .where(eq(schema.ftwReadings.date, params.date));
      const finger = await db
        .select()
        .from(schema.fingerReadings)
        .where(eq(schema.fingerReadings.date, params.date));
      const W = new Map(ftw.map((r) => [r.nik, r]));
      const F = new Map(finger.map((r) => [r.nik, r]));

      // Only the code this unit asks for: the whole join table is thousands
      // of rows and every one but these is irrelevant to the question.
      const holds = new Set(
        unit.simperCodeId
          ? (
              await db
                .select({ employeeId: schema.employeeSkills.employeeId })
                .from(schema.employeeSkills)
                .where(
                  eq(schema.employeeSkills.simperCodeId, unit.simperCodeId)
                )
            ).map((r) => r.employeeId)
          : []
      );

      const onBoard = new Set(
        (await boardSlots(doc.id))
          .filter((s) => s.employeeId && s.unitId !== unit.id)
          .map((s) => s.employeeId!)
      );
      const today = localDate(new Date());

      return people.map((person) => {
        const nik = normalizeNik(person.nik);
        const readiness = judge({
          ftw: W.get(nik) ?? null,
          finger: F.get(nik) ?? null,
          requiresFtw: unit.requiresFtw,
          deadline: deadline ?? "00:00:00",
        });
        const refusal = pairingRefusal(unit, person, {
          holdsCode: unit.simperCodeId ? holds.has(person.id) : false,
          today,
        });
        return {
          employeeId: person.id,
          nik: person.nik,
          name: person.name,
          tappedAt: readiness.tappedAt,
          ftw: readiness.ftw,
          finger: readiness.finger,
          ready: readiness.passed,
          // Everything the engine weighed, said out loud. A supervisor
          // overriding it is entitled to see what it saw — and may place
          // someone it refused, which is the point of an override.
          refusal: refusal ?? null,
          onAnotherUnit: onBoard.has(person.id),
        };
      });
    },
    {
      auth: { menu: "fleet-allocation", mode: "view" },
      params: t.Object({
        date: t.String({ pattern: DATE_PATTERN }),
        shift: t.UnionEnum(SHIFT_KINDS),
        unitId: t.String({ format: "uuid" }),
      }),
      response: {
        200: t.Array(ActualCandidateSchema),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: {
        summary: "Who could take this unit, and what stands in the way",
      },
    }
  )

  .patch(
    "/:date/:shift/:unitId",
    async ({ params, body, status }) => {
      const doc = await documentOf(params.date, params.shift);
      if (!doc) return status(404, noBoard);

      if (body.employeeId) {
        // One person, one unit — the partial unique index says so too, but a
        // 409 naming the unit is more use than a constraint violation.
        const clash = (await boardSlots(doc.id)).find(
          (s) => s.employeeId === body.employeeId && s.unitId !== params.unitId
        );
        if (clash)
          return status(409, {
            code: "already_placed",
            message: `Operator itu sudah dipasang di unit ${clash.unitCode}`,
          });
      }

      const [row] = await db
        .update(schema.fleetActualSlots)
        .set({
          employeeId: body.employeeId ?? null,
          // A person put here by hand is not a plan or a spare placement, and
          // the board should not claim the engine chose them.
          source: body.employeeId ? "manual" : null,
          tappedAt: null,
        })
        .where(
          and(
            eq(schema.fleetActualSlots.documentId, doc.id),
            eq(schema.fleetActualSlots.unitId, params.unitId)
          )
        )
        .returning({ id: schema.fleetActualSlots.id });
      if (!row)
        return status(404, {
          code: "slot_not_found",
          message: "Unit itu tidak ada di papan ini",
        });
      return { ok: true };
    },
    {
      auth: { menu: "fleet-allocation", mode: "manage" },
      params: t.Object({
        date: t.String({ pattern: DATE_PATTERN }),
        shift: t.UnionEnum(SHIFT_KINDS),
        unitId: t.String({ format: "uuid" }),
      }),
      body: t.Object({
        /** null clears the unit — a vacancy is a legitimate thing to record. */
        employeeId: t.Nullable(t.String({ format: "uuid" })),
      }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
      },
      detail: { summary: "Put someone on a unit, or take them off" },
    }
  );
