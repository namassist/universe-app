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
 * A unit's operational status, derived from two stored flags — `breakdown`
 * wins over `standby`, and neither means `ready`. Ordered worst-first, which
 * is also the order the status screen sorts by: a broken unit is the row the
 * morning meeting is looking for.
 */
export const UNIT_STATUSES = ["breakdown", "standby", "ready"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];
