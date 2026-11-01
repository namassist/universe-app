/**
 * Helpers for one operator's point breakdown (Peringkat Operator). Pure, so
 * they test without a browser (`leaderboard-breakdown-rows.test.ts`).
 *
 * The ledger keeps what a shift scored, not every verdict behind it (owner,
 * 2026-11-01: no schema change for this page), so a line's reason is read
 * from what it does keep: whether they tapped in at all.
 */

import { BREAKDOWN_KINDS, type BreakdownKind } from "@universe/contracts";

import type { PeriodKind } from "./leaderboard-period";
import { monthPeriod, weekPeriod, type Period } from "./leaderboard-rows";

/** What the board was filtered by — the page opens on the same. */
export type BreakdownFilter = {
  from: string;
  to: string;
  /** Empty for every type. */
  unitType: string;
  /** Empty for the whole site. */
  department: string;
};

/** The page that breaks a board's points down, for one operator. */
export function breakdownHref(
  employeeId: string,
  filter: BreakdownFilter
): string {
  return `/leaderboard/${encodeURIComponent(employeeId)}?${filterQuery(filter)}`;
}

/** A filter as a query string: the period, then type and department when set. */
function filterQuery(filter: BreakdownFilter): URLSearchParams {
  const query = new URLSearchParams({ from: filter.from, to: filter.to });
  if (filter.unitType) query.set("unitType", filter.unitType);
  if (filter.department) query.set("department", filter.department);
  return query;
}

/**
 * The board a breakdown was opened from, as an address. The board holds its
 * filters in state, which a remount loses; it reads these on opening, so
 * "back" lands on the board the click came from.
 */
export function boardHref(filter: BreakdownFilter): string {
  return `/leaderboard?${filterQuery(filter)}`;
}

/** Which of the board's period kinds a range is: a Monday-to-Sunday week, a
    whole calendar month, or a custom range. */
export function periodKindOf(period: Period): PeriodKind {
  const week = weekPeriod(period.from);
  if (week.from === period.from && week.to === period.to) return "week";
  const month = monthPeriod(period.from.slice(0, 7));
  if (month.from === period.from && month.to === period.to) return "month";
  return "custom";
}

/** The filter an address carries; null without both ends of a period. */
export function readBreakdownFilter(
  params: URLSearchParams
): BreakdownFilter | null {
  const from = params.get("from");
  const to = params.get("to");
  if (!from || !to) return null;
  return {
    from,
    to,
    unitType: params.get("unitType") ?? "",
    department: params.get("department") ?? "",
  };
}

/** What a line's reason and unit are read from. */
export type ReasonLine = {
  kind: BreakdownKind;
  attended: boolean | null;
  unitCode: string | null;
  onBoard: boolean;
};

export type LineReason =
  /** Not ready, and no IN tap at all. */
  | "noTap"
  /** Not ready with a tap: it came late, or FTW did not pass. */
  | "lateOrFtw"
  /** Seated by a supervisor without a tap. */
  | "seatedNoTap"
  /** Seated by a supervisor over an FTW that did not pass. */
  | "seatedNoFtw";

/** Why a line scored nothing or lost points; null where the kind says it. */
export function lineReason(line: ReasonLine): LineReason | null {
  if (line.kind === "not-ready") return line.attended ? "lateOrFtw" : "noTap";
  if (line.kind === "not-counted")
    return line.attended ? "seatedNoFtw" : "seatedNoTap";
  return null;
}

export type UnitRole =
  /** Sat on it. */
  | "operated"
  /** Their PLAN unit, which they did not drive that shift. */
  | "plan"
  /** No seat and no PLAN unit. */
  | "spare"
  /** A unit, without saying whether they sat on it. */
  | "unit";

/**
 * What the unit on a line was to them. The ledger stores the seat's unit,
 * else the PLAN unit: an operated or not-counted shift was seated, a
 * stand-down or not-ready one was not. An unreadable FTW is either.
 */
export function unitRole(line: ReasonLine): UnitRole | null {
  switch (line.kind) {
    case "operated":
    case "not-counted":
      return line.unitCode ? "operated" : null;
    case "stood-down":
    case "not-ready":
      return line.unitCode ? "plan" : "spare";
    case "unreadable":
      return line.unitCode ? "unit" : null;
    default:
      return null;
  }
}

/**
 * Lines per kind. A shift outcome counts when it is on this board, so a
 * type's page counts that type's shifts; a roster day counts whatever the
 * board, being on none.
 */
export function kindCounts(
  lines: readonly ReasonLine[]
): Record<BreakdownKind, number> {
  const counts = Object.fromEntries(
    BREAKDOWN_KINDS.map((kind) => [kind, 0])
  ) as Record<BreakdownKind, number>;
  for (const line of lines) {
    const rosterDay = line.kind === "off-roster" || line.kind === "unsettled";
    if (rosterDay || line.onBoard) counts[line.kind] += 1;
  }
  return counts;
}
