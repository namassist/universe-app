/**
 * The board's status filter and the counts its segments carry, kept apart
 * from the markup so it can be tested.
 */

export type StatusFilter =
  "all" | "unalloc" | "alloc" | "vacant" | "clash" | "issue";

/** What the filter needs to know about one unit, already judged by the board. */
export type UnitFacts = {
  /** Anyone paired with it at all. */
  allocated: boolean;
  /** PLAN: nobody to run it on the chosen shift. */
  vacant: boolean;
  /** PLAN: two holders on one shift today. */
  clash: boolean;
  /** Breakdown, downtime or a gugur slip. */
  issue: boolean;
};

export function matchesStatus(filter: StatusFilter, unit: UnitFacts): boolean {
  switch (filter) {
    case "all":
      return true;
    case "unalloc":
      return !unit.allocated;
    case "alloc":
      return unit.allocated;
    case "vacant":
      return unit.vacant;
    case "clash":
      return unit.clash;
    case "issue":
      return unit.issue;
  }
}

/**
 * How many units each segment would show. Pass the units the rest of the view
 * (formation, search) already settled on, so a segment's number is exactly
 * the number of cards its click leaves on screen.
 */
export function statusCounts<F extends StatusFilter>(
  units: readonly UnitFacts[],
  filters: readonly F[]
): Record<F, number> {
  return Object.fromEntries(
    filters.map((f) => [f, units.filter((u) => matchesStatus(f, u)).length])
  ) as Record<F, number>;
}
