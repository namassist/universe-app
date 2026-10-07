/**
 * One line per operator the roster put on a shift, and what became of them.
 *
 * The board's audit table was the first reader of this and the Report menu is
 * the second. It lives here, out of either route, because the two must agree:
 * a Final Validation sheet that named a different unit from the audit table
 * for the same person would leave somebody to decide which one lied.
 *
 * **The readiness columns are read as they stand now, not as the engine saw
 * them.** `fleet_actual_slots` records the outcome, not the verdicts behind
 * it, and readings keep arriving after a board is generated — on 2026-08-30
 * the day board was built at 05:20 and 711 of that date's FTW rows were synced
 * afterwards. So these lines agree with the FTW and Attendance menus, and can
 * disagree with a board generated before a late upload.
 */

import { and, eq, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { shiftCode, type ShiftKind } from "@universe/contracts";

import { candidates } from "./allocation";
import { db, schema } from "./db";
import { fingerInDeadline, ftwDeadline, type Readiness } from "./readiness";
import { skillNamesByEmployee } from "./routes/fleet-allocation";

/**
 * The order the lines read their decisions in: the seats that were filled,
 * then the people who were not seated.
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

export type AuditDecision = keyof typeof DECISION_ORDER;

/** What the audit table shows for one operator. */
export type AuditRow = {
  fleetLeaderCode: string | null;
  fleetSupport: boolean;
  planUnitCode: string | null;
  nik: string;
  name: string;
  skills: string[];
  ftw: Readiness["ftw"];
  sentAt: string | null;
  finger: Readiness["finger"];
  tappedAt: string | null;
  actualUnitCode: string | null;
  decision: AuditDecision;
};

/** One operator: the audit table's row, and what only the reports read. */
export type AuditLine = {
  row: AuditRow;
  employeeId: string;
  departmentId: string | null;
  positionName: string;
  rosterCode: string;
  /** The seat's bus, or null when the board placed them nowhere. */
  busCode: string | null;
  /** The seat's work area — its formation's, or the unit's own. */
  area: string | null;
};

export type BoardAudit =
  /** The timeline names no deadline for this shift, so nobody can be judged. */
  | { kind: "no-deadline" }
  | {
      kind: "ok";
      /** Whether `spare-validate` (or somebody) has built this board yet. */
      boardGenerated: boolean;
      lines: AuditLine[];
    };

type Placement = {
  unitCode: string;
  leaderCode: string | null;
  fleetSupport: boolean;
  requiresFtw: boolean;
  source: "plan" | "spare" | "manual" | null;
  busCode: string | null;
  area: string | null;
};

/** employeeId → the standing unit the PLAN gives them, and its formation. */
async function standingUnits(ids: string[]) {
  const planUnit = alias(schema.units, "plan_unit");
  const planLeader = alias(schema.units, "leader_plan_unit");
  const rows = await db
    .select({
      employeeId: schema.fleetPlanSlots.employeeId,
      unitCode: planUnit.code,
      leaderCode: planLeader.code,
      /* A support unit belongs to no formation and is crewed anyway, so the
         absence of a leader code is not enough to call its operator a spare. */
      fleetSupport: planUnit.fleetSupport,
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
  return new Map(rows.map((r) => [r.employeeId!, r]));
}

/**
 * Who, of these people, holds a SIMPER for a unit that asks for FTW — the
 * rule for somebody with no seat and no standing unit (owner, 2026-10-06).
 *
 * Such a person could have been seated only where their SIMPER reaches, and
 * the engine judges FTW only where the unit asks for it. So a spare whose
 * every reachable unit asks for none was never held to FTW, and the No FTW
 * report must not list him: the trial of 2026-10-05 printed dozer and
 * small-exca spares as "Belum FTW" for a seat that never needed it.
 *
 * The units are the board's when there is one — what could have been filled
 * that shift, read after Fleet Setting has since changed — and the units in
 * service otherwise.
 */
async function reachesFtwUnit(
  ids: string[],
  date: string,
  shift: ShiftKind
): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const [board] = await db
    .select({ id: schema.fleetActualDocuments.id })
    .from(schema.fleetActualDocuments)
    .where(
      and(
        eq(schema.fleetActualDocuments.date, date),
        eq(schema.fleetActualDocuments.shift, shift)
      )
    )
    .limit(1);
  const units = board
    ? inArray(
        schema.units.id,
        db
          .select({ id: schema.fleetActualSlots.unitId })
          .from(schema.fleetActualSlots)
          .where(eq(schema.fleetActualSlots.documentId, board.id))
      )
    : and(eq(schema.units.active, true), eq(schema.units.breakdown, false));
  const rows = await db
    .selectDistinct({ employeeId: schema.employeeSkills.employeeId })
    .from(schema.employeeSkills)
    .innerJoin(
      schema.units,
      eq(schema.units.simperCodeId, schema.employeeSkills.simperCodeId)
    )
    .where(
      and(
        inArray(schema.employeeSkills.employeeId, ids),
        eq(schema.units.ftw, true),
        units
      )
    );
  return new Set(rows.map((r) => r.employeeId));
}

/**
 * employeeId → the seat the board gave them, and *its* formation — not their
 * standing unit's. A spare who filled a seat in EX4001 worked EX4001 today.
 *
 * The formation comes from the board's own copy, so these lines keep agreeing
 * with the board after Fleet Setting is reshuffled. `null` when there is no
 * board for the date and shift.
 */
async function placements(
  date: string,
  shift: ShiftKind
): Promise<Map<string, Placement> | null> {
  const [doc] = await db
    .select({ id: schema.fleetActualDocuments.id })
    .from(schema.fleetActualDocuments)
    .where(
      and(
        eq(schema.fleetActualDocuments.date, date),
        eq(schema.fleetActualDocuments.shift, shift)
      )
    )
    .limit(1);
  if (!doc) return null;

  const rows = await db
    .select({
      employeeId: schema.fleetActualSlots.employeeId,
      unitCode: schema.units.code,
      leaderCode: schema.fleetActualFleets.leaderCode,
      groupKind: schema.fleetActualFleets.kind,
      requiresFtw: schema.units.ftw,
      source: schema.fleetActualSlots.source,
      busCode: schema.fleetActualSlots.transportCode,
      fleetArea: schema.fleetActualFleets.workArea,
      unitArea: schema.fleetActualSlots.workArea,
    })
    .from(schema.fleetActualSlots)
    .innerJoin(
      schema.units,
      eq(schema.units.id, schema.fleetActualSlots.unitId)
    )
    .leftJoin(
      schema.fleetActualFleets,
      eq(schema.fleetActualFleets.id, schema.fleetActualSlots.boardFleetId)
    )
    .where(eq(schema.fleetActualSlots.documentId, doc.id));

  const map = new Map<string, Placement>();
  for (const row of rows)
    if (row.employeeId)
      map.set(row.employeeId, {
        unitCode: row.unitCode,
        leaderCode: row.leaderCode,
        fleetSupport: row.groupKind === "support",
        requiresFtw: row.requiresFtw,
        source: row.source,
        busCode: row.busCode,
        area: row.fleetArea ?? row.unitArea,
      });
  return map;
}

/**
 * Formation first, spares last — the order someone reads the yard in. A spare
 * here is anyone with no formation: no standing unit at all, or a standing
 * unit that belongs to none.
 */
function byFormationThenDecision(a: AuditRow, b: AuditRow): number {
  /* Support sorts with the formations rather than with the spares: its units
     were crewed, which is the question this table answers. */
  const fa = a.fleetLeaderCode ?? (a.fleetSupport ? "￿" : null);
  const fb = b.fleetLeaderCode ?? (b.fleetSupport ? "￿" : null);
  if (fa && fb && fa !== fb) return fa.localeCompare(fb);
  if (fa && !fb) return -1;
  if (!fa && fb) return 1;
  /* Inside a formation, by what the board decided: the seats it filled first,
     then the people it turned away. Unit code is the tiebreaker, so each block
     still reads unit by unit. */
  const rank = DECISION_ORDER[a.decision] - DECISION_ORDER[b.decision];
  if (rank !== 0) return rank;
  return (
    (a.actualUnitCode ?? "").localeCompare(b.actualUnitCode ?? "") ||
    (a.planUnitCode ?? "").localeCompare(b.planUnitCode ?? "") ||
    a.name.localeCompare(b.name)
  );
}

/**
 * The audit lines for one shift — for one department's operators only, when
 * `departmentId` is given.
 *
 * The narrowing happens here, before a line is built, rather than being left
 * to each caller: a report route that forgot to filter would hand a
 * department-scoped reader the whole shift's names and verdicts, and nothing
 * would say so.
 */
export async function boardAudit(
  date: string,
  shift: ShiftKind,
  departmentId: string | null = null
): Promise<BoardAudit> {
  const deadline = await fingerInDeadline(shift);
  const uploadClose = await ftwDeadline(shift);
  if (!deadline || !uploadClose) return { kind: "no-deadline" };

  // The roster is the gate, and it is the same call the engine makes — so the
  // lines cannot list somebody the engine never considered.
  const pool = await candidates(date, shift, deadline, uploadClose);
  const actual = await placements(date, shift);
  const ids = [...pool.keys()].filter(
    (id) => !departmentId || pool.get(id)!.person.departmentId === departmentId
  );
  if (!ids.length)
    return { kind: "ok", boardGenerated: actual !== null, lines: [] };

  const [plan, skills, ftwReach] = await Promise.all([
    standingUnits(ids),
    skillNamesByEmployee(ids),
    reachesFtwUnit(ids, date, shift),
  ]);

  /* Which unit's rule applies to this person: the one they were placed on, or
     failing that their standing unit. With neither, whether any unit their
     SIMPER reaches asks for FTW (`reachesFtwUnit`). */
  const requiresFtwFor = (id: string): boolean =>
    actual?.get(id)?.requiresFtw ??
    plan.get(id)?.requiresFtw ??
    ftwReach.has(id);

  const lines = ids.map((id): AuditLine => {
    const entry = pool.get(id)!;
    const standing = plan.get(id);
    const placed = actual?.get(id);
    /* The verdict the engine actually used for *this* person, not the pool's
       default. `candidates()` judges everyone as though FTW were required; a
       unit that does not require it has the engine ask again. */
    const ftw = requiresFtwFor(id)
      ? entry.readiness.ftw
      : ("not-required" as const);
    /* Ready for the unit that applied to them — the same two-part rule the
       engine uses, with FTW dropped where the unit does not ask for it. */
    const ready =
      entry.readiness.finger === "pass" &&
      (ftw === "pass" || ftw === "not-required");
    const row: AuditRow = {
      /* Where they worked, or — when the board placed them nowhere — where
         they belong. */
      fleetLeaderCode: placed?.leaderCode ?? standing?.leaderCode ?? null,
      fleetSupport: placed
        ? placed.fleetSupport
        : (standing?.fleetSupport ?? false),
      planUnitCode: standing?.unitCode ?? null,
      nik: entry.person.nik,
      name: entry.person.name,
      skills: skills.get(id) ?? [],
      ftw,
      sentAt: entry.readiness.sentAt,
      finger: entry.readiness.finger,
      tappedAt: entry.readiness.tappedAt,
      actualUnitCode: placed?.unitCode ?? null,
      decision: placed
        ? placed.source === "plan"
          ? "kept"
          : placed.source === "manual"
            ? "manual"
            : "substitute"
        : ready
          ? "no-seat"
          : "not-ready",
    };
    return {
      row,
      employeeId: id,
      departmentId: entry.person.departmentId,
      positionName: entry.person.positionName,
      /* The pool admits only the code that schedules this shift, so the code
         is the shift's. */
      rosterCode: shiftCode(shift),
      busCode: placed?.busCode ?? null,
      area: placed?.area ?? null,
    };
  });

  return {
    kind: "ok",
    boardGenerated: actual !== null,
    lines: lines.sort((a, b) => byFormationThenDecision(a.row, b.row)),
  };
}
