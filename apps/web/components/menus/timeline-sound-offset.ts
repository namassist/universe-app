/**
 * The "when does the sound play" stepper on the Timeline menu, as pure logic.
 *
 * Minutes from the stage's own time, five before to five after (owner,
 * 2026-10-10), moved one minute per press and never typed — the API refuses
 * anything outside the range, and a stepper cannot produce it.
 */

import { SOUND_OFFSET_MAX, SOUND_OFFSET_MIN } from "@universe/contracts";

export function stepSoundOffset(value: number, delta: 1 | -1): number {
  return Math.min(SOUND_OFFSET_MAX, Math.max(SOUND_OFFSET_MIN, value + delta));
}

const DAY_MINUTES = 24 * 60;
const pad = (n: number) => String(n).padStart(2, "0");

/** `HH:MM` the sound plays at, wrapping past midnight; "" without a time. */
export function soundTimeFor(at: string, offset: number): string {
  const [hours, minutes] = at.split(":").map(Number);
  if (!at || hours === undefined || minutes === undefined) return "";
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return "";
  const total =
    (((hours * 60 + minutes + offset) % DAY_MINUTES) + DAY_MINUTES) %
    DAY_MINUTES;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}
