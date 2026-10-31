/**
 * Peringkat Operator: a period of settled points, ranked. Pure — the route
 * loads the tallies, this checks the period and orders them.
 */

import { LEADERBOARD_MAX_DAYS } from "@universe/contracts";

const DAY_MS = 86_400_000;

/** What ranking reads of an operator's tally; the route's rows carry more. */
export type Rankable = {
  employeeId: string;
  nik: string;
  name: string;
  total: number;
  operated: number;
  stoodDown: number;
};

export type Ranked<T> = T & { rank: number };

export type PeriodCheck =
  | { kind: "ok"; from: string; to: string; toExclusive: string }
  /** Not a calendar date (2026-02-30), which `Date` would roll over. */
  | { kind: "invalid" }
  | { kind: "reversed" }
  | { kind: "too-long" };

const parse = (date: string): Date | null => {
  const at = new Date(`${date}T00:00:00Z`);
  /* Year 9999 is out too: the day after its last has no 4-digit year. */
  if (Number.isNaN(at.getTime()) || at.getUTCFullYear() > 9998) return null;
  return at.toISOString().slice(0, 10) === date ? at : null;
};
const iso = (at: Date) => at.toISOString().slice(0, 10);

/**
 * `from`..`to`, both ends counted, as the query reads it: up to the day after
 * `to`. A night shift is filed under the date it began, so a period's last
 * night belongs to it even though it ends the morning after.
 */
export function periodRange(from: string, to: string): PeriodCheck {
  const start = parse(from);
  const end = parse(to);
  if (!start || !end) return { kind: "invalid" };
  const days = (end.getTime() - start.getTime()) / DAY_MS + 1;
  if (days < 1) return { kind: "reversed" };
  if (days > LEADERBOARD_MAX_DAYS) return { kind: "too-long" };
  return {
    kind: "ok",
    from,
    to,
    toExclusive: iso(new Date(end.getTime() + DAY_MS)),
  };
}

/** The calendar month `date` falls in, first day to last. */
export function monthOf(date: string): { from: string; to: string } {
  const [year, month] = date.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0));
  return { from: `${date.slice(0, 7)}-01`, to: iso(last) };
}

const counted = (t: Rankable) => t.operated + t.stoodDown;

/**
 * Highest total first; on equal totals, more counted shifts — the steadier
 * operator — first. Equal on both is a tie: the same rank, and the next rank
 * skips (1, 1, 3), so nobody is placed above an equal by their name.
 */
export function rankLeaderboard<T extends Rankable>(
  tallies: readonly T[]
): Ranked<T>[] {
  const sorted = [...tallies].sort(
    (a, b) =>
      b.total - a.total ||
      counted(b) - counted(a) ||
      a.name.localeCompare(b.name) ||
      a.nik.localeCompare(b.nik)
  );
  const rows: Ranked<T>[] = [];
  for (const [i, tally] of sorted.entries()) {
    const prev = rows[i - 1];
    const tied =
      prev !== undefined &&
      prev.total === tally.total &&
      counted(prev) === counted(tally);
    rows.push({ ...tally, rank: tied ? prev.rank : i + 1 });
  }
  return rows;
}
