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

/** Matches nothing. The shape every unresolvable scope collapses to. */
const NOTHING: SQL = sql`false`;
/** Matches everything — the `all` scope adds no filter. */
const EVERYTHING: SQL = sql`true`;

export type ScopeColumns = {
  /** The departemen column on the target table, when it has one. */
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
      const departemen = await departemenOf(principal.nik);
      // Employee master data lands in the change after this one. Until then no
      // NIK resolves, and a dept caller sees an empty set rather than
      // everything — which is what makes the transitional state safe.
      if (departemen === null) return NOTHING;
      return eq(columns.dept, departemen);
    }
  }
}

/**
 * Departemen belongs to the employee record, never to the account — a transfer
 * between departments must not have to be written in two places. That makes the
 * NIK the only link, and its absence a closed door rather than an open one.
 *
 * The `employees` table lands with the master-data change that follows this
 * one, so today this always answers "unknown". That is deliberate rather than
 * unfinished: by D8 an unresolvable departemen yields an empty set, and by D5
 * the API serves no dept-scoped collection yet, so the inert period is
 * invisible rather than permissive. Landing the real lookup is one query here.
 */
async function departemenOf(nik: string): Promise<string | null> {
  void nik;
  return null;
}
