/**
 * The category a chart groups a unit — and its operator — under.
 *
 * `unit_types` is almost the vocabulary the morning report already uses
 * (owner, 2026-09-18): DOZER, WATER TRUCK, MANHAUL TRUCK, and the two truck
 * types the report writes as OHT and DT. The one place it is too coarse is
 * `EXCAVATOR`, which holds both the production digger that leads a formation
 * and the small excavator that supports one — two jobs nobody in the yard
 * would put on the same bar. `unit_classes` already draws exactly that line
 * (`BIGDIGGER`, `MEDIUMDIGGER`, `SMALLDIGGER`, `WHEELDIGGER`), so excavators
 * are grouped by class and everything else by type.
 *
 * A derived expression rather than a column, for the same reason formation
 * membership is derived: a stored category is a second list to maintain, and
 * the day somebody adds an excavator class it would silently go stale.
 *
 * The equipment report is deliberately *not* grouped this way — it wants the
 * tonnage split (`REARDUMP100T` against `REARDUMP60T`), so it groups by class
 * throughout. Two questions, two granularities, on purpose.
 */

import { sql, type SQL } from "drizzle-orm";

import { schema } from "./db";

/**
 * Needs `unit_types` joined and `unit_classes` left-joined by the caller.
 *
 * `coalesce` on the class because `units.class_id` is nullable: an excavator
 * with no class set falls back to "EXCAVATOR" rather than to null, which would
 * drop the row out of a `group by` and quietly shrink the chart's total.
 */
export const unitCategory: SQL<string> = sql`case
  when ${schema.unitTypes.name} = 'EXCAVATOR'
    then coalesce(${schema.unitClasses.name}, ${schema.unitTypes.name})
  else ${schema.unitTypes.name}
end`;
