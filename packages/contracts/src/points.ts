/**
 * The operator points scheme behind Peringkat Operator (owner, 2026-10-31).
 *
 * Points measure what an operator controls — turning up on time, sleeping,
 * passing FTW, and keeping it up — never what allocation decided for them. A
 * PLAN holder and a spare are scored by the same rules and reach the same
 * maximum: a substitute bonus was drafted and dropped, because replayed on
 * real musters it made the spare seat the one worth having.
 *
 * The values live here because two things read them: the API, which scores a
 * shift, and the screen, which explains the score.
 */

export const POINTS = {
  /** Operating, or ready with no seat to take. */
  base: 10,
  /** The first IN of the shift strictly before `finger-in`. */
  onTime: 2,
  /** Sleep at or above `SLEEP_BONUS_MINUTES`, as savera measured it. */
  sleep: 3,
  /** Per consecutive counted shift after the first. */
  streakStep: 2,
  streakMax: 10,
  /** Rostered, and not ready: no tap, a late tap, or FTW not passed. */
  notReady: -15,
} as const;

/**
 * Six hours. Ours, not savera's: savera passes FTW from 5 h 30, and this is
 * the bonus for sleeping past the pass line.
 */
export const SLEEP_BONUS_MINUTES = 360;

/**
 * What one shift was, for one operator — the row on the ledger.
 *
 * - `operated` — seated, a tap that shift, FTW passed or not asked for.
 * - `stood-down` — ready, and the board had no seat they could take.
 * - `not-counted` — seated without a tap, or over an FTW that did not pass
 *   (a supervisor's manual placement). Scores nothing; breaks the streak.
 * - `not-ready` — not seated, and the tap or the FTW failed them.
 * - `unreadable` — the FTW could not be read. A fault of ours, so it neither
 *   scores, costs, nor breaks the streak.
 */
export const POINT_OUTCOMES = [
  "operated",
  "stood-down",
  "not-counted",
  "not-ready",
  "unreadable",
] as const;
export type PointOutcome = (typeof POINT_OUTCOMES)[number];

/** Indonesian labels, as the explainer poster words them. */
export const POINT_OUTCOME_LABELS: Record<PointOutcome, string> = {
  operated: "Beroperasi",
  "stood-down": "Stand down",
  "not-counted": "Tidak dihitung",
  "not-ready": "Tidak siap",
  unreadable: "FTW tidak terbaca",
};

/** The streak bonus a run of `streak` counted shifts earns on its last one. */
export function streakBonus(streak: number): number {
  if (streak <= 1) return 0;
  return Math.min(POINTS.streakStep * (streak - 1), POINTS.streakMax);
}

/**
 * The longest period one leaderboard reads, in days, both ends counted. A
 * custom range is for a quarter or a year-to-date, not for every shift ever
 * settled; the screen and the API refuse the same spans.
 */
export const LEADERBOARD_MAX_DAYS = 366;
