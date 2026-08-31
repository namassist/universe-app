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

import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Elysia, t } from "elysia";
import { SHIFT_KINDS, type ShiftKind } from "@universe/contracts";

import { buildBoard, storeBoard } from "../allocation";
import { currentShift } from "../current-shift";
import { requireAuth } from "../auth/macro";
import { db, schema } from "../db";
import { fingerInDeadline, ftwDeadline, judge, shiftIn } from "../readiness";
import { stageGates } from "../stage-time";
import { pairingRefusal } from "./fleet-allocation";
import { localDate } from "../scheduler";
import { normalizeNik } from "../sources/nik";
import {
  ActualBoardSchema,
  ActualCandidateSchema,
  ActualDocumentSchema,
  ErrorSchema,
  FleetDisplaySchema,
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

const digger = alias(schema.units, "digger_unit");

/**
 * The slots of one board, joined to what a screen needs to name them.
 *
 * The fleet embed mirrors the PLAN board's, and by the same join: a unit
 * belongs to a fleet either as its digger or as one of its members, so the
 * condition is an `or` rather than one foreign key. The Actual board groups by
 * fleet exactly as PLAN does — a formation is how the yard thinks about its
 * machines, and a flat list of unit codes makes the reader rebuild it.
 */
async function boardSlots(documentId: string) {
  return db
    .select({
      unitId: schema.fleetActualSlots.unitId,
      unitCode: schema.units.code,
      requiresFtw: schema.units.ftw,
      simperCodeName: schema.simperCodes.name,
      departmentName: schema.departments.name,
      modelName: schema.unitModels.name,
      brandName: schema.unitBrands.name,
      fleetId: schema.fleets.id,
      diggerCode: digger.code,
      area: schema.workAreas.name,
      employeeId: schema.fleetActualSlots.employeeId,
      source: schema.fleetActualSlots.source,
      tappedAt: schema.fleetActualSlots.tappedAt,
    })
    .from(schema.fleetActualSlots)
    .innerJoin(
      schema.units,
      eq(schema.units.id, schema.fleetActualSlots.unitId)
    )
    .innerJoin(
      schema.unitModels,
      eq(schema.unitModels.id, schema.units.modelId)
    )
    .innerJoin(
      schema.unitBrands,
      eq(schema.unitBrands.id, schema.units.brandId)
    )
    .leftJoin(
      schema.simperCodes,
      eq(schema.simperCodes.id, schema.units.simperCodeId)
    )
    .leftJoin(
      schema.departments,
      eq(schema.departments.id, schema.units.departmentId)
    )
    .leftJoin(schema.fleetUnits, eq(schema.fleetUnits.unitId, schema.units.id))
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
    .where(eq(schema.fleetActualSlots.documentId, documentId))
    .orderBy(asc(schema.units.code));
}

const busUnit = alias(schema.units, "bus_unit");

/**
 * Each fleet's bus, by fleet id. Separate from `boardSlots` on purpose: the
 * bus is a property of the *formation*, shown once in a group header, and
 * joining it per slot would carry the same code down every hauler row for the
 * two screens that have no use for it.
 */
async function fleetBuses(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db
    .select({ fleetId: schema.fleets.id, busCode: busUnit.code })
    .from(schema.fleets)
    .innerJoin(busUnit, eq(busUnit.id, schema.fleets.busUnitId))
    .where(inArray(schema.fleets.id, ids));
  return new Map(rows.map((r) => [r.fleetId, r.busCode]));
}

/**
 * The standing PLAN, as it would fall on one date and shift — the provisional
 * line-up a wall shows while the board is still being built.
 *
 * **The shift comes from the roster, not from the plan.** `fleet_plan_slots`
 * holds no shift at all: a unit may carry two standing operators, and which of
 * them is "today's" is settled by each one's roster code for the date. So the
 * pairing only counts when its operator is rostered `D` (or `N`) that day, and
 * a unit whose planned operator is off shows as unmanned rather than showing
 * the wrong name — which is exactly the mistake this join exists to prevent.
 *
 * Same joins as `boardSlots` otherwise, so both answers group and read alike.
 */
export async function planSlots(date: string, shift: ShiftKind) {
  const rows = await db
    .select({
      unitId: schema.units.id,
      unitCode: schema.units.code,
      requiresFtw: schema.units.ftw,
      modelName: schema.unitModels.name,
      brandName: schema.unitBrands.name,
      fleetId: schema.fleets.id,
      diggerCode: digger.code,
      area: schema.workAreas.name,
      employeeId: schema.fleetPlanSlots.employeeId,
      /** Non-null only when that operator is rostered to *this* shift. */
      rosterId: schema.rosterDays.id,
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
      schema.fleetPlanSlots,
      eq(schema.fleetPlanSlots.unitId, schema.units.id)
    )
    .leftJoin(
      schema.rosterDays,
      and(
        eq(schema.rosterDays.employeeId, schema.fleetPlanSlots.employeeId),
        eq(schema.rosterDays.date, date),
        eq(schema.rosterDays.code, shift === "day" ? "D" : "N")
      )
    )
    .leftJoin(schema.fleetUnits, eq(schema.fleetUnits.unitId, schema.units.id))
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
    .where(
      and(
        eq(schema.units.active, true),
        // The same two exclusions the board makes: neither needs an operator.
        eq(schema.units.breakdown, false),
        eq(schema.units.standby, false)
      )
    )
    .orderBy(asc(schema.units.code));

  // A unit with two standing operators arrives as two rows, and only the one
  // rostered today carries a roster id. Collapse to one row per unit, keeping
  // that one — and keeping the unit, unmanned, when neither is on today.
  const byUnit = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const kept = byUnit.get(row.unitId);
    if (!kept || (!kept.rosterId && row.rosterId)) byUnit.set(row.unitId, row);
  }
  return [...byUnit.values()].map((r) => ({
    ...r,
    employeeId: r.rosterId ? r.employeeId : null,
  }));
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

/**
 * A screen with no rotation of its own falls back to this, and so does a
 * person previewing the wall from a browser. Thirty seconds is long enough to
 * read every name in a formation before it moves.
 */
const DEFAULT_ROTATE_SECONDS = 30;

/** The formations one screen was given. Empty set means it was given none. */
async function deviceFleetScope(deviceId: string): Promise<Set<string>> {
  const rows = await db
    .select({ fleetId: schema.deviceFleets.fleetId })
    .from(schema.deviceFleets)
    .where(eq(schema.deviceFleets.deviceId, deviceId));
  return new Set(rows.map((r) => r.fleetId));
}

/** A registered fleet wall, or nothing. Other kinds never answer here. */
async function fleetScreen(deviceId: string) {
  const [row] = await db
    .select({
      id: schema.devices.id,
      rotateSeconds: schema.devices.rotateSeconds,
    })
    .from(schema.devices)
    .where(
      and(eq(schema.devices.id, deviceId), eq(schema.devices.kind, "fleet"))
    )
    .limit(1);
  return row;
}

/** One unit as the wall reads it — the board row, already named. */
export type WallSlot = {
  unitId: string;
  unitCode: string;
  modelName: string;
  brandName: string;
  fleetId: string | null;
  diggerCode: string | null;
  area: string | null;
  employeeNik: string | null;
  employeeName: string | null;
  source: "plan" | "spare" | "manual" | null;
  tappedAt: string | null;
};

export type WallFleet = {
  id: string;
  diggerCode: string;
  area: string | null;
  busCode: string | null;
  /** This formation's own counts — the wall reports the fleet, not the site. */
  total: number;
  crewed: number;
  idle: number;
  /** Crewed by someone other than the planned holder: spare or manual. */
  substituted: number;
  units: Omit<WallSlot, "fleetId" | "diggerCode" | "area">[];
};

/**
 * The board, arranged into the formations a wall rotates through.
 *
 * **Units belonging to no fleet are dropped** (owner, 2026-08-29). The wall
 * answers one question — how each formation is crewed — and a unit that is in
 * no formation has no answer to contribute. They remain on the Actual board,
 * where a supervisor sees and fills them; it is only the TV that is scoped.
 *
 * Counts are per formation for the same reason: someone standing in front of
 * the Pit 3 screen acts on Pit 3, and a site-wide number there would be read
 * as that fleet's and be wrong.
 *
 * Pure, and tested as such: the endpoint around it cannot be pinned down
 * without also pinning down the clock and the timeline, and the arrangement —
 * which unit leads, which formation comes first, what is left out — is the
 * part that would be wrong in a way nobody notices from a screenshot.
 */
export function groupIntoFleets(
  slots: WallSlot[],
  buses: Map<string, string>,
  /** The screen's own formations; `null` (or empty) means every one of them. */
  scope: Set<string> | null = null
): WallFleet[] {
  const wanted = scope && scope.size ? scope : null;
  const groups = new Map<string, WallFleet>();
  for (const s of slots) {
    if (!s.fleetId || !s.diggerCode) continue;
    if (wanted && !wanted.has(s.fleetId)) continue;
    let group = groups.get(s.fleetId);
    if (!group) {
      group = {
        id: s.fleetId,
        diggerCode: s.diggerCode,
        area: s.area,
        busCode: buses.get(s.fleetId) ?? null,
        total: 0,
        crewed: 0,
        idle: 0,
        substituted: 0,
        units: [],
      };
      groups.set(s.fleetId, group);
    }
    group.total += 1;
    if (s.employeeName) group.crewed += 1;
    else group.idle += 1;
    if (s.source === "spare" || s.source === "manual") group.substituted += 1;
    group.units.push({
      unitId: s.unitId,
      unitCode: s.unitCode,
      modelName: s.modelName,
      brandName: s.brandName,
      employeeNik: s.employeeNik,
      employeeName: s.employeeName,
      source: s.source,
      tappedAt: s.tappedAt,
    });
  }

  // The digger leads its own formation — a fleet is read as "EX-22 and what
  // hauls for it", not as an alphabetical list of unit codes.
  for (const group of groups.values())
    group.units.sort((a, b) => {
      const lead = (u: { unitCode: string }) =>
        u.unitCode === group.diggerCode ? 0 : 1;
      return lead(a) - lead(b) || a.unitCode.localeCompare(b.unitCode);
    });

  return [...groups.values()].sort((a, b) =>
    a.diggerCode.localeCompare(b.diggerCode)
  );
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

  /**
   * What the fleet TV renders — the running shift's board, in formations.
   *
   * Declared before `/:date/:shift` for the same reason the fingerprint wall's
   * is: a literal segment must never be read as an identifier. The shift is
   * chosen here rather than passed in, because the screen has no operator to
   * choose it, and it is chosen from the timeline's own gates so the wall and
   * the board always mean the same shift.
   *
   * It never fails on an empty answer. A wall that renders an error renders
   * nothing, and "no board yet" is a reading in its own right — one the screen
   * says out loud instead of going blank.
   */
  .get(
    "/display",
    async ({ principal, query, status }) => {
      if (principal.kind === "device" && principal.deviceKind !== "fleet")
        return status(403, {
          code: "forbidden",
          message: "Perangkat ini bukan untuk layar tersebut",
        });

      /**
       * Whose settings this answer carries.
       *
       * A TV answers as itself and may never ask about another screen —
       * `?device=` is ignored on a device session precisely so a paired kiosk
       * cannot read a wall it was not given. A signed-in person previewing one
       * *names* it, and then sees exactly what that TV sees: its formations
       * and its dwell. Previewing is how the settings are checked, so a
       * preview that quietly used defaults would report the wrong thing about
       * every change made — which is the bug this replaced.
       *
       * With no device named, a person gets the whole board at the default
       * dwell: they are looking at the site, not at one pit's screen.
       */
      const screen =
        principal.kind === "device"
          ? await fleetScreen(principal.id)
          : query.device
            ? await fleetScreen(query.device)
            : undefined;

      // Only reachable from a browser: a TV never sends the parameter, and a
      // real one always resolves. Saying so beats silently serving defaults.
      if (principal.kind === "user" && query.device && !screen)
        return status(404, {
          code: "device_not_found",
          message: "Display fleet tersebut tidak ditemukan",
        });

      const scope = screen ? await deviceFleetScope(screen.id) : null;
      const rotate = screen?.rotateSeconds ?? DEFAULT_ROTATE_SECONDS;

      const blank = {
        servedAt: new Date().toISOString(),
        date: null as string | null,
        shift: null as ShiftKind | null,
        generatedAt: null as string | null,
        provisional: false,
        rotateSeconds: rotate,
        fleets: [],
      };

      // `ftw-ingest`, not `finger-in`: the wall turns over when a shift's
      // changeover begins, so the incoming crew sees its line-up on the way
      // in rather than only once the board is final.
      const now = currentShift(new Date(), await stageGates("ftw-ingest"));
      if (!now) return blank;

      const doc = await documentOf(now.date, now.shift);

      /*
       * No board yet — so the wall shows the standing plan for this shift,
       * marked provisional (owner, 2026-08-29). Between a shift's changeover
       * opening and its board being generated there is a real gap, twice a
       * day, and it is the exact window in which arriving operators most want
       * to know their unit. A blank screen there is the least useful thing the
       * wall could do; a line-up that says out loud it is not final is the
       * most. The provisional flag persisting past `spare-validate` is also
       * the standing alarm that nobody generated the board.
       */
      const provisional = !doc;
      const rows = doc
        ? await boardSlots(doc.id)
        : (await planSlots(now.date, now.shift)).map((r) => ({
            ...r,
            simperCodeName: null,
            departmentName: null,
            // Everyone on a plan board is there by plan; nobody is a spare
            // until the engine has actually looked at who turned up.
            source: (r.employeeId ? "plan" : null) as
              "plan" | "spare" | "manual" | null,
            tappedAt: null as string | null,
          }));
      const slots = rows;
      const names = await peopleNames(
        slots.map((s) => s.employeeId).filter((id): id is string => !!id)
      );
      const buses = await fleetBuses([
        ...new Set(
          slots.map((s) => s.fleetId).filter((id): id is string => !!id)
        ),
      ]);

      return {
        servedAt: new Date().toISOString(),
        date: now.date,
        shift: now.shift,
        generatedAt: doc?.generatedAt.toISOString() ?? null,
        provisional,
        rotateSeconds: rotate,
        fleets: groupIntoFleets(
          slots.map((s) => {
            const person = s.employeeId ? names.get(s.employeeId) : undefined;
            return {
              unitId: s.unitId,
              unitCode: s.unitCode,
              modelName: s.modelName,
              brandName: s.brandName,
              fleetId: s.fleetId,
              diggerCode: s.diggerCode,
              area: s.area,
              employeeNik: person?.nik ?? null,
              employeeName: person?.name ?? null,
              source: s.source,
              tappedAt: s.tappedAt,
            };
          }),
          buses,
          scope
        ),
      };
    },
    {
      auth: { menu: "display-fleet", mode: "view", allowDevice: true },
      /** Which screen to answer as — browsers previewing a TV, nobody else. */
      query: t.Object({ device: t.Optional(t.String({ minLength: 1 })) }),
      response: {
        200: FleetDisplaySchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "The running shift's board, for the fleet TV" },
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
        /** The filter's options, so the screen does not derive them itself. */
        fleets: [
          ...new Map(
            slots
              .filter((s) => s.fleetId && s.diggerCode)
              .map((s) => [
                s.fleetId!,
                { id: s.fleetId!, diggerCode: s.diggerCode! },
              ])
          ).values(),
        ],
        slots: slots.map((s) => ({
          unitId: s.unitId,
          unitCode: s.unitCode,
          requiresFtw: s.requiresFtw,
          simperCodeName: s.simperCodeName,
          departmentName: s.departmentName,
          modelName: s.modelName,
          brandName: s.brandName,
          fleet:
            s.fleetId && s.diggerCode
              ? { id: s.fleetId, diggerCode: s.diggerCode, area: s.area }
              : null,
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
      const uploadClose = await ftwDeadline(params.shift);
      if (!uploadClose)
        return status(422, {
          code: "no_deadline",
          message: `Tahap "Batas Upload FTW" untuk shift ${params.shift === "day" ? "siang" : "malam"} tidak aktif — atur dulu di menu Timeline`,
        });
      const board = await buildBoard(
        params.date,
        params.shift,
        deadline,
        uploadClose
      );
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
      const uploadClose = await ftwDeadline(params.shift);
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
          finger: shiftIn(F.get(nik) ?? null, params.shift),
          requiresFtw: unit.requiresFtw,
          // Both fall back to midnight rather than to a permissive value: an
          // unconfigured stage must refuse everyone loudly, not pass everyone
          // quietly. The screen still lists them, with the reason attached.
          deadline: deadline ?? "00:00:00",
          ftwDeadline: uploadClose ?? "00:00:00",
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
          /** When the FTW was uploaded — what makes "late" actionable. */
          sentAt: readiness.sentAt,
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
