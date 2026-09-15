/**
 * The ride of the spare pool, for one shift (owner, 2026-09-15).
 *
 * A slip reading UNIT SPARE prints these buses and this area, and the fleet
 * wall shows them. Fleet Setting sets them — at most two buses, one area — and
 * a board copies them when it is built. So the board's copy answers once the
 * board exists, and Fleet Setting's own rows answer before: an import for the
 * next shift changes what the next shift sees, never the one under way.
 */

import { and, asc, eq } from "drizzle-orm";
import type { ShiftKind } from "@universe/contracts";

import { db, schema } from "./db";

export type SpareRide = {
  /** Vehicle codes, in the order Fleet Setting listed them. */
  buses: string[];
  area: string | null;
};

/** Null when nothing is set — the slip then prints dashes, as before. */
export async function spareRideOf(
  date: string,
  shift: ShiftKind
): Promise<SpareRide | null> {
  const [board] = await db
    .select({
      area: schema.fleetActualDocuments.spareArea,
      buses: schema.fleetActualDocuments.spareBusCodes,
    })
    .from(schema.fleetActualDocuments)
    .where(
      and(
        eq(schema.fleetActualDocuments.date, date),
        eq(schema.fleetActualDocuments.shift, shift)
      )
    )
    .limit(1);
  if (board)
    return board.buses.length || board.area
      ? { buses: board.buses, area: board.area }
      : null;

  const rows = await db
    .select({
      code: schema.units.code,
      area: schema.fleetSpareTransports.workArea,
    })
    .from(schema.fleetSpareTransports)
    .innerJoin(
      schema.units,
      eq(schema.units.id, schema.fleetSpareTransports.transportUnitId)
    )
    .orderBy(asc(schema.fleetSpareTransports.position));
  return rows.length
    ? { buses: rows.map((r) => r.code), area: rows[0]!.area }
    : null;
}
