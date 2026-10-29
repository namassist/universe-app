/**
 * Test support: the saved default PLAN is one global thing, so a suite that
 * imports a PLAN file must put back whatever default stood before it ran.
 * Not imported by any route.
 */

import { db, schema } from "../db";

/** Reads the default as it stands; the returned function puts it back. */
export async function snapshotPlanDefault(): Promise<() => Promise<void>> {
  const imports = await db.select().from(schema.fleetPlanDefaultImports);
  const defaults = await db.select().from(schema.fleetPlanDefaults);
  return async () => {
    await db.delete(schema.fleetPlanDefaults);
    await db.delete(schema.fleetPlanDefaultImports);
    if (imports.length)
      await db.insert(schema.fleetPlanDefaultImports).values(imports);
    if (defaults.length)
      await db.insert(schema.fleetPlanDefaults).values(defaults);
  };
}

/** Empties the default, for the "no default yet" cases. */
export async function clearPlanDefault() {
  await db.delete(schema.fleetPlanDefaults);
  await db.delete(schema.fleetPlanDefaultImports);
}
