/**
 * One operator's period on Peringkat Operator, shift by shift — the page a
 * board's points open. Pure: the route loads the rows, this lays them out.
 *
 * The settled ledger rows are the lines that score. The roster fills in the
 * days the ledger has no row for, so the timeline has no unexplained gaps: a
 * day off the D/N roster (`off-roster`), and a rostered shift nothing was
 * settled for (`unsettled`). Neither scores, and neither moves the streak.
 *
 * The sums are the board's, by the board's rules, so the number clicked is the
 * number at the foot of the page: on a type's board only that type's shifts
 * count, an untyped shift counting on the type the person operated most
 * (`routes/leaderboard.ts`). Every shift is still listed — the streak runs over
 * all of them — and `onBoard` says which ones were summed.
 */

import {
  type BreakdownKind,
  type PointOutcome,
  type RosterCode,
  rosterShift,
  type ShiftKind,
} from "@universe/contracts";

/** A settled `operator_points` row, as the page reads it. */
export type LedgerLine = {
  date: string;
  shift: ShiftKind;
  outcome: PointOutcome;
  unitCode: string | null;
  unitTypeId: string | null;
  base: number;
  onTime: number;
  sleep: number;
  streakBonus: number;
  total: number;
  streak: number;
  attended: boolean;
  sleepMinutes: number | null;
};

/** One in-force roster day. */
export type RosterLine = { date: string; code: RosterCode };

export type BreakdownLine = {
  date: string;
  /** null on a day off the D/N roster, which is no shift. */
  shift: ShiftKind | null;
  /** The roster's code, for a line that came from the roster. */
  rosterCode: RosterCode | null;
  kind: BreakdownKind;
  unitCode: string | null;
  unitTypeId: string | null;
  /** Summed on the board asked for. Always false for a roster line. */
  onBoard: boolean;
  base: number;
  onTime: number;
  sleep: number;
  streakBonus: number;
  total: number;
  /** The run after this shift; null where the line leaves it as it was. */
  streak: number | null;
  /** Tapped in, on time or late; null for a roster line. */
  attended: boolean | null;
  sleepMinutes: number | null;
  /** The board's total up to and including this line. */
  running: number;
};

export type Breakdown = {
  lines: BreakdownLine[];
  total: number;
  /** The not-ready points lost on this board, negative; 0 with none. */
  penalty: number;
  /** Operated and stood-down shifts on this board. */
  counted: number;
  /** The run their last settled shift in the period ended on, any type. */
  streak: number;
};

const SHIFT_ORDER: Record<ShiftKind, number> = { day: 0, night: 1 };

/**
 * The type a person operated most in the period: operated shifts only, ties
 * to the one operated last, then by id — the board's `home`, in memory.
 */
export function homeType(lines: readonly LedgerLine[]): string | null {
  const byType = new Map<string, { shifts: number; last: string }>();
  for (const line of lines) {
    if (line.outcome !== "operated" || line.unitTypeId === null) continue;
    const seen = byType.get(line.unitTypeId);
    byType.set(line.unitTypeId, {
      shifts: (seen?.shifts ?? 0) + 1,
      last: seen && seen.last > line.date ? seen.last : line.date,
    });
  }
  const ranked = [...byType.entries()].sort(
    ([idA, a], [idB, b]) =>
      b.shifts - a.shifts ||
      b.last.localeCompare(a.last) ||
      idA.localeCompare(idB)
  );
  return ranked[0]?.[0] ?? null;
}

const fromLedger = (
  line: LedgerLine,
  onBoard: boolean
): Omit<BreakdownLine, "running"> => ({
  date: line.date,
  shift: line.shift,
  rosterCode: null,
  kind: line.outcome,
  unitCode: line.unitCode,
  unitTypeId: line.unitTypeId,
  onBoard,
  base: line.base,
  onTime: line.onTime,
  sleep: line.sleep,
  streakBonus: line.streakBonus,
  total: line.total,
  streak: line.streak,
  attended: line.attended,
  sleepMinutes: line.sleepMinutes,
});

const fromRoster = (line: RosterLine): Omit<BreakdownLine, "running"> => {
  const shift = rosterShift(line.code);
  return {
    date: line.date,
    shift,
    rosterCode: line.code,
    kind: shift ? "unsettled" : "off-roster",
    unitCode: null,
    unitTypeId: null,
    onBoard: false,
    base: 0,
    onTime: 0,
    sleep: 0,
    streakBonus: 0,
    total: 0,
    streak: null,
    attended: null,
    sleepMinutes: null,
  };
};

export function breakdown(input: {
  ledger: readonly LedgerLine[];
  roster: readonly RosterLine[];
  /** A type's board; null for every type. */
  unitType: string | null;
  /** The local date: a roster day after it has not happened yet. */
  today: string;
}): Breakdown {
  const home = homeType(input.ledger);
  const counts = (line: LedgerLine) =>
    input.unitType === null || (line.unitTypeId ?? home) === input.unitType;

  /* A settled date speaks for itself: a roster changed after the shift
     closed does not add a second line beside what was scored. */
  const settledDates = new Set(input.ledger.map((l) => l.date));
  /* One line a date: somebody transferred mid-month is on two departments'
     documents, and the first the route read stands. */
  const unscored = new Map<string, RosterLine>();
  for (const day of input.roster)
    if (
      day.date <= input.today &&
      !settledDates.has(day.date) &&
      !unscored.has(day.date)
    )
      unscored.set(day.date, day);

  const ordered = [
    ...input.ledger.map((l) => fromLedger(l, counts(l))),
    ...[...unscored.values()].map(fromRoster),
  ].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.shift ? SHIFT_ORDER[a.shift] : -1) -
        (b.shift ? SHIFT_ORDER[b.shift] : -1)
  );

  let running = 0;
  const lines = ordered.map((line): BreakdownLine => {
    if (line.onBoard) running += line.total;
    return { ...line, running };
  });

  const board = lines.filter((l) => l.onBoard);
  const lastSettled = lines.filter((l) => l.streak !== null).at(-1);
  return {
    lines,
    total: running,
    penalty: board
      .filter((l) => l.total < 0)
      .reduce((sum, l) => sum + l.total, 0),
    counted: board.filter(
      (l) => l.kind === "operated" || l.kind === "stood-down"
    ).length,
    streak: lastSettled?.streak ?? 0,
  };
}
