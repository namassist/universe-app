import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import { env } from "../env";
import * as schema from "./schema";

/**
 * Any of the eleven master catalogue tables, seen through the columns they all
 * share. Structural rather than a union of the eleven, so the generic route and
 * the seed both address them without enumerating them a second time.
 */
export type NamedCatalogue = PgTable & {
  id: AnyPgColumn;
  name: AnyPgColumn;
  active: AnyPgColumn;
  createdAt: AnyPgColumn;
};

const client = postgres(env.DATABASE_URL, { max: 10 });

export const db = drizzle(client, { schema });
export { schema };

/**
 * The handle `db.transaction` hands its callback, named so a helper can take
 * one as a parameter. Derived from `db` rather than written out, because the
 * concrete type depends on the driver and would go stale the day it changes.
 */
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type {
  BusScheduleRow,
  CompanyRow,
  DepartmentRow,
  DeviceRow,
  DeviceRunTextRow,
  EmployeeRow,
  EmployeeSkillRow,
  FingerprintMachineRow,
  MessRow,
  PositionRow,
  RolePermissionRow,
  RoleRow,
  RosterDayRow,
  RosterDocumentRow,
  RosterRevisionItemRow,
  RosterRevisionRow,
  RunTextRow,
  SimperCodeRow,
  SimperTypeRow,
  SoundRow,
  TimelineStageRow,
  UnitBrandRow,
  UnitClassRow,
  UnitModelRow,
  UnitRow,
  UnitTypeRow,
  UserRow,
} from "./schema";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

/** The driver error, wherever Drizzle wrapped it. */
function driverError(
  error: unknown
): { code?: string; constraint_name?: string } | null {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  if (typeof cause !== "object" || cause === null) return null;
  return cause as { code?: string; constraint_name?: string };
}

/**
 * Drizzle wraps driver errors in DrizzleQueryError, so the Postgres error code
 * lives on `.cause`, not on the error itself. Pass `constraint` to tell two
 * unique indexes apart — mapping every 23505 to one message is a lie once a
 * table has more than one unique column.
 */
export function isUniqueViolation(
  error: unknown,
  constraint?: string
): boolean {
  const cause = driverError(error);
  if (!cause) return false;
  return (
    cause.code === UNIQUE_VIOLATION &&
    (constraint === undefined || cause.constraint_name === constraint)
  );
}

/**
 * A delete refused because something still references the row.
 *
 * Catching this beats pre-counting: a separate `SELECT count(*)` is a race — a
 * unit created between the count and the delete would be orphaned by a delete
 * the count said was safe — and the database is going to check anyway. The
 * count is then read only to *explain* the refusal, where being a moment stale
 * costs nothing.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return driverError(error)?.code === FOREIGN_KEY_VIOLATION;
}

/** Used by /health. Cheap enough to run per request. */
export async function pingDb(): Promise<boolean> {
  try {
    await client`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
