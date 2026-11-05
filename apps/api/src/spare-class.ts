/**
 * A spare's SIMPER class: how high up the yard's ladder their licence reaches
 * (owner, 2026-11-05).
 *
 * On the 2026-11-04 day board EX4011 (40T) went to the spare who tapped first
 * and held nothing above EXC 470, while two who tapped minutes later held codes
 * up to the 200T and 250T diggers. The site wants the second kind on the bigger
 * machine. So among spares who may take a vacancy, the one holding the highest
 * class goes first, and the tap only breaks a tie — in the engine
 * (`allocation.ts`) and in PLAN Generate (`plan-generate.ts`) alike.
 *
 * A class is the best (lowest) Prioritas Alokasi rank among the **active**
 * units whose SIMPER code the person holds, **per unit type**. Per type because
 * the ranks run across types — excavators 1–8, then dump trucks, rear dumps,
 * dozers — so a dump-truck code ranked 9 would otherwise outrank a rear-dump
 * specialist at 10 for a rear dump, which says nothing about who drives one
 * better. A code that only appears on unranked descriptions gives no class.
 */

import { and, eq, inArray, sql } from "drizzle-orm";

import { db, schema } from "./db";

/** employeeId → unit type (null for an untyped unit) → best rank held. */
export type SimperClasses = ReadonlyMap<
  string,
  ReadonlyMap<string | null, number>
>;

/** No ranked code in that type: after everyone who has one. */
export const UNRANKED = Number.MAX_SAFE_INTEGER;

/** The person's class for a vacancy of this unit type; lower is higher. */
export function classIn(
  classes: SimperClasses,
  employeeId: string,
  typeId: string | null
): number {
  return classes.get(employeeId)?.get(typeId) ?? UNRANKED;
}

type Reader = Pick<typeof db, "select">;

/** Every class these people hold, in one query. */
export async function simperClasses(
  reader: Reader,
  employeeIds: string[]
): Promise<SimperClasses> {
  const classes = new Map<string, Map<string | null, number>>();
  if (!employeeIds.length) return classes;

  const rows = await reader
    .select({
      employeeId: schema.employeeSkills.employeeId,
      typeId: schema.units.typeId,
      rank: sql<number>`min(${schema.allocationPriorities.rank})`.mapWith(
        Number
      ),
    })
    .from(schema.employeeSkills)
    .innerJoin(
      schema.units,
      and(
        eq(schema.units.simperCodeId, schema.employeeSkills.simperCodeId),
        eq(schema.units.active, true)
      )
    )
    .innerJoin(
      schema.allocationPriorities,
      eq(schema.allocationPriorities.description, schema.units.description)
    )
    .where(inArray(schema.employeeSkills.employeeId, employeeIds))
    .groupBy(schema.employeeSkills.employeeId, schema.units.typeId);

  for (const row of rows) {
    const byType = classes.get(row.employeeId) ?? new Map();
    byType.set(row.typeId, row.rank);
    classes.set(row.employeeId, byType);
  }
  return classes;
}
