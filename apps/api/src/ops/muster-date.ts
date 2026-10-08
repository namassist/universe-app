/**
 * Which muster a stage belongs to on the Operations Center, and whether its
 * moment has come.
 *
 * "Today's stages" is the wrong question after midnight: at 03:00 the muster
 * under way is the night shift that began yesterday, and its 17:25 gate is
 * yesterday's. Reading today's date there shows tonight's gates, all still
 * ahead, and hides the one muster that is actually running. So a stage of the
 * running shift is placed on that muster's date — the same boundary the walls
 * turn over on (`current-shift.ts`) — and everything else on today's.
 */

import type { ShiftKind } from "@universe/contracts";

import { localDate } from "../scheduler";

export function stageMusterDate(
  shift: ShiftKind | null,
  now: Date,
  running: { date: string; shift: ShiftKind } | null
): string {
  if (shift && running && running.shift === shift) return running.date;
  return localDate(now);
}

/** Whether a stage's time on its muster's date has arrived, by the local clock. */
export function stageDue(date: string, clock: string, now: Date): boolean {
  const [year, month, day] = date.split("-").map(Number);
  const [hours = 0, minutes = 0] = clock.split(":").map(Number);
  const moment = new Date(year!, month! - 1, day!, hours, minutes);
  return moment.getTime() <= now.getTime();
}
