/**
 * Fleet composition bounds, shared so the form and the API refuse at the same
 * numbers.
 *
 * A fleet is one digger and the haulers it loads. The bounds are operational
 * rather than technical: a digger with nothing to load is not a fleet, and
 * past thirteen haulers the queue at the loading point is longer than the
 * cycle it feeds.
 */
export const FLEET_MIN_UNITS = 1;
export const FLEET_MAX_UNITS = 13;

/**
 * Unit types that may carry a fleet's crew to the pit.
 *
 * The field is called `bus` everywhere — the column, the import template, the
 * screen — because a bus is what it usually is. But the question the field
 * actually asks is "which unit brings this fleet's people to the location",
 * and a manhaul truck answers it just as well; a site short of buses runs them
 * daily. Restricting the choice to type `BUS` was reading the field's name
 * instead of its job.
 *
 * Kept as type names rather than a flag on the unit, because that is how the
 * master already distinguishes them and nothing else about these units differs.
 */
export const FLEET_TRANSPORT_TYPE_NAMES = ["BUS", "MANHAUL TRUCK"] as const;

/**
 * Whether a unit type may be a fleet's transport.
 *
 * Compared case- and padding-insensitively: the names come from an imported
 * master where "Manhaul Truck" is as likely to be typed as "MANHAUL TRUCK",
 * and a fleet refused over capitalisation is a support call, not a rule.
 */
export const isFleetTransportType = (typeName: string | null | undefined) =>
  FLEET_TRANSPORT_TYPE_NAMES.includes(
    (typeName ?? "")
      .trim()
      .toUpperCase() as (typeof FLEET_TRANSPORT_TYPE_NAMES)[number]
  );

/** For a refusal that names what the field will take. */
export const FLEET_TRANSPORT_TYPES_TEXT =
  FLEET_TRANSPORT_TYPE_NAMES.join(" atau ");

/**
 * A unit's operational status, derived from two stored flags — `breakdown`
 * wins over `standby`, and neither means `ready`. Ordered worst-first, which
 * is also the order the status screen sorts by: a broken unit is the row the
 * morning meeting is looking for.
 */
export const UNIT_STATUSES = ["breakdown", "standby", "ready"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

/* --------------------------------------------------- allocation priority */

/**
 * One orderable line of the allocation priority screen.
 *
 * The row is a **(class, SIMPER code) pair**, which is the granularity the
 * yard actually distinguishes. Neither half works alone: a class is too coarse
 * — SMALLDIGGER spans a 20-tonne ZX200 and a 47-tonne ZX470 — and a code is
 * too coarse the other way, since one chassis code like `K460 6x6` covers a
 * crane truck, a fuel truck, a service truck and a water truck.
 *
 * `typeName` groups the screen and nothing else. The ordering itself is one
 * list across every type, because the commonest tie of all is between two
 * types: 342 operators hold both DUMP TRUCK and REAR DUMP TRUCK codes, and a
 * per-type list could not answer which of those to crew first.
 */
export type AllocationPriorityRow = {
  classId: string;
  className: string;
  /** Null for the units that carry no SIMPER code — 18 of them, still real. */
  simperCodeId: string | null;
  simperCodeName: string | null;
  /** The grouping heading, not part of the key. */
  typeName: string;
  /** How many active units this pair covers, so a rank can be weighed. */
  units: number;
  /**
   * The machines themselves, in register order.
   *
   * Sent whole rather than trimmed server-side: 460 short codes across the
   * site, and which of them a reader wants to see depends on the row they are
   * looking at. The screen shows the first few and says how many follow.
   */
  unitCodes: string[];
  /**
   * 1 is crewed first. Null means nobody has ordered this pair yet — it sorts
   * last and says so, rather than inheriting a number it was never given.
   */
  rank: number | null;
};

/** One entry of a reorder: the pair, in its new position. */
export type AllocationPriorityInput = {
  classId: string;
  simperCodeId: string | null;
};
