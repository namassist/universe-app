/**
 * One operator's points for one shift (Peringkat Operator, owner 2026-10-31).
 *
 * Pure: it reads the verdicts the board's audit already reached and decides
 * nothing about readiness itself, so a shift's points can never disagree with
 * the audit table for the same person.
 *
 * It takes no role. A PLAN holder and a spare who did the same thing score the
 * same — the scheme's one fairness rule, and why a substitute bonus that only
 * a spare could earn was dropped before it shipped.
 */

import {
  POINTS,
  SLEEP_BONUS_MINUTES,
  streakBonus,
  type PointOutcome,
} from "@universe/contracts";

import type { FingerVerdict, FtwVerdict } from "./readiness";

export type ScoreInput = {
  /** The board gave them a seat — engine or manual. */
  seated: boolean;
  finger: FingerVerdict;
  /** As the audit judged it: `not-required` where the unit asks for none. */
  ftw: FtwVerdict;
  /** savera's minutes for the night before; null with no reading. */
  sleepMinutes: number | null;
  /** The run of counted shifts this one follows. */
  previousStreak: number;
};

export type ShiftScore = {
  outcome: PointOutcome;
  /** +10 for a counted shift, −15 for a not-ready one, 0 otherwise. */
  base: number;
  onTime: number;
  sleep: number;
  streakBonus: number;
  total: number;
  /** The run after this shift: grown, held, or broken back to 0. */
  streak: number;
};

const nothing = (outcome: PointOutcome, streak: number): ShiftScore => ({
  outcome,
  base: 0,
  onTime: 0,
  sleep: 0,
  streakBonus: 0,
  total: 0,
  streak,
});

/** A counted shift — operated, or stood down — scored the same either way. */
function counted(outcome: PointOutcome, input: ScoreInput): ShiftScore {
  const streak = input.previousStreak + 1;
  const onTime = input.finger === "pass" ? POINTS.onTime : 0;
  const sleep =
    input.sleepMinutes !== null && input.sleepMinutes >= SLEEP_BONUS_MINUTES
      ? POINTS.sleep
      : 0;
  const bonus = streakBonus(streak);
  return {
    outcome,
    base: POINTS.base,
    onTime,
    sleep,
    streakBonus: bonus,
    total: POINTS.base + onTime + sleep + bonus,
    streak,
  };
}

export function scoreShift(input: ScoreInput): ShiftScore {
  const ftwPassed = input.ftw === "pass" || input.ftw === "not-required";
  /* Attendance recorded, for a seat: any IN at all. A late one reaches a seat
     only through a supervisor, and still counts — just not as on time. */
  const tapped = input.finger !== "missing";

  if (input.seated) {
    if (tapped && ftwPassed) return counted("operated", input);
    if (tapped && input.ftw === "unreadable")
      return nothing("unreadable", input.previousStreak);
    return nothing("not-counted", 0);
  }

  /* Not seated: ready is the board's own rule — in time, FTW passed. */
  if (input.finger === "pass" && ftwPassed) return counted("stood-down", input);
  if (input.finger === "pass" && input.ftw === "unreadable")
    return nothing("unreadable", input.previousStreak);
  return {
    ...nothing("not-ready", 0),
    base: POINTS.notReady,
    total: POINTS.notReady,
  };
}
