/**
 * When a tap the machine marked OUT is an arrival after all.
 *
 * An operator who taps with the machine left on *Pulang* has still arrived.
 * The live session hears no direction and printed his unit; the pull later
 * stored the same tap as OUT, the reading went OUT-only (`missing`), and the
 * board gave his unit to a spare (2026-11-14). The slip and the board now read
 * one rule, from here.
 *
 * **An OUT is an arrival when it falls inside a shift's muster window and the
 * person is rostered to that shift that date.** The roster half is what keeps
 * the day shift going home at 17:00, inside the night window, from becoming a
 * night arrival.
 *
 * The window is `shift-start` up to `bus-depart` plus
 * `DEVICE_COLLECT_GRACE_MINUTES`: the same end the booths stop being heard at
 * (`scheduler.ts`, `listenClosesAt`). A missing stage is no window, never a
 * default, and an OUT then stays an OUT, as it did before.
 */

import type { ShiftKind } from "@universe/contracts";

import { env } from "./env";
import { stageTimeOf } from "./stage-time";

/** `"HH:MM:SS"` bounds: `from` inclusive, `until` exclusive. */
export type ArrivalWindow = { from: string; until: string };

export type ArrivalWindows = Partial<Record<ShiftKind, ArrivalWindow>>;

const MINUTES_PER_DAY = 24 * 60;

const minutesOf = (clock: string): number => {
  const [hours = "0", minutes = "0"] = clock.split(":");
  return Number(hours) * 60 + Number(minutes);
};

const clockOfMinutes = (total: number): string =>
  `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00`;

/** A stage time as `"HH:MM:SS"`, whether the timeline wrote seconds or not. */
const fullClock = (clock: string): string =>
  clock.length === 5 ? `${clock}:00` : clock;

/**
 * One shift's window from its two stages. Pure.
 *
 * A window that would run past midnight stops at the end of the day: the taps
 * after it belong to the next date's reading, which this cannot speak for.
 */
export function windowOf(
  shiftStart: string | null,
  busDepart: string | null,
  graceMinutes: number
): ArrivalWindow | null {
  if (!shiftStart || !busDepart) return null;
  const end = Math.min(minutesOf(busDepart) + graceMinutes, MINUTES_PER_DAY);
  if (end <= minutesOf(shiftStart)) return null;
  return { from: fullClock(shiftStart), until: clockOfMinutes(end) };
}

/** Noon splits the day, the same way `shiftIn` splits a reading. */
const sideOfNoon = (clock: string, shift: ShiftKind): boolean =>
  shift === "night" ? clock >= "12:00:00" : clock < "12:00:00";

/**
 * Whether an OUT tap at `at` (local `"YYYY-MM-DD HH:MM:SS"`) is an arrival for
 * somebody rostered to `rostered` that date. Pure.
 *
 * The noon check keeps an arrival in its own shift's column: a window retimed
 * across noon must not file a morning arrival where `shiftIn` reads the night.
 */
export function outIsArrival(
  at: string,
  rostered: ShiftKind | null,
  windows: ArrivalWindows
): boolean {
  if (!rostered) return false;
  const window = windows[rostered];
  if (!window) return false;
  const clock = at.slice(11, 19);
  return (
    clock >= window.from && clock < window.until && sideOfNoon(clock, rostered)
  );
}

/** Both shifts' windows, as the timeline reads now. */
export async function arrivalWindows(): Promise<ArrivalWindows> {
  const grace = env.DEVICE_COLLECT_GRACE_MINUTES;
  const [dayStart, dayBus, nightStart, nightBus] = await Promise.all([
    stageTimeOf("shift-start", "day"),
    stageTimeOf("bus-depart", "day"),
    stageTimeOf("shift-start", "night"),
    stageTimeOf("bus-depart", "night"),
  ]);
  const day = windowOf(dayStart, dayBus, grace);
  const night = windowOf(nightStart, nightBus, grace);
  return {
    ...(day ? { day } : {}),
    ...(night ? { night } : {}),
  };
}
