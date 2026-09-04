/**
 * The allocation engine: one shift's board, resolved from the standing plan
 * and what readiness turned out to be.
 *
 * PLAN says who *should* take each unit. This says who may, on one date, for
 * one shift — and where the plan came up short, who filled the gap. It runs
 * from `spare-validate`, which now fires twice a day, once per shift, and the
 * stage row says which.
 *
 * The order of business:
 *
 *   1. every unit holding a PLAN slot, minus breakdown and standby — neither
 *      needs an operator, so neither is a vacancy to report (owner)
 *   2. its slot operator rostered to *this* shift; passes → keeps the unit
 *   3. everything else is a vacancy, and a vacancy is the thing the board
 *      exists to make visible
 *   4. spares — fleet-allocation operators rostered to this shift holding no
 *      slot — who pass, first come first served by their tap, fill vacancies
 *      subject to the same SIMPER and department rules PLAN enforces
 *
 * Reads only local tables. The readiness snapshots were pulled hours earlier
 * by the ingest stages; nothing here opens a socket to an external source.
 */

import { and, asc, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { ShiftKind } from "@universe/contracts";

import { db, schema } from "./db";
import { takesPartInAllocation } from "./fleet-scope";
import { judge, shiftIn, type Readiness } from "./readiness";
import {
  pairingRefusal,
  type AllocPerson,
  type AllocUnit,
} from "./routes/fleet-allocation";
import { localDate } from "./scheduler";
import { normalizeNik } from "./sources/nik";

export type BoardSlot = {
  unitId: string;
  unitCode: string;
  employeeId: string | null;
  source: "plan" | "spare" | null;
  tappedAt: string | null;
  /** Why the planned operator lost the unit, for the screen that shows it. */
  readiness: Readiness | null;
  /**
   * Which of the board's own groups this unit sat in.
   *
   * The leader's code, or `SUPPORT_GROUP` for a unit that belongs to no
   * formation. A key rather than a fleet id, because the id is the thing that
   * does not survive: `storeBoard` resolves it against the rows it has just
   * written.
   */
  groupKey: string | null;
  /** Where this unit worked, and what carried its crew — copied, like the rest. */
  workArea: string | null;
  transportCode: string | null;
};

/**
 * The key the one support group is filed under, in a namespace of leader unit
 * codes. Not a unit code — no unit may be called this — so it cannot collide.
 */
export const SUPPORT_GROUP = "\u0000support";

/**
 * One formation as it stood when the board was built.
 *
 * Copied onto the board rather than referenced, because Fleet Setting is
 * rewritten between shifts and a board is a record of a shift that has already
 * happened. See `fleet_actual_fleets` for the full reasoning.
 */
export type BoardFleet = {
  kind: "fleet" | "support";
  /** Null on the support group, which was copied from no formation. */
  sourceFleetId: string | null;
  /** Null on the support group, which has no leader. */
  leaderCode: string | null;
  /** Null on the support group, whose units work in different places. */
  workArea: string | null;
};

export type Board = {
  date: string;
  shift: ShiftKind;
  fleets: BoardFleet[];
  slots: BoardSlot[];
};

/* ------------------------------------------------------------- the inputs */

export type Candidate = {
  person: AllocPerson;
  readiness: Readiness;
};

/**
 * Everyone the engine may consider, judged.
 *
 * One pass over employees, roster, and both snapshots — the readings join on
 * normalized NIK because that is the only key the sources share with us, and
 * the snapshot tables deliberately carry no foreign key to `employees`.
 */
export async function candidates(
  date: string,
  shift: ShiftKind,
  deadline: string,
  ftwDeadlineAt: string
): Promise<Map<string, Candidate>> {
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
      code: schema.rosterDays.code,
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
        eq(schema.rosterDays.date, date)
      )
    )
    .where(
      and(
        eq(schema.employees.status, "aktif"),
        eq(schema.positions.fleetAllocation, true),
        eq(schema.rosterDays.code, shift === "day" ? "D" : "N")
      )
    );

  if (!people.length) return new Map();

  const niks = people.map((p) => normalizeNik(p.nik));
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

  const map = new Map<string, Candidate>();
  for (const person of people) {
    const nik = normalizeNik(person.nik);
    map.set(person.id, {
      person,
      // Judged as if FTW were required. A unit that does not require it asks
      // again with `requiresFtw: false` — the same person can be ready for one
      // unit and not another, and that is a property of the pairing.
      readiness: judge({
        ftw: ftwByNik.get(nik) ?? null,
        finger: shiftIn(fingerByNik.get(nik) ?? null, shift),
        requiresFtw: true,
        deadline,
        ftwDeadline: ftwDeadlineAt,
      }),
    });
  }
  return map;
}

/** employeeId → the SIMPER codes they hold, loaded once for the whole pass. */
async function skillsByEmployee(
  employeeIds: string[]
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (!employeeIds.length) return map;
  const rows = await db
    .select()
    .from(schema.employeeSkills)
    .where(inArray(schema.employeeSkills.employeeId, employeeIds));
  for (const row of rows) {
    const set = map.get(row.employeeId) ?? new Set<string>();
    set.add(row.simperCodeId);
    map.set(row.employeeId, set);
  }
  return map;
}

/* -------------------------------------------------------------- the board */

/** The unit a formation is named by, and the vehicle a unit's crew rides. */
const fleetLeader = alias(schema.units, "fleet_leader");
const transport = alias(schema.units, "unit_transport");

/**
 * Build one shift's board. Pure of side effects — `storeBoard` writes it.
 *
 * Throws when the shift has no active `finger-in` stage: with no deadline
 * there is no pass rule, and inventing one is worse than refusing. An early
 * default fails every operator, a late one passes every operator, and neither
 * is visible on the screen that results.
 */
export async function buildBoard(
  date: string,
  shift: ShiftKind,
  deadline: string,
  ftwDeadlineAt: string
): Promise<Board> {
  /*
   * Driven by `units`, not by `fleet_plan_slots`.
   *
   * It used to be the other way round, and that hid the units that most needed
   * showing: a unit the plan has no standing pairing for is idle by default,
   * and building the board from PLAN meant it never appeared as a vacancy at
   * all. Nine of fifteen units were invisible on the site's first real board,
   * which reported one idle unit while ten had nobody on them.
   *
   * PLAN answers "who usually drives this", not "which units exist". Only
   * `units` can answer the second, so the join goes the other way and the
   * pairing is optional.
   */
  const planned = await db
    .select({
      unitId: schema.units.id,
      unitCode: schema.units.code,
      departmentId: schema.units.departmentId,
      departmentName: schema.departments.name,
      simperCodeId: schema.units.simperCodeId,
      simperCodeName: schema.simperCodes.name,
      requiresFtw: schema.units.ftw,
      /** Null for a unit the plan says nothing about. */
      employeeId: schema.fleetPlanSlots.employeeId,
      /*
       * The formation, read once here and then copied onto the board.
       *
       * `isFleetConfigured` below already guarantees every unit in this list
       * is in one, so these are non-null in practice; the join is left outer
       * because the compiler cannot know that and a crash on a board is worse
       * than a null.
       */
      fleetId: schema.fleets.id,
      fleetLeaderCode: fleetLeader.code,
      /* On the unit, not on the fleet. A support unit has one too, and a
         formation's area is simply its leader's — the members are held to the
         same value on write. */
      workArea: schema.units.workArea,
      transportCode: transport.code,
    })
    .from(schema.units)
    .leftJoin(
      schema.fleetPlanSlots,
      eq(schema.fleetPlanSlots.unitId, schema.units.id)
    )
    .leftJoin(
      schema.departments,
      eq(schema.departments.id, schema.units.departmentId)
    )
    .leftJoin(
      schema.simperCodes,
      eq(schema.simperCodes.id, schema.units.simperCodeId)
    )
    /* A unit belongs to a formation by either route — leading it or hauling
       for it — so the condition is an `or` rather than one foreign key. Both
       columns are unique, so neither route can double a row. */
    .leftJoin(schema.fleetUnits, eq(schema.fleetUnits.unitId, schema.units.id))
    .leftJoin(
      schema.fleets,
      or(
        eq(schema.fleets.leaderUnitId, schema.units.id),
        eq(schema.fleets.id, schema.fleetUnits.fleetId)
      )
    )
    .leftJoin(fleetLeader, eq(fleetLeader.id, schema.fleets.leaderUnitId))
    .leftJoin(transport, eq(transport.id, schema.units.transportUnitId))
    .where(
      and(
        eq(schema.units.active, true),
        // Neither needs an operator, so neither is a vacancy (owner).
        eq(schema.units.breakdown, false),
        eq(schema.units.standby, false),
        /*
         * And somebody configured it in Fleet Setting (owner, 2026-08-31).
         *
         * "Driven by units" above still holds — the board is built from the
         * machines, not from PLAN, so a configured unit with no standing
         * pairing is still a vacancy. What narrowed is *which* machines the
         * board is about. Unscoped it covered the whole register: 447 slots
         * against 75 configured units, where every forklift, lowboy and
         * ambulance stood as a permanently idle red card nobody would fill —
         * 251 empty slots on the last board, and an idle card that is always
         * there is one nobody reads.
         *
         * Since 2026-09-04 that also admits **support units** — a dozer, a
         * water truck, a spare digger. They work without a formation and still
         * need an operator; what changed is that Fleet Setting now names them
         * a work area and a ride, so "in no formation" stopped being a
         * reliable stand-in for "not our business". The cost of the original
         * rule remains for everything else: a unit configured nowhere is not
         * allocated and not reported as idle either.
         */
        takesPartInAllocation(schema.units.id, schema.units.fleetSupport)
      )
    )
    .orderBy(asc(schema.units.code));

  const pool = await candidates(date, shift, deadline, ftwDeadlineAt);
  const skills = await skillsByEmployee([...pool.keys()]);
  const today = localDate(new Date());

  // Deliberately not cast: `AllocUnit` is what `unitByCode` returns, and
  // letting the compiler check the shape is what keeps this in step with it.
  const unitOf = (row: (typeof planned)[number]): AllocUnit => ({
    id: row.unitId,
    code: row.unitCode,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    simperCodeId: row.simperCodeId,
    simperCodeName: row.simperCodeName,
  });

  const eligible = (unit: AllocUnit, candidate: Candidate) =>
    pairingRefusal(unit, candidate.person, {
      holdsCode: unit.simperCodeId
        ? (skills.get(candidate.person.id)?.has(unit.simperCodeId) ?? false)
        : false,
      today,
    }) === null;

  /** A candidate is ready for *this* unit — FTW only where the unit wants it. */
  const readyFor = (requiresFtw: boolean, candidate: Candidate): Readiness =>
    requiresFtw
      ? candidate.readiness
      : {
          ...candidate.readiness,
          ftw: "not-required",
          passed: candidate.readiness.finger === "pass",
        };

  /* --- 1. the units, and which of them the plan still covers --------------- */

  const byUnit = new Map<string, (typeof planned)[number][]>();
  for (const row of planned) {
    const list = byUnit.get(row.unitId) ?? [];
    list.push(row);
    byUnit.set(row.unitId, list);
  }

  /*
   * The groups this board is about, copied as they stand right now.
   *
   * Gathered from the same rows the slots are, so the board cannot end up
   * naming a formation none of its units is in. Keyed by leader code because
   * that is what a slot carries and what the yard calls the formation; the
   * fleet id rides along only as a breadcrumb back to Fleet Setting.
   *
   * Plus at most one support group, added only when a support unit is actually
   * on the board — an empty "Support" heading on a wall says nothing.
   */
  const fleets = new Map<string, BoardFleet>();
  for (const row of planned) {
    const key =
      row.fleetId && row.fleetLeaderCode ? row.fleetLeaderCode : SUPPORT_GROUP;
    if (fleets.has(key)) continue;
    fleets.set(
      key,
      key === SUPPORT_GROUP
        ? {
            kind: "support",
            sourceFleetId: null,
            leaderCode: null,
            workArea: null,
          }
        : {
            kind: "fleet",
            sourceFleetId: row.fleetId,
            leaderCode: row.fleetLeaderCode,
            workArea: row.workArea,
          }
    );
  }
  const groupOf = (row: (typeof planned)[number]) =>
    row.fleetId && row.fleetLeaderCode ? row.fleetLeaderCode : SUPPORT_GROUP;

  const slots: BoardSlot[] = [];
  const taken = new Set<string>();

  for (const [unitId, rows] of byUnit) {
    const first = rows[0]!;
    const unit = unitOf(first);
    // At most one slot holder is rostered to this shift — PLAN refuses two on
    // the same one — so the first match is the only match.
    const holder = rows
      .map((r) => (r.employeeId ? pool.get(r.employeeId) : undefined))
      .find((c): c is Candidate => c !== undefined);
    const readiness = holder ? readyFor(first.requiresFtw, holder) : null;

    if (holder && readiness?.passed && eligible(unit, holder)) {
      taken.add(holder.person.id);
      slots.push({
        unitId,
        unitCode: first.unitCode,
        employeeId: holder.person.id,
        source: "plan",
        tappedAt: readiness.tappedAt,
        readiness,
        groupKey: groupOf(first),
        workArea: first.workArea,
        transportCode: first.transportCode,
      });
    } else {
      slots.push({
        unitId,
        unitCode: first.unitCode,
        employeeId: null,
        source: null,
        tappedAt: null,
        readiness,
        groupKey: groupOf(first),
        workArea: first.workArea,
        transportCode: first.transportCode,
      });
    }
  }

  /* --- 2. the spares, first come first served ----------------------------- */

  const slotHolders = new Set(
    planned.map((r) => r.employeeId).filter((id): id is string => id !== null)
  );

  /**
   * Everyone in the pool who holds a standing unit *somewhere*.
   *
   * Not the same as `slotHolders`, which is about this board: an operator
   * whose unit is broken down, on standby, or in no formation holds a unit in
   * PLAN and no seat here, so they arrive in the spare pool alongside people
   * who hold nothing at all. This set is what tells the two apart.
   */
  const standing = new Set<string>();
  if (pool.size) {
    const rows = await db
      .select({ employeeId: schema.fleetPlanSlots.employeeId })
      .from(schema.fleetPlanSlots)
      .where(inArray(schema.fleetPlanSlots.employeeId, [...pool.keys()]));
    for (const row of rows) standing.add(row.employeeId);
  }

  const spares = [...pool.values()]
    .filter((c) => !slotHolders.has(c.person.id))
    .filter((c) => c.readiness.finger === "pass")
    .sort((a, b) => {
      /*
       * A spare who holds no unit anywhere goes first (owner, 2026-09-01).
       *
       * Everyone here is unattached *today*, but not for the same reason: some
       * hold nothing at all, others hold a machine that is broken down, on
       * standby, or in no formation. Seating the second group on somebody
       * else's unit is the expensive placement — when their own machine comes
       * back, taking it means pulling them off a seat and opening a fresh
       * vacancy mid-shift, which the application does not handle and a
       * supervisor has to sort out by hand.
       *
       * Ordering, never filtering: if no unattached spare can take a unit —
       * wrong SIMPER, wrong department, none left — a standing holder still
       * gets it. A seat left empty beside somebody able to fill it would cost
       * far more than the reshuffle this avoids.
       *
       * The price is that first-come-first-served no longer holds across the
       * whole pool: an unattached spare who tapped at 05:10 now outranks a
       * standing holder who tapped at 04:48. Accepted knowingly — the tap
       * still orders each group internally.
       */
      const rank =
        Number(standing.has(a.person.id)) - Number(standing.has(b.person.id));
      if (rank !== 0) return rank;
      return (
        (a.readiness.tappedAt ?? "").localeCompare(
          b.readiness.tappedAt ?? ""
        ) ||
        // Two taps in the same second must not place arbitrarily, or a board
        // regenerated differs from the one people already read.
        a.person.nik.localeCompare(b.person.nik)
      );
    });

  for (const slot of slots) {
    if (slot.employeeId) continue;
    const row = byUnit.get(slot.unitId)![0]!;
    const unit = unitOf(row);
    const spare = spares.find((c) => {
      if (taken.has(c.person.id)) return false;
      if (!readyFor(row.requiresFtw, c).passed) return false;
      return eligible(unit, c);
    });
    if (!spare) continue;
    taken.add(spare.person.id);
    slot.employeeId = spare.person.id;
    slot.source = "spare";
    slot.tappedAt = spare.readiness.tappedAt;
    slot.readiness = readyFor(row.requiresFtw, spare);
  }

  return { date, shift, fleets: [...fleets.values()], slots };
}

/**
 * Replace the stored board for its date and shift.
 *
 * Replace, not append: regenerating is re-answering the same morning, and two
 * documents for one shift would leave a reader to guess which is in force.
 * Manual edits are lost by a regeneration — the board is never frozen and
 * keeps no history (owner), so this is the shape that decision implies.
 */
export async function storeBoard(board: Board): Promise<string> {
  return db.transaction(async (tx) => {
    await tx
      .delete(schema.fleetActualDocuments)
      .where(
        and(
          eq(schema.fleetActualDocuments.date, board.date),
          eq(schema.fleetActualDocuments.shift, board.shift)
        )
      );
    const [doc] = await tx
      .insert(schema.fleetActualDocuments)
      .values({ date: board.date, shift: board.shift })
      .returning({ id: schema.fleetActualDocuments.id });

    /* The formations first, because the slots point at them. Written per
       document rather than shared between documents: two boards on the same
       day are two records of two shifts, and a formation edited between them
       must show up as the difference it was. */
    const groupIds = new Map<string, string>();
    if (board.fleets.length) {
      const rows = await tx
        .insert(schema.fleetActualFleets)
        .values(
          board.fleets.map((f) => ({
            documentId: doc!.id,
            kind: f.kind,
            sourceFleetId: f.sourceFleetId,
            leaderCode: f.leaderCode,
            workArea: f.workArea,
          }))
        )
        .returning({
          id: schema.fleetActualFleets.id,
          kind: schema.fleetActualFleets.kind,
          leaderCode: schema.fleetActualFleets.leaderCode,
        });
      for (const row of rows)
        groupIds.set(row.leaderCode ?? SUPPORT_GROUP, row.id);
    }

    if (board.slots.length)
      await tx.insert(schema.fleetActualSlots).values(
        board.slots.map((s) => ({
          documentId: doc!.id,
          unitId: s.unitId,
          employeeId: s.employeeId,
          boardFleetId: s.groupKey ? (groupIds.get(s.groupKey) ?? null) : null,
          workArea: s.workArea,
          transportCode: s.transportCode,
          source: s.source,
          tappedAt: s.tappedAt,
        }))
      );
    return doc!.id;
  });
}
