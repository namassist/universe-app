/**
 * Which shift a wall is showing, and for which date.
 *
 * Every other reader of a board is a person who picked a date and a shift from
 * a form. A TV in the yard has nobody to pick for it, so the question has to be
 * answered from the clock — and the answer must be the *same* boundary the
 * board itself is built on, or the screen flips to a board that does not exist
 * yet, or keeps showing a shift that ended an hour ago.
 *
 * The boundary is therefore each shift's **first** stage, `ftw-ingest`, read
 * from the master timeline (04:45 and 16:45 as configured today). A shift
 * takes the screen when its changeover *begins* rather than when its board is
 * finished, because the people the wall is for are the ones walking to the
 * gate — they need to know their unit before the line-up is final, not after.
 * Until the board is generated the wall says so, in the plain sight of a
 * provisional line-up rather than a blank. Nothing here is a constant: move
 * the stage in the timeline and the wall moves with it.
 *
 * Before the day gate the working shift is the night one that began *yesterday*
 * — a night board is filed under the date it started, so 01:00 on the 30th is
 * still the 29th's night.
 */

import type { ShiftKind } from "@universe/contracts";

import { localDate, minutesOfDay, stageMinutes } from "./scheduler";

export type ShiftNow = { date: string; shift: ShiftKind };

/** The two gate times, "HH:MM:SS", as the timeline has them. */
export type Deadlines = { day: string | null; night: string | null };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `null` when the question cannot be answered honestly: a missing deadline, or
 * a night gate that does not fall after the day gate. Inventing a boundary
 * from a half-configured timeline would put a plausible, wrong board on a wall
 * that people trust at a glance — the same reason `fingerInDeadline` refuses
 * to default.
 */
export function currentShift(now: Date, deadlines: Deadlines): ShiftNow | null {
  if (!deadlines.day || !deadlines.night) return null;

  const day = stageMinutes(deadlines.day);
  const night = stageMinutes(deadlines.night);
  if (night <= day) return null;

  const at = minutesOfDay(now);
  if (at >= night) return { date: localDate(now), shift: "night" };
  if (at >= day) return { date: localDate(now), shift: "day" };
  return { date: localDate(new Date(now.getTime() - DAY_MS)), shift: "night" };
}
