/**
 * Who owes a fit-to-work filing, as one rule with one home.
 *
 * Two conditions, both the owner's (2026-09-14). The position must be one that
 * is allocated a unit at all — a payroll officer on the roster is not somebody
 * the muster is waiting on. And the person must hold a licence for at least one
 * unit the master marks `ftw`.
 *
 * **The master register is the authority, not what is running today.** The flag
 * is read across every unit carrying that simper code, active or not: `active`
 * says whether a machine is in service this morning, `ftw` says whether its
 * kind demands a filing, and a dozer parked for repair has not stopped being a
 * dozer. A code with no unit at all stays silent, and that is right rather than
 * a gap — the fleet owns none of those machines, so nobody can be put on one.
 *
 * *Any* qualifying licence obliges, not all of them. Somebody licensed on both
 * an excavator and a dump truck can be given either, so he files. Production
 * holds no such person today — the register is clean — but the rule is written
 * for the day one appears rather than against today's data.
 *
 * It lives here rather than beside the wall that first needed it because the
 * dashboard needs it too, and needed it as a `where` rather than as a set. A
 * screen that counted the roster instead reported 84 people as having filed
 * nothing on 2026-09-18 when 10 had; the other 74 were never asked. Two
 * spellings of one rule is how the two screens came to disagree, so there is
 * one spelling and the set is built from it.
 */

import { and, inArray, sql } from "drizzle-orm";

import { db, schema } from "./db";

/**
 * The rule as a predicate on `employees`, to drop into an existing `where`.
 *
 * `exists` rather than joins so that it cannot change the shape of the query
 * around it: a person licensed on four qualifying codes is one row before it
 * and one row after, where an inner join would quietly quadruple them inside
 * a `count(*)`.
 *
 * Only `aktif` is allocated, so only `aktif` owes an upload. A standby
 * employee is given no unit and would stand on the wall forever as "Belum
 * upload FTW" for a unit nobody will hand him.
 */
export const ftwObligedWhere = sql`(
  ${schema.employees.status} = 'aktif'
  and exists (
    select 1 from ${schema.positions}
    where ${schema.positions.id} = ${schema.employees.positionId}
      and ${schema.positions.fleetAllocation}
  )
  and exists (
    select 1
    from ${schema.employeeSkills}
    join ${schema.units}
      on ${schema.units.simperCodeId} = ${schema.employeeSkills.simperCodeId}
     and ${schema.units.ftw}
    where ${schema.employeeSkills.employeeId} = ${schema.employees.id}
  )
)`;

/** Of these people, the ones the rule above obliges. */
export async function ftwObliged(niks: string[]): Promise<Set<string>> {
  if (!niks.length) return new Set();
  const rows = await db
    .select({ nik: schema.employees.nik })
    .from(schema.employees)
    .where(and(inArray(schema.employees.nik, niks), ftwObligedWhere));
  return new Set(rows.map((r) => r.nik));
}
