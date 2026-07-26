import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../env";
import * as schema from "./schema";

const client = postgres(env.DATABASE_URL, { max: 10 });

export const db = drizzle(client, { schema });
export { schema };
export type { DeviceRow, RolePermissionRow, RoleRow, UserRow } from "./schema";

const UNIQUE_VIOLATION = "23505";

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
  const cause = (error as { cause?: unknown })?.cause ?? error;
  if (typeof cause !== "object" || cause === null) return false;

  const { code, constraint_name } = cause as {
    code?: string;
    constraint_name?: string;
  };
  return (
    code === UNIQUE_VIOLATION &&
    (constraint === undefined || constraint_name === constraint)
  );
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
