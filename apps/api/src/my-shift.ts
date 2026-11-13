/**
 * "Unit saya": what the operator's own app says about the coming shift
 * (docs/prd.md, Mobile app → User).
 *
 * The question it answers is _am I a holder or a spare, and why_, so nobody
 * has to guess. Before the board is built the answer is the plan, provisional,
 * with the reason a holder would not keep their unit. After it, the answer is
 * the board's, held back exactly as the slip is: a spare learns their unit at
 * `finger-second`, not before.
 *
 * Nothing here judges anew. The reasons are the rules the board and the slip
 * already apply: `seatable()` (active, not broken down, in a formation or
 * support), `pairingRefusal` (status, position, department, SIMPER), the
 * roster's `D`/`N`, and the partner rostered to the same shift
 * (`planSeatVerdict`). `standing` only orders them.
 */

import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import {
  SEAT_REMOVED_CAUSES,
  type SeatRemovedCause,
  type ShiftKind,
  type TimelineAction,
  type UnitStatus,
} from "@universe/contracts";

import { currentShift, type ShiftNow } from "./current-shift";
import { db, schema } from "./db";
import { takesPartInAllocation } from "./fleet-scope";
import { ftwDeadline, judgeFtw, type FtwVerdict } from "./readiness";
import { rosterDayInForce } from "./roster-in-force";
import {
  pairingRefusal,
  personByNik,
  unitByCode,
} from "./routes/fleet-allocation";
import { localDate } from "./scheduler";
import { shiftGates, stageClock, stageTimeOf } from "./stage-time";
import { firstTapOf } from "./ticket-issue";
import type { Seat } from "./ticket-rules";

/** The plan's facts about the person's standing unit, or null for none. */
export type PlanFacts = {
  unit: string;
  active: boolean;
  breakdown: boolean;
  /** In a formation or crewed as support: `takesPartInAllocation`. */
  inAllocation: boolean;
  /** `pairingRefusal`'s sentence for this person on this unit, or null. */
  refusal: string | null;
  /** Another holder of the same unit is rostered to this shift. */
  partnerRostered: boolean;
  seat: Seat;
} | null;

export type SeatSource = "plan" | "spare" | "manual";

/** The board's facts, or null while there is no board for the shift. */
export type BoardFacts = {
  /** ISO instant the engine last built the board. */
  generatedAt: string;
  seat:
    | (Seat & {
        source: SeatSource;
        /** ISO instant of the hand placement that stands, for `manual`. */
        placedAt: string | null;
      })
    | null;
} | null;

/**
 * A seat as the app shows it: where, and how it came to be the person's.
 * `source` is null for the plan's seat, which nobody has placed yet.
 */
export type ShownSeat = Seat & {
  source: SeatSource | null;
  placedAt: string | null;
};

export type StandingInput = {
  /** `aktif`, in a position allocation is about. */
  allocatable: boolean;
  /** The roster in force says `D` (day) or `N` (night) for this shift. */
  rostered: boolean;
  plan: PlanFacts;
  board: BoardFacts;
  /** `finger-second` has passed for this shift. */
  secondFingerOpen: boolean;
};

export type StandingReason =
  | "breakdown"
  | "not-in-fleet"
  | "ineligible"
  | "partner-rostered"
  | "no-plan-seat"
  | "awaiting-second-finger"
  | "not-seated";

export type Standing = {
  /** Whose word this is: the plan's (provisional) or the board's. */
  phase: "plan" | "board";
  status: "holder" | "spare" | "off" | "not-allocated";
  reason: StandingReason | null;
  /** The refusal itself, when `reason` is `ineligible`. */
  refusal: string | null;
  /** The standing unit, whatever became of it, so the app can name it. */
  planUnit: string | null;
  seat: ShownSeat | null;
};

const shownSeat = (
  seat: Seat,
  source: SeatSource | null = null,
  placedAt: string | null = null
): ShownSeat => ({
  unit: seat.unit,
  area: seat.area,
  bus: seat.bus,
  fleet: seat.fleet,
  source,
  placedAt,
});

export function standing(input: StandingInput): Standing {
  const phase = input.board ? "board" : "plan";
  const planUnit = input.plan?.unit ?? null;
  const answer = (
    status: Standing["status"],
    reason: StandingReason | null = null,
    seat: ShownSeat | null = null,
    refusal: string | null = null
  ): Standing => ({ phase, status, reason, refusal, planUnit, seat });

  if (!input.allocatable) return answer("not-allocated");

  /* A seat on the board outranks the roster: a late arrival or a call-in
     reaches a unit only by hand, and the app must not read "off" while the
     board says otherwise (code review, 2026-10-17). */
  const boardSeat = input.board?.seat ?? null;
  if (!input.rostered && !boardSeat) return answer("off");

  if (input.board) {
    const seat = boardSeat;
    if (seat?.source === "plan")
      return answer("holder", null, shownSeat(seat, "plan"));
    // A spare's seat, a hand placement, or none at all: the slip says
    // nothing until the second finger, and neither does the app.
    if (!input.secondFingerOpen)
      return answer("spare", "awaiting-second-finger");
    if (!seat) return answer("spare", "not-seated");
    return answer(
      seat.unit === planUnit ? "holder" : "spare",
      null,
      shownSeat(seat, seat.source, seat.placedAt)
    );
  }

  const plan = input.plan;
  if (!plan) return answer("spare", "no-plan-seat");
  if (!plan.active || (!plan.breakdown && !plan.inAllocation))
    return answer("spare", "not-in-fleet");
  if (plan.breakdown) return answer("spare", "breakdown");
  if (plan.refusal) return answer("spare", "ineligible", null, plan.refusal);
  return answer(
    "holder",
    plan.partnerRostered ? "partner-rostered" : null,
    shownSeat(plan.seat)
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The shift after this one: the night of the same date, then the next day. */
function following(shift: ShiftNow): ShiftNow {
  if (shift.shift === "day") return { date: shift.date, shift: "night" };
  const next = new Date(`${shift.date}T00:00:00Z`).getTime() + DAY_MS;
  return { date: new Date(next).toISOString().slice(0, 10), shift: "day" };
}

/**
 * Which shift the app is about: the running one if the person is rostered
 * to it, else the next one if they are rostered to that. Opened at 21:00 the
 * evening before a day shift, the running shift is tonight's, which they are
 * not on; the shift that matters to them is tomorrow's. Rostered to neither,
 * the running shift, which `standing` reads as off.
 */
export function pickShift(
  running: ShiftNow,
  rosteredTo: (shift: ShiftNow) => boolean
): ShiftNow {
  if (rosteredTo(running)) return running;
  const next = following(running);
  return rosteredTo(next) ? next : running;
}

/** "YYYY-MM-DD HH:MM:SS" local, comparable with a date and a stage time. */
function localStamp(now: Date): string {
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
  return `${localDate(now)} ${time}`;
}

export type MyShift = Standing & {
  date: string;
  shift: ShiftKind;
  /** The roster code in force for the date, `D`, `N`, `OFF`, … or null. */
  roster: string | null;
  ftw: {
    verdict: FtwVerdict | null;
    sentAt: string | null;
    sleepMinutes: number | null;
    category: string | null;
  } | null;
  /** "HH:MM:SS" of the first IN tap of the shift, or null. */
  checkInAt: string | null;
  /** ISO instant the board was last built, or null before there is one. */
  boardAt: string | null;
  /** The seat the person was told of and has since lost, or null. */
  withdrawn: Withdrawn | null;
  /**
   * The shift's gates as "HH:MM", or null where the timeline has none: what
   * the phone says "before 05:25" or "at 05:28" with, read from the same
   * stages the scheduler runs rather than guessed.
   */
  gates: ShiftGateTimes;
};

export type ShiftGateTimes = {
  ftwDeadline: string | null;
  fingerIn: string | null;
  board: string | null;
  secondFinger: string | null;
  busDepart: string | null;
};

async function gateTimes(shift: ShiftKind): Promise<ShiftGateTimes> {
  const at = (action: TimelineAction) => stageClock(action, shift);
  const [ftwDeadline, fingerIn, board, secondFinger, busDepart] =
    await Promise.all([
      at("ftw-deadline"),
      at("finger-in"),
      at("spare-validate"),
      at("finger-second"),
      at("bus-depart"),
    ]);
  return { ftwDeadline, fingerIn, board, secondFinger, busDepart };
}

/**
 * The answer for one NIK, now. Null when the timeline cannot say which shift
 * is running: the walls refuse to guess in the same case, and so does this.
 */
export async function myShift(nik: string, now: Date): Promise<MyShift | null> {
  const running = currentShift(now, await shiftGates());
  if (!running) return null;

  const person = await personByNik(nik);
  const codes = person
    ? await rosterCodes(person.id, [running.date, following(running).date])
    : new Map<string, string>();
  const rosteredTo = (s: ShiftNow) =>
    codes.get(s.date) === (s.shift === "day" ? "D" : "N");
  const target = pickShift(running, rosteredTo);

  const allocatable =
    !!person &&
    person.statusValue === "aktif" &&
    person.fleetAllocation === true;

  const [plan, board, secondFingerAt, ftwGate, ftwRow, tap, gates, withdrawn] =
    await Promise.all([
      person ? planFacts(person, target, localDate(now)) : null,
      boardFacts(nik, target),
      stageTimeOf("finger-second", target.shift),
      ftwDeadline(target.shift),
      db
        .select()
        .from(schema.ftwReadings)
        .where(
          and(
            eq(schema.ftwReadings.nik, nik),
            eq(schema.ftwReadings.date, target.date)
          )
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
      firstTapOf(nik, target.date, target.shift),
      gateTimes(target.shift),
      person ? withdrawnFacts(person.id, nik, target, now) : null,
    ]);

  // No `finger-second` stage means no slip is printed (`issueTicket`
  // refuses), so a spare's seat stays unsaid here too.
  const secondFingerOpen =
    !!secondFingerAt && localStamp(now) >= `${target.date} ${secondFingerAt}`;

  return {
    date: target.date,
    shift: target.shift,
    roster: codes.get(target.date) ?? null,
    ...standing({
      allocatable,
      rostered: rosteredTo(target),
      plan,
      board,
      secondFingerOpen,
    }),
    ftw: ftwRow
      ? {
          // Judged as if the unit asks for it, as the FTW list does: the
          // person wants to know whether their upload passed.
          verdict: ftwGate
            ? judgeFtw({ ftw: ftwRow, requiresFtw: true, ftwDeadline: ftwGate })
            : null,
          sentAt: ftwRow.sentAt,
          sleepMinutes: ftwRow.sleepMinutes,
          category: ftwRow.sleepCategory,
        }
      : null,
    checkInAt: tap ? tap.slice(11, 19) : null,
    boardAt: board?.generatedAt ?? null,
    withdrawn,
    gates,
  };
}

async function rosterCodes(
  employeeId: string,
  dates: string[]
): Promise<Map<string, string>> {
  const rows = await db
    .select({ date: schema.rosterDays.date, code: schema.rosterDays.code })
    .from(schema.rosterDays)
    .where(
      and(
        eq(schema.rosterDays.employeeId, employeeId),
        inArray(schema.rosterDays.date, dates),
        rosterDayInForce
      )
    );
  return new Map(rows.map((r) => [r.date, r.code]));
}

export type Person = NonNullable<Awaited<ReturnType<typeof personByNik>>>;

/** The standing unit, whatever its state, and what the board would say of it. */
export async function planFacts(
  person: Person,
  target: ShiftNow,
  today: string
): Promise<PlanFacts> {
  const leader = db
    .select({
      unitId: schema.fleetUnits.unitId,
      leaderCode: sql<string>`leader.code`.as("leader_code"),
    })
    .from(schema.fleetUnits)
    .innerJoin(schema.fleets, eq(schema.fleets.id, schema.fleetUnits.fleetId))
    .innerJoin(
      sql`${schema.units} as leader`,
      sql`leader.id = ${schema.fleets.leaderUnitId}`
    )
    .as("leader");

  const [slot] = await db
    .select({
      unitId: schema.units.id,
      unit: schema.units.code,
      active: schema.units.active,
      breakdown: schema.units.breakdown,
      inAllocation: sql<boolean>`${takesPartInAllocation(schema.units.id, schema.units.fleetSupport)}`,
      area: schema.units.workArea,
      bus: sql<string | null>`transport.code`,
      fleet: leader.leaderCode,
    })
    .from(schema.fleetPlanSlots)
    .innerJoin(schema.units, eq(schema.units.id, schema.fleetPlanSlots.unitId))
    .leftJoin(
      sql`${schema.units} as transport`,
      sql`transport.id = ${schema.units.transportUnitId}`
    )
    .leftJoin(leader, eq(leader.unitId, schema.units.id))
    .where(eq(schema.fleetPlanSlots.employeeId, person.id))
    .limit(1);
  if (!slot) return null;

  const unit = await unitByCode(slot.unit, true);
  let refusal: string | null = null;
  if (unit) {
    const holdsCode = unit.simperCodeId
      ? (
          await db
            .select({ id: schema.employeeSkills.employeeId })
            .from(schema.employeeSkills)
            .where(
              and(
                eq(schema.employeeSkills.employeeId, person.id),
                eq(schema.employeeSkills.simperCodeId, unit.simperCodeId)
              )
            )
            .limit(1)
        ).length > 0
      : false;
    refusal = pairingRefusal(unit, person, { holdsCode, today });
  }

  const [partner] = await db
    .select({ id: schema.employees.id })
    .from(schema.fleetPlanSlots)
    .innerJoin(
      schema.employees,
      eq(schema.employees.id, schema.fleetPlanSlots.employeeId)
    )
    .innerJoin(
      schema.rosterDays,
      and(
        eq(schema.rosterDays.employeeId, schema.employees.id),
        eq(schema.rosterDays.date, target.date),
        eq(schema.rosterDays.code, target.shift === "day" ? "D" : "N"),
        rosterDayInForce
      )
    )
    .where(
      and(
        eq(schema.fleetPlanSlots.unitId, slot.unitId),
        ne(schema.employees.id, person.id),
        eq(schema.employees.status, "aktif")
      )
    )
    .limit(1);

  return {
    unit: slot.unit,
    active: slot.active,
    breakdown: slot.breakdown,
    inAllocation: slot.inAllocation,
    refusal,
    partnerRostered: !!partner,
    seat: {
      unit: slot.unit,
      area: slot.area ?? null,
      bus: slot.bus ?? null,
      fleet: slot.fleet ?? null,
    },
  };
}

/** The board for the shift, if built, and this person's seat on it. */
export async function boardFacts(
  nik: string,
  target: ShiftNow
): Promise<BoardFacts> {
  const [doc] = await db
    .select({
      id: schema.fleetActualDocuments.id,
      generatedAt: schema.fleetActualDocuments.generatedAt,
    })
    .from(schema.fleetActualDocuments)
    .where(
      and(
        eq(schema.fleetActualDocuments.date, target.date),
        eq(schema.fleetActualDocuments.shift, target.shift)
      )
    )
    .limit(1);
  if (!doc) return null;

  const [seat] = await db
    .select({
      unitId: schema.fleetActualSlots.unitId,
      employeeId: schema.fleetActualSlots.employeeId,
      unit: schema.units.code,
      bus: schema.fleetActualSlots.transportCode,
      area: schema.fleetActualSlots.workArea,
      fleet: schema.fleetActualFleets.leaderCode,
      source: schema.fleetActualSlots.source,
    })
    .from(schema.fleetActualSlots)
    .innerJoin(
      schema.employees,
      eq(schema.employees.id, schema.fleetActualSlots.employeeId)
    )
    .innerJoin(
      schema.units,
      eq(schema.units.id, schema.fleetActualSlots.unitId)
    )
    .leftJoin(
      schema.fleetActualFleets,
      eq(schema.fleetActualFleets.id, schema.fleetActualSlots.boardFleetId)
    )
    .where(
      and(
        eq(schema.fleetActualSlots.documentId, doc.id),
        eq(schema.employees.nik, nik),
        /* As `seatOf`: a board generated before a status change still holds
           the old seat, and it is no longer this person's. */
        eq(schema.employees.status, "aktif")
      )
    )
    .limit(1);

  const source = seat ? (seat.source ?? "manual") : null;
  /* The placement that stands is the latest one that put this person on
     this unit: an earlier one may have been undone and redone. */
  const placed =
    seat && source === "manual"
      ? (
          await db
            .select({ placedAt: schema.fleetPlacements.placedAt })
            .from(schema.fleetPlacements)
            .where(
              and(
                eq(schema.fleetPlacements.documentId, doc.id),
                eq(schema.fleetPlacements.unitId, seat.unitId),
                eq(schema.fleetPlacements.employeeId, seat.employeeId!)
              )
            )
            .orderBy(desc(schema.fleetPlacements.placedAt))
            .limit(1)
        )[0]
      : undefined;

  return {
    generatedAt: doc.generatedAt.toISOString(),
    seat: seat
      ? {
          unit: seat.unit,
          bus: seat.bus ?? null,
          area: seat.area ?? null,
          fleet: seat.fleet ?? null,
          source: source!,
          placedAt: placed?.placedAt.toISOString() ?? null,
        }
      : null,
  };
}

/** A seat the person was told about and no longer has (`withdrawnFacts`). */
export type Withdrawn = {
  unit: string;
  /** ISO instant the seat went, as the `seat-removed` notice says. */
  at: string;
  /** Null for a notice written before the cause was recorded. */
  cause: SeatRemovedCause | null;
  /** ISO instant the person's last slip naming the unit printed, or null. */
  slipPrintedAt: string | null;
  /** The unit's last status change in the day before the seat went. */
  unitStatus: { status: UnitStatus; at: string } | null;
};

/** How far back a unit's status change still explains a lost seat. */
const STATUS_LOOKBACK_MS = 24 * 60 * 60 * 1000;

const asCause = (raw: unknown): SeatRemovedCause | null =>
  (SEAT_REMOVED_CAUSES as readonly unknown[]).includes(raw)
    ? (raw as SeatRemovedCause)
    : null;

/**
 * The seat this person lost on this shift, read from their own notices.
 *
 * Only what has come due counts, so the answer moves when the phone is told
 * and never before: a seat given back to a spare stays withdrawn until the
 * second finger, when the slip would say so (domain map, "the phone never
 * runs ahead of the slip"). Per unit the last due notice decides; of the
 * units whose last word is `seat-removed`, the latest is the one named.
 *
 * It stands beside whatever seat the person holds now: lost DT-A and seated
 * on DT-B are both true, and the app words them together. `unitStatus` is
 * the unit's own record whatever the cause; only with `regenerated` does it
 * explain the loss, so the app reads it with `cause`.
 */
export async function withdrawnFacts(
  employeeId: string,
  nik: string,
  target: ShiftNow,
  now: Date
): Promise<Withdrawn | null> {
  const notices = await db
    .select({
      kind: schema.personNotifications.kind,
      params: schema.personNotifications.params,
      availableAt: schema.personNotifications.availableAt,
    })
    .from(schema.personNotifications)
    .where(
      and(
        eq(schema.personNotifications.employeeId, employeeId),
        eq(schema.personNotifications.date, target.date),
        eq(schema.personNotifications.shift, target.shift),
        lte(schema.personNotifications.availableAt, now)
      )
    )
    .orderBy(
      schema.personNotifications.availableAt,
      schema.personNotifications.createdAt
    );

  const lastByUnit = new Map<string, (typeof notices)[number]>();
  for (const row of notices) {
    const unit = (row.params as { unit?: unknown }).unit;
    if (typeof unit === "string") lastByUnit.set(unit, row);
  }
  const removed = [...lastByUnit.entries()]
    .filter(([, row]) => row.kind === "seat-removed")
    .sort(([, a], [, b]) => a.availableAt.getTime() - b.availableAt.getTime())
    .at(-1);
  if (!removed) return null;
  const [unit, notice] = removed;

  const [slip, status] = await Promise.all([
    db
      .select({ printedAt: schema.tickets.printedAt })
      .from(schema.tickets)
      .where(
        and(
          eq(schema.tickets.nik, nik),
          eq(schema.tickets.date, target.date),
          eq(schema.tickets.shift, target.shift),
          eq(schema.tickets.status, "printed"),
          isNotNull(schema.tickets.printedAt),
          sql`${schema.tickets.fields}->'seat'->>'unit' = ${unit}`
        )
      )
      .orderBy(desc(schema.tickets.printedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select({
        status: schema.unitStatusHistory.status,
        createdAt: schema.unitStatusHistory.createdAt,
      })
      .from(schema.unitStatusHistory)
      .innerJoin(
        schema.units,
        eq(schema.units.id, schema.unitStatusHistory.unitId)
      )
      .where(
        and(
          eq(schema.units.code, unit),
          lte(schema.unitStatusHistory.createdAt, notice.availableAt),
          gte(
            schema.unitStatusHistory.createdAt,
            new Date(notice.availableAt.getTime() - STATUS_LOOKBACK_MS)
          )
        )
      )
      .orderBy(desc(schema.unitStatusHistory.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  return {
    unit,
    at: notice.availableAt.toISOString(),
    cause: asCause((notice.params as { cause?: unknown }).cause),
    slipPrintedAt: slip?.printedAt?.toISOString() ?? null,
    unitStatus: status
      ? { status: status.status, at: status.createdAt.toISOString() }
      : null,
  };
}
