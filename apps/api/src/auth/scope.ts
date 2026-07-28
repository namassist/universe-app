/**
 * Scope as a SQL predicate (design D8).
 *
 * Scope is only enforceable server-side, so it belongs in the where clause of
 * every scoped read and write — not in the UI, and not in a filter applied
 * after the rows have already been fetched.
 */

import { eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { SessionPrincipal } from "@universe/contracts";

import { db, schema } from "../db";

/** Matches nothing. The shape every unresolvable scope collapses to. */
const NOTHING: SQL = sql`false`;
/** Matches everything — the `all` scope adds no filter. */
const EVERYTHING: SQL = sql`true`;

export type ScopeColumns = {
  /**
   * The departemen column on the target table, when it has one.
   *
   * A `department_id`, not a department *name* (design D9). The distinction
   * matters more than it looks: comparing a name against a uuid column raises
   * no error, it simply never matches — and the symptom is a `dept` caller
   * seeing an empty set, which is indistinguishable from the feature not being
   * finished yet.
   */
  dept?: AnyPgColumn;
  /** The NIK column identifying whose record a row is, when it has one. */
  self?: AnyPgColumn;
};

/**
 * Build the predicate for a caller against one table.
 *
 * Fails closed throughout: a scope with no meaningful column on the target
 * table yields an empty set rather than the full collection, so a future role
 * that reaches a table nobody anticipated leaks nothing. Devices never reach
 * scoped collections at all.
 */
export async function scopeWhere(
  principal: SessionPrincipal,
  columns: ScopeColumns
): Promise<SQL> {
  if (principal.kind === "device") return NOTHING;

  switch (principal.scope) {
    case "all":
      return EVERYTHING;

    case "self": {
      // No NIK, or no per-account dimension on this table (units, fleets):
      // empty, not unfiltered.
      if (!principal.nik || !columns.self) return NOTHING;
      return eq(columns.self, principal.nik);
    }

    case "dept": {
      if (!principal.nik || !columns.dept) return NOTHING;
      const departemenId = await departemenIdOf(principal.nik);
      // A NIK that matches no employee still yields an empty set rather than
      // everything. That fail-closed posture is unchanged by the employee table
      // landing; what changed is only that some NIKs now resolve.
      if (departemenId === null) return NOTHING;
      return eq(columns.dept, departemenId);
    }
  }
}

/**
 * Departemen belongs to the employee record, never to the account — a transfer
 * between departments must not have to be written in two places. That makes the
 * NIK the only link, and its absence a closed door rather than an open one.
 *
 * Named for what it returns: the department's **id** (design D9). Departemen
 * has been a uuid since the master-data change, and returning the name here
 * would compile, run, raise nothing, and match no row ever — a bug whose
 * symptom is identical to this function not being implemented at all.
 *
 * The operational consequence, which belongs in the release notes rather than
 * only here: an `admin` account whose NIK is not in the employee register is
 * still blind. Provisioning order is employees first, accounts second.
 */
async function departemenIdOf(nik: string): Promise<string | null> {
  const [row] = await db
    .select({ departmentId: schema.employees.departmentId })
    .from(schema.employees)
    .where(eq(schema.employees.nik, nik))
    .limit(1);
  return row?.departmentId ?? null;
}
