/**
 * Which units allocation is about.
 *
 * A unit takes part when somebody configured it in Fleet Setting: it leads a
 * formation, it hauls for one, or it sits in the **no-fleet** entry — the list
 * for machines that belong to no formation and still need an operator every
 * shift (a grader, a water truck).
 *
 * Before this the engine was driven by `units` alone, and built boards over the
 * whole register: 447 slots on 2026-08-31 against 75 configured units, where
 * every bus, forklift, lowboy and ambulance appeared as a permanently idle
 * vacancy nobody would ever fill. Scoping is what makes an idle card mean
 * something again (owner, 2026-08-31).
 *
 * A **fleet's bus is deliberately not configured by being a bus.** It is crew
 * transport rather than a machine the pool crews — all 26 bus slots on the last
 * board were empty — and two of them serve more than one formation, so a bus
 * has no single fleet to be filed under. A bus that really does need a driver
 * goes in the no-fleet entry like anything else, by someone's decision rather
 * than as a side effect of the bus field.
 *
 * The three sources cannot overlap: `fleets.digger_unit_id` is unique,
 * `fleet_units.unit_id` is unique across the table, `no_fleet_units.unit_id` is
 * its primary key, and `refuseNoFleetUnits` rejects a unit already spoken for.
 * So a unit is configured in exactly one place, and joining on any of them can
 * never double a card.
 */

import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * A `where` fragment: true when this unit column is configured for allocation.
 *
 * `exists` rather than a join so callers keep their own row shape — the plan
 * board already joins `fleets` for the formation embed, and a second join for
 * the same question would multiply its rows.
 */
export function isFleetConfigured(unitId: PgColumn): SQL {
  return sql`(
    exists (select 1 from fleets f where f.digger_unit_id = ${unitId})
    or exists (select 1 from fleet_units fu where fu.unit_id = ${unitId})
    or exists (select 1 from no_fleet_units n where n.unit_id = ${unitId})
  )`;
}

/**
 * The opposite, for the screens that have to name what is *missing*.
 *
 * An active unit configured nowhere is not an error — plenty of the register
 * genuinely takes no part in allocation — but it is also the way a unit goes
 * quiet without anyone noticing, so it stays askable.
 */
export function isNotFleetConfigured(unitId: PgColumn): SQL {
  return sql`not ${isFleetConfigured(unitId)}`;
}
