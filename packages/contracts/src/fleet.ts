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
 * The row is a **unit description** — `EXCAVATOR200T`, `REARDUMP60T` — which
 * is the register's own statement of how big a machine is. It replaced a
 * (class, SIMPER code) pair that existed only because the class was too
 * coarse: `SMALLDIGGER` covered both a 20-tonne excavator and a 47-tonne one,
 * so the licence had to stand in for a size the class would not give.
 *
 * Everything else here is context for setting a rank, never part of it. A
 * description covers one unit type but may cover several licences and makes,
 * and naming them is what lets somebody rank a line against real machines
 * instead of against a word.
 */
export type AllocationPriorityRow = {
  /** The key. Exactly as the register spells it. */
  description: string;
  /** The grouping heading. One per description — checked, not assumed. */
  typeName: string;
  /** How many active units this description covers, so a rank can be weighed. */
  units: number;
  /**
   * The licences these machines ask for.
   *
   * Shown because they are what decides who may drive them, and a description
   * can span several — four sit under `EXCAVATOR200T`. They no longer split
   * the row: all four are ~200-tonne excavators, and which of them a given
   * operator may take is settled by eligibility, not by this order.
   */
  simperCodeNames: string[];
  /** The makes, alphabetically. Shown, never ranked. */
  brandNames: string[];
  /** The machines themselves, in register order. */
  unitCodes: string[];
  /**
   * 1 is crewed first. Null means nobody has ordered this description yet — it
   * sorts last and says so, rather than inheriting a number it was never
   * given.
   */
  rank: number | null;
};

/** One entry of a reorder: the description, in its new position. */
export type AllocationPriorityInput = {
  description: string;
};
