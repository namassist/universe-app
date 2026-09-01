/**
 * Which units allocation is about.
 *
 * A unit takes part when it belongs to a formation: it leads one
 * (`fleets.digger_unit_id`) or it hauls for one (`fleet_units`). That is the
 * whole rule.
 *
 * Everything else in the register is **no-fleet**, and no-fleet is deliberately
 * *not* allocated (owner, 2026-08-31). It is a visibility bucket, not a scope:
 * Fleet Setting shows what is outside allocation so a machine cannot go quiet
 * unnoticed, and the engine ignores it entirely. Membership is therefore
 * derived — "active and in no formation" — rather than stored, which is what
 * lets formations be reshuffled without anyone maintaining a second list that
 * silently goes stale.
 *
 * Before scoping existed the engine was driven by `units` alone and built
 * boards over the whole register: 447 slots against 15 units in a formation,
 * where every bus, forklift, lowboy and ambulance appeared as a permanently
 * idle vacancy nobody would ever fill. Scoping is what makes an idle card mean
 * something again.
 *
 * A **fleet's bus is deliberately not in scope either.** It is crew transport
 * rather than a machine the pool crews — across every board generated so far,
 * all 52 bus slots were empty — and two buses serve more than one formation,
 * so a bus has no single fleet to be filed under.
 *
 * The two sources cannot overlap: `fleets.digger_unit_id` is unique and
 * `fleet_units.unit_id` is unique across the table. So a unit is configured in
 * exactly one place, and joining on either can never double a card.
 */

import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * A `where` fragment: true when this unit column belongs to a formation.
 *
 * `exists` rather than a join so callers keep their own row shape — the plan
 * board already joins `fleets` for the formation embed, and a second join for
 * the same question would multiply its rows.
 */
export function isFleetConfigured(unitId: PgColumn): SQL {
  return sql`(
    exists (select 1 from fleets f where f.digger_unit_id = ${unitId})
    or exists (select 1 from fleet_units fu where fu.unit_id = ${unitId})
  )`;
}

/**
 * The opposite: the no-fleet bucket.
 *
 * This is what Fleet Setting lists under its fixed no-fleet entry. A unit here
 * is not an error — most of the register genuinely takes no part in allocation
 * — but it is also how a unit falls out of allocation when a formation is
 * edited, so it stays visible rather than merely absent.
 */
export function isNotFleetConfigured(unitId: PgColumn): SQL {
  return sql`not ${isFleetConfigured(unitId)}`;
}
