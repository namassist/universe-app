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

import { buildBoard, candidates, storeBoard } from "../allocation";
import { currentShift } from "../current-shift";
import { requireAuth } from "../auth/macro";
import { db, schema } from "../db";
import { takesPartInAllocation } from "../fleet-scope";
import {
  fingerInDeadline,
  ftwDeadline,
  judge,
  shiftIn,
  type FtwVerdict,
} from "../readiness";
import { stageGates } from "../stage-time";
import { photoMimeType, photoPath } from "../storage";
import { pairingRefusal, skillNamesByEmployee } from "./fleet-allocation";
import { localDate } from "../scheduler";
import { normalizeNik } from "../sources/nik";
import {
  ActualAuditSchema,
  ActualBoardSchema,
  ActualCandidateSchema,
  ActualDocumentSchema,
  ErrorSchema,
  FleetDisplaySchema,
  ShiftKindSchema,
} from "./schemas";

const DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

/**
 * The order the audit table reads its decisions in: the seats that were
 * filled, then the people who were not seated.
 *
 * `manual` sits with the other two placements rather than apart, because from
 * the board's point of view it is one — a seat that ended up filled. What
 * separates it is who decided, and the badge says that.
 */
const DECISION_ORDER = {
  kept: 0,
  substitute: 1,
  manual: 2,
  "not-ready": 3,
  "no-seat": 4,
} as const;

const noBoard = {
  code: "board_not_found",
  message: "Papan untuk tanggal dan shift itu belum dibuat",
};

/** Params every board route shares. */
const BoardParams = t.Object({
  date: t.String({ pattern: DATE_PATTERN }),
  shift: t.UnionEnum(SHIFT_KINDS),
});

const digger = alias(schema.units, "leader_unit");

/**
 * The slots of one board, joined to what a screen needs to name them.
 *
 * The fleet embed comes from `fleet_actual_fleets` — the board's **own copy**
 * of its formations, taken when it was generated — and deliberately not from
 * `fleets`, which describes today. Reading the live table here is what let a
 * reshuffle between shifts erase the morning board from the TV and relabel it
 * with an evening work area. A board is a record of a shift that has already
 * happened; nothing about it may change because Fleet Setting did.
 *
 * The Actual board still groups by fleet exactly as PLAN does — a formation is
 * how the yard thinks about its machines, and a flat list of unit codes makes
 * the reader rebuild it.
 *
 * `fleetId` here is the *snapshot* row's id, which is what every screen groups
 * and filters by. `sourceFleetId` is the live formation it was copied from,
 * carried only so a TV's own picks — which name live fleets — can still be
 * matched against the board.
 */
async function boardSlots(documentId: string) {
  return (
    db
      .select({
        unitId: schema.fleetActualSlots.unitId,
        unitCode: schema.units.code,
        requiresFtw: schema.units.ftw,
        simperCodeName: schema.simperCodes.name,
        departmentName: schema.departments.name,
        modelName: schema.unitModels.name,
        brandName: schema.unitBrands.name,
        fleetId: schema.fleetActualFleets.id,
        sourceFleetId: schema.fleetActualFleets.sourceFleetId,
        groupKind: schema.fleetActualFleets.kind,
        leaderCode: schema.fleetActualFleets.leaderCode,
        area: schema.fleetActualFleets.workArea,
        busCode: schema.fleetActualSlots.transportCode,
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
      /* Left, not inner: a board generated before the snapshot existed has no
       copy to join to, and its units must still list — as belonging to no
       formation, which is the honest reading of a record that was never
       kept. */
      .leftJoin(
        schema.fleetActualFleets,
        eq(schema.fleetActualFleets.id, schema.fleetActualSlots.boardFleetId)
      )
      .where(eq(schema.fleetActualSlots.documentId, documentId))
      .orderBy(asc(schema.units.code))
  );
}

const busUnit = alias(schema.units, "bus_unit");

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
      leaderCode: digger.code,
      /* Both from the unit now. A support unit has an area and a ride without
         belonging to a formation, and a formation's members are held to their
         leader's area on write — so there is nothing left to read off the
         fleet. */
      area: schema.units.workArea,
      busCode: busUnit.code,
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
        eq(schema.fleets.leaderUnitId, schema.units.id),
        eq(schema.fleets.id, schema.fleetUnits.fleetId)
      )
    )
    .leftJoin(digger, eq(digger.id, schema.fleets.leaderUnitId))
    .leftJoin(busUnit, eq(busUnit.id, schema.units.transportUnitId))
    .where(
      and(
        eq(schema.units.active, true),
        // The same two exclusions the board makes: neither needs an operator.
        eq(schema.units.breakdown, false),
        eq(schema.units.standby, false),
        /* And the same scope. Without it the provisional wall showed a
           different set of machines from the board that replaces it ten
           minutes later — every forklift and ambulance among them. */
        takesPartInAllocation(schema.units.id, schema.units.fleetSupport)
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
    /* The provisional line-up is read from Fleet Setting as it stands, so the
       formation it names *is* the live one — unlike a board, which names its
       own copy. Stated rather than implied, because both answers flow into the
       same wall through the same shape. */
    sourceFleetId: r.fleetId,
    groupKind: (r.fleetId && r.leaderCode ? "fleet" : "support") as
      "fleet" | "support",
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

/**
 * Names for the ids a board carries, in one query rather than per row — and
 * the photo file name with them, because the wall shows the face and asking
 * for it separately would be a second round trip per operator.
 */
async function peopleNames(ids: string[]) {
  if (!ids.length)
    return new Map<
      string,
      { nik: string; name: string; photoFile: string | null }
    >();
  const rows = await db
    .select({
      id: schema.employees.id,
      nik: schema.employees.nik,
      name: schema.employees.name,
      photoFile: schema.employees.photoFileName,
    })
    .from(schema.employees)
    .where(inArray(schema.employees.id, ids));
  return new Map(
    rows.map((r) => [
      r.id,
      { nik: r.nik, name: r.name, photoFile: r.photoFile },
    ])
  );
}

/**
 * FTW and the tap, for the faces the wall is about to show.
 *
 * A judge bound to one date's readings rather than a finished map, because the
 * verdict is a property of the *pairing*: `units.ftw` decides whether FTW is
 * asked for at all, so one operator reads "Lolos FTW" on a unit that requires
 * it and carries no FTW badge on a unit that does not. Judging per person and
 * reusing the answer across units is exactly the mistake the audit table made
 * before it was fixed.
 *
 * The two reads mirror `candidates()` deliberately — same tables, same date,
 * same `shiftIn` split — so the wall cannot disagree with the board it is
 * showing.
 *
 * `null` when the timeline cannot say where the deadlines are. A wall then
 * shows no readiness badges at all rather than inventing verdicts from a
 * half-configured timeline: the same refusal `currentShift` makes, for the same
 * reason — a plausible wrong badge on a screen people read at a glance is worse
 * than no badge.
 */
async function wallReadings(date: string, shift: ShiftKind, niks: string[]) {
  if (!niks.length) return null;
  const [deadline, ftwDeadlineAt] = await Promise.all([
    fingerInDeadline(shift),
    ftwDeadline(shift),
  ]);
  if (!deadline || !ftwDeadlineAt) return null;

  const [ftwRows, fingerRows] = await Promise.all([
    db
      .select()
      .from(schema.ftwReadings)
      .where(
        and(
          eq(schema.ftwReadings.date, date),
          inArray(schema.ftwReadings.nik, niks)
        )
      ),
    db
      .select()
      .from(schema.fingerReadings)
      .where(
        and(
          eq(schema.fingerReadings.date, date),
          inArray(schema.fingerReadings.nik, niks)
        )
      ),
  ]);
  const ftwByNik = new Map(ftwRows.map((r) => [r.nik, r]));
  const fingerByNik = new Map(fingerRows.map((r) => [r.nik, r]));

  return (nik: string, requiresFtw: boolean) =>
    judge({
      ftw: ftwByNik.get(nik) ?? null,
      finger: shiftIn(fingerByNik.get(nik) ?? null, shift),
      requiresFtw,
      deadline,
      ftwDeadline: ftwDeadlineAt,
    });
}

const photoNotFound = {
  code: "photo_not_found",
  message: "Foto tidak ditemukan",
};

/**
 * Whether this person holds a slot on the line-up the wall is showing now.
 *
 * Mirrors what `/display` answers with, and deliberately by the same rule: the
 * generated board when there is one, the standing plan while there is not. Any
 * looser rule (an employee that exists, an employee on some board) would let a
 * kiosk walk the register one NIK at a time.
 */
async function onDisplayedBoard(employeeId: string): Promise<boolean> {
  const now = currentShift(new Date(), await stageGates("ftw-ingest"));
  if (!now) return false;

  const doc = await documentOf(now.date, now.shift);
  const [hit] = doc
    ? await db
        .select({ id: schema.fleetActualSlots.id })
        .from(schema.fleetActualSlots)
        .where(
          and(
            eq(schema.fleetActualSlots.documentId, doc.id),
            eq(schema.fleetActualSlots.employeeId, employeeId)
          )
        )
        .limit(1)
    : await db
        .select({ id: schema.fleetPlanSlots.id })
        .from(schema.fleetPlanSlots)
        .where(eq(schema.fleetPlanSlots.employeeId, employeeId))
        .limit(1);
  return !!hit;
}

/**
 * A screen with no rotation of its own falls back to this, and so does a
 * person previewing the wall from a browser. Thirty seconds is long enough to
 * read every name in a formation before it moves.
 */
const DEFAULT_ROTATE_SECONDS = 30;

/**
 * The formations one screen was given, in the order it was given them. Empty
 * means it was given none.
 *
 * A list rather than a set: pick order is what a monitor lays out its
 * quadrants by, and what a slideshow rotates through.
 */
async function deviceFleetScope(deviceId: string): Promise<string[]> {
  const rows = await db
    .select({ fleetId: schema.deviceFleets.fleetId })
    .from(schema.deviceFleets)
    .where(eq(schema.deviceFleets.deviceId, deviceId))
    .orderBy(schema.deviceFleets.sortOrder);
  return rows.map((r) => r.fleetId);
}

/** A registered fleet wall, or nothing. Other kinds never answer here. */
async function fleetScreen(deviceId: string) {
  const [row] = await db
    .select({
      id: schema.devices.id,
      name: schema.devices.name,
      rotateSeconds: schema.devices.rotateSeconds,
      layout: schema.devices.layout,
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
  /**
   * The formation to group under. For a generated board this is the board's
   * own snapshot row; for the provisional plan it is the live fleet.
   */
  fleetId: string | null;
  /** A formation, or the group holding the units that belong to none. */
  groupKind: "fleet" | "support";
  /**
   * The *live* formation behind it, or null once that formation is gone.
   *
   * Only one reader needs it: a TV's picks name live fleets, so scoping a
   * board to a screen has to match through here rather than through `fleetId`.
   * Grouping, ordering and display all use `fleetId`.
   */
  sourceFleetId: string | null;
  leaderCode: string | null;
  area: string | null;
  busCode: string | null;
  employeeNik: string | null;
  employeeName: string | null;
  /** Stored file name of their photo, or null — the wall falls back to initials. */
  employeePhotoFile: string | null;
  source: "plan" | "spare" | "manual" | null;
  tappedAt: string | null;
  /**
   * The FTW verdict for *this* pairing — `not-required` where the unit does
   * not ask, null where the timeline could not be read. Six values rather than
   * a boolean because "has not filled it in" and "filled it in and was refused"
   * ask opposite things of the person standing in front of the screen.
   */
  ftw: FtwVerdict | null;
};

export type WallFleet = {
  id: string;
  kind: "fleet" | "support";
  /** Null on the support group, which has no leader to be named after. */
  leaderCode: string | null;
  area: string | null;
  busCode: string | null;
  /** This formation's own counts — the wall reports the fleet, not the site. */
  total: number;
  crewed: number;
  idle: number;
  /** Crewed by someone other than the planned holder: spare or manual. */
  substituted: number;
  units: Omit<
    WallSlot,
    "fleetId" | "groupKind" | "sourceFleetId" | "leaderCode" | "area"
  >[];
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
  /**
   * The screen's own formations in pick order; `null` (or empty) means every
   * one of them.
   *
   * These are **live** fleet ids — a device's picks are made in Fleet Setting
   * — so they are matched against `sourceFleetId`, not `fleetId`. A board
   * whose formation has since been deleted therefore drops off a scoped
   * screen: that screen was told to show a formation that no longer exists,
   * and inventing a match would put the wrong pit on the wrong wall. It still
   * shows in full on the unscoped board and on the Actual menu.
   */
  scope: readonly string[] | null = null
): WallFleet[] {
  const wanted = scope && scope.length ? new Set(scope) : null;
  const groups = new Map<string, WallFleet>();
  /** Group id → the live fleet behind it, for the pick order below only. */
  const liveOf = new Map<string, string | null>();
  for (const s of slots) {
    if (!s.fleetId) continue;
    /* A formation needs its leader's code to be named by; the support group
       needs nothing, which is why the two are told apart by `kind` rather than
       by whether a code happens to be there. */
    if (s.groupKind === "fleet" && !s.leaderCode) continue;
    if (wanted && !(s.sourceFleetId && wanted.has(s.sourceFleetId))) continue;
    let group = groups.get(s.fleetId);
    if (!group) {
      group = {
        id: s.fleetId,
        kind: s.groupKind,
        leaderCode: s.leaderCode,
        area: s.area,
        busCode: s.busCode,
        total: 0,
        crewed: 0,
        idle: 0,
        substituted: 0,
        units: [],
      };
      groups.set(s.fleetId, group);
      liveOf.set(s.fleetId, s.sourceFleetId);
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
      busCode: s.busCode,
      employeeNik: s.employeeNik,
      employeeName: s.employeeName,
      employeePhotoFile: s.employeePhotoFile,
      source: s.source,
      tappedAt: s.tappedAt,
      ftw: s.ftw,
    });
  }

  // The digger leads its own formation — a fleet is read as "EX-22 and what
  // hauls for it", not as an alphabetical list of unit codes.
  /* The header speaks for the whole group or says nothing. Transport is per
     unit now, so a header carrying the first unit's vehicle would quietly
     misdirect the crews of every unit riding a different one. */
  for (const group of groups.values()) {
    const rides = new Set(group.units.map((u) => u.busCode));
    group.busCode = rides.size === 1 ? (group.units[0]?.busCode ?? null) : null;
  }

  for (const group of groups.values())
    group.units.sort((a, b) => {
      const lead = (u: { unitCode: string }) =>
        group.leaderCode && u.unitCode === group.leaderCode ? 0 : 1;
      return lead(a) - lead(b) || a.unitCode.localeCompare(b.unitCode);
    });

  /* Scoped screens keep the admin's order — on a monitor it decides which pit
     lands top-left, and reordering the picks is the only way to move it. An
     unscoped screen has no order to keep and falls back to the digger's code,
     which is the vocabulary the yard already sorts by. */
  const rank = wanted ? new Map(scope!.map((id, i) => [id, i])) : null;
  return [...groups.values()].sort((a, b) => {
    /* Support last, always. It is the leftovers of the yard rather than a pit
       somebody stands in front of, and putting it in the alphabet would drop
       it into the middle of the formations. */
    if (a.kind !== b.kind) return a.kind === "support" ? 1 : -1;
    if (rank)
      return (
        (rank.get(liveOf.get(a.id) ?? "") ?? Infinity) -
        (rank.get(liveOf.get(b.id) ?? "") ?? Infinity)
      );
    return (a.leaderCode ?? "").localeCompare(b.leaderCode ?? "");
  });
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
      /* A wall nobody registered — a person previewing the site-wide board —
         reads as a slideshow: it has no picks, so it has nothing to lay four
         of side by side. */
      const layout = screen?.layout ?? "slideshow";
      /* The screen's own name, so a monitor can head itself with it. A browser
         previewing the site-wide board names no device and gets null. */
      const deviceName = screen?.name ?? null;

      const blank = {
        servedAt: new Date().toISOString(),
        date: null as string | null,
        shift: null as ShiftKind | null,
        generatedAt: null as string | null,
        provisional: false,
        rotateSeconds: rotate,
        layout,
        deviceName,
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
      /* Readiness for exactly the people on screen — not the whole roster.
         The wall is the one reader that shows a line-up *before* the board
         exists, and in that window these two badges are the only thing telling
         an arriving operator what they still owe. */
      const readingFor = await wallReadings(now.date, now.shift, [
        ...new Set(
          slots
            .map((s) => (s.employeeId ? names.get(s.employeeId)?.nik : null))
            .filter((nik): nik is string => !!nik)
            .map(normalizeNik)
        ),
      ]);
      return {
        servedAt: new Date().toISOString(),
        date: now.date,
        shift: now.shift,
        generatedAt: doc?.generatedAt.toISOString() ?? null,
        provisional,
        rotateSeconds: rotate,
        layout,
        deviceName,
        fleets: groupIntoFleets(
          slots.map((s) => {
            const person = s.employeeId ? names.get(s.employeeId) : undefined;
            const readiness =
              person && readingFor
                ? readingFor(normalizeNik(person.nik), s.requiresFtw)
                : null;
            return {
              unitId: s.unitId,
              unitCode: s.unitCode,
              modelName: s.modelName,
              brandName: s.brandName,
              fleetId: s.fleetId,
              groupKind: s.groupKind ?? "fleet",
              sourceFleetId: s.sourceFleetId,
              leaderCode: s.leaderCode,
              area: s.area,
              busCode: s.busCode,
              employeeNik: person?.nik ?? null,
              employeeName: person?.name ?? null,
              employeePhotoFile: person?.photoFile ?? null,
              source: s.source,
              /* The board's own record first: it is what the engine placed
                 them by. The live reading fills the provisional window, where
                 there is no board to have recorded anything. */
              tappedAt: s.tappedAt ?? readiness?.tappedAt ?? null,
              ftw: readiness?.ftw ?? null,
            };
          }),
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

  /**
   * One operator's photograph, for the wall that is showing them.
   *
   * Separate from `/employees/:nik/photo` because a paired TV is not a person:
   * it holds no grant on the employee register and no department scope, so it
   * could never call that route — and widening that route to admit devices
   * would hand every kiosk the whole register.
   *
   * So the gate here is the board itself. A screen may fetch exactly the faces
   * it has just been told to display, recomputed rather than taken on trust,
   * and the answer is 404 for anybody else — the same 404 as a person with no
   * photo, because which is which is not a kiosk's business either.
   *
   * Streamed like the employees route, and for the same reason (design D8).
   */
  .get(
    "/display/photo/:nik",
    async ({ params, principal, status }) => {
      if (principal.kind === "device" && principal.deviceKind !== "fleet")
        return status(403, {
          code: "forbidden",
          message: "Perangkat ini bukan untuk layar tersebut",
        });

      const [person] = await db
        .select({
          id: schema.employees.id,
          photoFileName: schema.employees.photoFileName,
        })
        .from(schema.employees)
        .where(eq(schema.employees.nik, normalizeNik(params.nik)))
        .limit(1);
      if (!person?.photoFileName) return status(404, photoNotFound);

      if (!(await onDisplayedBoard(person.id)))
        return status(404, photoNotFound);

      const file = Bun.file(photoPath(person.photoFileName));
      // The row can outlive the file — an unmounted volume is exactly this
      // case (design D8), and a wall must get a 404 it can fall back from
      // rather than a 500 it cannot.
      if (!(await file.exists())) return status(404, photoNotFound);
      return new Response(file, {
        headers: { "content-type": photoMimeType(person.photoFileName) },
      });
    },
    {
      auth: { menu: "display-fleet", mode: "view", allowDevice: true },
      params: t.Object({ nik: t.String({ minLength: 1 }) }),
      // No 200 schema: the body is an image, and a declared JSON shape would
      // have Elysia try to validate bytes as an object.
      response: { 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      detail: { summary: "An operator's photo, for the fleet TV" },
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
              .filter((s) => s.fleetId && s.leaderCode)
              .map((s) => [
                s.fleetId!,
                { id: s.fleetId!, leaderCode: s.leaderCode! },
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
            s.fleetId && s.leaderCode
              ? { id: s.fleetId, leaderCode: s.leaderCode, area: s.area }
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

  /**
   * The board's audit table: one line per operator the roster put on this
   * shift, and what became of them.
   *
   * Why it exists: the board says *what* was decided; this says *why it could
   * be*. Without it the two questions behind every disputed slot — did they
   * pass FTW, did they tap — are answered by opening two other menus and
   * matching NIKs by eye.
   *
   * **The readiness columns are read as they stand now, not as the engine saw
   * them.** `fleet_actual_slots` records the outcome, not the verdicts behind
   * it, and readings keep arriving after a board is generated — on
   * 2026-08-30 the day board was built at 05:20 and 711 of that date's FTW
   * rows were synced afterwards. So this table agrees with the FTW and
   * Attendance menus, which is what it is here to replace, and can disagree
   * with a board generated before a late upload. The screen says so.
   */
  .get(
    "/:date/:shift/audit",
    async ({ params, status }) => {
      const deadline = await fingerInDeadline(params.shift);
      const uploadClose = await ftwDeadline(params.shift);
      if (!deadline || !uploadClose)
        return status(422, {
          code: "no_deadline",
          message: `Tahap batas untuk shift ${params.shift === "day" ? "siang" : "malam"} tidak aktif — atur dulu di menu Timeline`,
        });

      // The roster is the gate, and it is the same call the engine makes — so
      // the table cannot list somebody the engine never considered.
      const pool = await candidates(
        params.date,
        params.shift,
        deadline,
        uploadClose
      );
      const ids = [...pool.keys()];
      if (!ids.length)
        return { date: params.date, shift: params.shift, rows: [] };

      const planUnit = alias(schema.units, "plan_unit");
      const planLeader = alias(schema.units, "leader_plan_unit");
      const planRows = await db
        .select({
          employeeId: schema.fleetPlanSlots.employeeId,
          unitCode: planUnit.code,
          leaderCode: planLeader.code,
          requiresFtw: planUnit.ftw,
        })
        .from(schema.fleetPlanSlots)
        .innerJoin(planUnit, eq(planUnit.id, schema.fleetPlanSlots.unitId))
        /* Their formation is their standing unit's, by either route into one:
           leading it, or hauling for it. */
        .leftJoin(schema.fleetUnits, eq(schema.fleetUnits.unitId, planUnit.id))
        .leftJoin(
          schema.fleets,
          or(
            eq(schema.fleets.id, schema.fleetUnits.fleetId),
            eq(schema.fleets.leaderUnitId, planUnit.id)
          )
        )
        .leftJoin(planLeader, eq(planLeader.id, schema.fleets.leaderUnitId))
        .where(inArray(schema.fleetPlanSlots.employeeId, ids));
      const plan = new Map(planRows.map((r) => [r.employeeId!, r]));

      const [doc] = await db
        .select({ id: schema.fleetActualDocuments.id })
        .from(schema.fleetActualDocuments)
        .where(
          and(
            eq(schema.fleetActualDocuments.date, params.date),
            eq(schema.fleetActualDocuments.shift, params.shift)
          )
        )
        .limit(1);
      /* The unit the board put them on, and *its* formation — not their
         standing unit's. A spare who filled a seat in EX4001 worked EX4001
         today, and someone asking about that formation wants them.

         The formation comes from the board's own copy, so this table keeps
         agreeing with the board it audits after Fleet Setting is reshuffled.
         The plan rows above stay on the live table on purpose: the standing
         plan *is* a statement about today, and has no snapshot to read. */
      const actual = new Map<
        string,
        {
          unitCode: string;
          leaderCode: string | null;
          requiresFtw: boolean;
          source: "plan" | "spare" | "manual" | null;
        }
      >();
      if (doc) {
        const rows = await db
          .select({
            employeeId: schema.fleetActualSlots.employeeId,
            unitCode: schema.units.code,
            leaderCode: schema.fleetActualFleets.leaderCode,
            requiresFtw: schema.units.ftw,
            source: schema.fleetActualSlots.source,
          })
          .from(schema.fleetActualSlots)
          .innerJoin(
            schema.units,
            eq(schema.units.id, schema.fleetActualSlots.unitId)
          )
          .leftJoin(
            schema.fleetActualFleets,
            eq(
              schema.fleetActualFleets.id,
              schema.fleetActualSlots.boardFleetId
            )
          )
          .where(eq(schema.fleetActualSlots.documentId, doc.id));
        for (const row of rows)
          if (row.employeeId)
            actual.set(row.employeeId, {
              unitCode: row.unitCode,
              leaderCode: row.leaderCode,
              requiresFtw: row.requiresFtw,
              source: row.source,
            });
      }

      const skills = await skillNamesByEmployee(ids);

      /* Which unit's rule applies to this person: the one they were placed on,
         or failing that their standing unit. With neither, the pool's default
         (required) stands. */
      const requiresFtwFor = (id: string): boolean =>
        actual.get(id)?.requiresFtw ?? plan.get(id)?.requiresFtw ?? true;

      const rows = ids.map((id) => {
        const entry = pool.get(id)!;
        const standing = plan.get(id);
        const placed = actual.get(id);
        const ftw = requiresFtwFor(id)
          ? entry.readiness.ftw
          : ("not-required" as const);
        /* Ready for the unit that applied to them — the same two-part rule the
           engine uses, with FTW dropped where the unit does not ask for it. */
        const ready =
          entry.readiness.finger === "pass" &&
          (ftw === "pass" || ftw === "not-required");
        return {
          /* Where they worked, or — when the board placed them nowhere —
             where they belong. Filtering a formation therefore answers "who
             was this formation's business today": its standing operators,
             including the ones it lost, and whoever actually drove its units
             in their place. */
          fleetDiggerCode: placed?.leaderCode ?? standing?.leaderCode ?? null,
          planUnitCode: standing?.unitCode ?? null,
          nik: entry.person.nik,
          name: entry.person.name,
          skills: skills.get(id) ?? [],
          /* The verdict the engine actually used for *this* person, not the
             pool's default. `candidates()` judges everyone as though FTW were
             required; a unit that does not require it has the engine ask
             again. Reporting the default made the table contradict the board —
             a digger with `ftw = false` showed "no reading" beside an operator
             it had happily seated. */
          ftw,
          sentAt: entry.readiness.sentAt,
          finger: entry.readiness.finger,
          tappedAt: entry.readiness.tappedAt,
          actualUnitCode: placed?.unitCode ?? null,
          decision: placed
            ? placed.source === "plan"
              ? ("kept" as const)
              : placed.source === "manual"
                ? ("manual" as const)
                : ("substitute" as const)
            : ready
              ? ("no-seat" as const)
              : ("not-ready" as const),
        };
      });

      /* Formation first, spares last — the order someone reads the yard in.
         A spare here is anyone with no formation: no standing unit at all, or
         a standing unit that belongs to none. */
      rows.sort((a, b) => {
        const fa = a.fleetDiggerCode;
        const fb = b.fleetDiggerCode;
        if (fa && fb && fa !== fb) return fa.localeCompare(fb);
        if (fa && !fb) return -1;
        if (!fa && fb) return 1;
        /* Inside a formation, by what the board decided: the seats it filled
           first, then the people it turned away. Reading a fleet is asking
           "who is on it, and who should have been" in that order — sorting by
           unit code interleaved the two and made the second question something
           you had to hunt for. Unit code is the tiebreaker, so each block
           still reads unit by unit. */
        const rank = DECISION_ORDER[a.decision] - DECISION_ORDER[b.decision];
        if (rank !== 0) return rank;
        return (
          (a.actualUnitCode ?? "").localeCompare(b.actualUnitCode ?? "") ||
          (a.planUnitCode ?? "").localeCompare(b.planUnitCode ?? "") ||
          a.name.localeCompare(b.name)
        );
      });

      return { date: params.date, shift: params.shift, rows };
    },
    {
      auth: { menu: "fleet-allocation", mode: "view" },
      params: t.Object({ date: t.String(), shift: ShiftKindSchema }),
      response: {
        200: ActualAuditSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "The board's audit table, one line per operator" },
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
