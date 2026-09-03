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
