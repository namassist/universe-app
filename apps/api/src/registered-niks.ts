/**
 * The NIKs the employee register knows, normalized the way the sources are.
 *
 * The outside sources describe far more people than this application does —
 * the booths carry 2,930 enrolled fingers against our 989 employees, and
 * savera reports FTW for every driver on site whether or not the register
 * holds them. A snapshot row for somebody we have no record of is read by no
 * screen that matters and shown by the ones that list the snapshot raw, so
 * both pulls drop them before writing.
 *
 * Every employee counts, whatever their status: "not in the register" is the
 * question, and a `nonaktif` employee is still somebody we know.
 *
 * Read once per pass by the caller, never per row.
 */

import { db, schema } from "./db";
import { normalizeNik } from "./sources/nik";

export async function registeredNiks(): Promise<Set<string>> {
  const rows = await db
    .select({ nik: schema.employees.nik })
    .from(schema.employees);
  return new Set(
    rows.flatMap((row) => {
      const nik = normalizeNik(row.nik);
      return nik ? [nik] : [];
    })
  );
}
