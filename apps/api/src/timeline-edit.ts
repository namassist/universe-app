/**
 * Whether the muster has already moved past a stage the admin is editing.
 *
 * The owner's rule (2026-09-23): a stage's time may be changed, but only
 * before that time arrives. Moving a gate the muster has already passed
 * rewrites what happened — the deadline everyone was judged against, the
 * window the booths were held open for — and the people it judged have
 * already tapped.
 *
 * "Already passed" is deliberately about the **running muster**, not about the
 * clock alone. At 20:00 an admin preparing tomorrow's 05:00 stage is doing
 * ordinary work, and a rule reading only "05:00 has gone by today" would
 * refuse them. A night stage keeps its muster across midnight for the same
 * reason, in the other direction.
 *
 * Pure, so the boundary can be tested without a database or a fixed clock.
 */

import type { ShiftKind } from "@universe/contracts";

/** The muster on now: which shift, and the clock it began at. */
export type RunningMuster = {
  shift: ShiftKind;
  /** `HH:MM`, the shift-start stage of that shift. */
  startsAt: string;
};

const minutesOf = (clock: string) => {
  const [hours = "0", minutes = "0"] = clock.split(":");
  return Number(hours) * 60 + Number(minutes);
};

export function editRefused(input: {
  /** The stage's stored time, `HH:MM`. */
  stageAt: string;
  /** Which muster it governs; null governs none and is never refused. */
  stageShift: ShiftKind | null;
  /** The muster running now, or null between them. */
  running: RunningMuster | null;
  now: Date;
}): boolean {
  const { stageAt, stageShift, running, now } = input;
  if (!stageShift || !running || running.shift !== stageShift) return false;

  const start = minutesOf(running.startsAt);
  const stage = minutesOf(stageAt);
  const at = now.getHours() * 60 + now.getMinutes();

  /* Both the stage and the moment are placed against the muster's own start,
     which is what carries a night shift over midnight: a 17:05 stage sits five
     minutes into its muster, and 00:30 sits seven and a half hours into it. */
  const sinceStart = (minutes: number) =>
    minutes >= start ? minutes - start : minutes + 24 * 60 - start;

  return sinceStart(stage) <= sinceStart(at);
}
