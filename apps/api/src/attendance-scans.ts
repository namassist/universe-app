/**
 * The attendance wall's scans: one ticket per tap, in the order they reach us.
 *
 * Two sources see the same taps. A live session hears one about a second after
 * the finger leaves the glass, but only on a Universe machine somebody is
 * listening to; the periodic pull reads every booth machine, a minute and a
 * half later, in batches. The wall takes both — a scan the live session caught
 * appears at once, the rest arrive with the pull — and a tap both of them saw
 * is still one ticket.
 *
 * **Ordered by when we learned of it, not by the machine's clock.** The wall
 * plays tickets as they arrive; a pulled batch from 05:10 that reaches us at
 * 05:11:30 comes after a live tap heard at 05:11, not before it. And a machine
 * whose clock is out cannot push its taps to the front.
 *
 * Pure, so the tests never have to arrange a clock or a database.
 */

import type { TicketFields } from "./ticket-escpos";

/** One source's record of a tap, and when it reached us. */
export type ScanSighting = {
  ip: string;
  nik: string;
  /** The machine's own wall clock, "YYYY-MM-DD HH:MM:SS", as stored. */
  at: string;
  seenAt: Date;
  /** Only the pull knows it; a live event carries no in/out. */
  direction?: "in" | "out";
};

export type MergedScan = ScanSighting & {
  /** One tap, whichever source saw it: the columns both tables are unique on. */
  key: string;
};

/**
 * How many scans a poll carries.
 *
 * The screen keeps only twenty waiting, so this is not a page size — it is how
 * far back a screen can look to find scans that reached the database after it
 * last asked. A pull stamps its whole batch when it starts and commits when it
 * ends, so a batch can land "in the past" of a live tap read in between; the
 * screen still finds it here, because it goes by which keys it has seen rather
 * than by a timestamp.
 */
export const SCANS_ON_WIRE = 100;

const keyOf = (s: ScanSighting) => `${s.ip}|${s.nik}|${s.at}`;

export function mergeScans(...sources: ScanSighting[][]): MergedScan[] {
  const byKey = new Map<string, MergedScan>();
  for (const sighting of sources.flat()) {
    const key = keyOf(sighting);
    const known = byKey.get(key);
    // First seen wins: that is the moment the tap reached the wall. The
    // direction is kept from whichever source knew it — the live session is
    // usually first, and never knows.
    const direction = known?.direction ?? sighting.direction;
    if (!known || sighting.seenAt < known.seenAt)
      byKey.set(key, { ...sighting, key, direction });
    else if (direction !== known.direction)
      byKey.set(key, { ...known, direction });
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.seenAt.getTime() - b.seenAt.getTime() || a.key.localeCompare(b.key)
  );
}

/** The newest `limit` scans, oldest of them first — the order they play in. */
export function latestScans(merged: MergedScan[], limit: number) {
  return merged.slice(-limit);
}

/** The parts of a stored slip's fields the wall reads. */
type SlipFields = Pick<TicketFields, "seat" | "withoutUnit" | "spareRide">;

export type SlipSeat = {
  unit: string;
  area: string | null;
  bus: string | null;
};

/**
 * What the slip said about where to go, in the words it printed.
 *
 * A seat is its unit, area and bus; a spare reads SPARE with the spare pool's
 * buses and where they wait; anybody else, a dash. `null` means no slip was
 * issued — the booth has no printer, or the ticket is still being rendered —
 * which is a different answer from a slip that printed a dash.
 */
export function slipSeat(fields: SlipFields | null): SlipSeat | null {
  if (!fields) return null;
  if (fields.seat)
    return {
      unit: fields.seat.unit,
      area: fields.seat.area,
      bus: fields.seat.bus,
    };
  if (fields.withoutUnit === "spare")
    return {
      unit: "SPARE",
      area: fields.spareRide?.area ?? null,
      bus: fields.spareRide?.buses.join(", ") || null,
    };
  return { unit: "-", area: null, bus: null };
}
