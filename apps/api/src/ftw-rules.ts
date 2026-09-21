/**
 * savera's sleep rules, applied by us (owner, 2026-09-21).
 *
 * savera decides a person's FTW category from the minutes they slept, by the
 * rules in its own `ftw_sleep_rules` table — and then takes its time writing
 * the answer down. A row its background sync created early is computed from a
 * trickle of wearable data, and the real category arrives on some later lap of
 * its five-minute job: on 2026-09-21 an operator with 8h30 of sleep read "Tidak
 * Boleh Bekerja" when the board was built at 05:26, and "Dapat Bekerja" from
 * 05:23:03 onwards — 82 seconds after our last pass. Five people lost a unit
 * that way that morning.
 *
 * So the category is worked out here, from the same rules and the same
 * minutes, at the moment the upload arrives. It is savera's answer without the
 * wait, not a second opinion: applied to `summaries.sleep`, these rules
 * reproduce savera's settled category on 10,395 of 10,395 rows over the two
 * weeks before this was written. The rules are read from savera on every pull,
 * so an edit there takes effect on our next pass; nothing is hardcoded.
 *
 * Pure, so the rules are tested against savera's own table rather than
 * against thresholds typed in by hand.
 */

/** One row of savera's `ftw_sleep_rules`, the columns the engine reads. */
export type SleepRule = {
  code: string;
  metricKey: string;
  minMinutes: number | null;
  minInclusive: boolean;
  maxMinutes: number | null;
  maxInclusive: boolean;
  /**
   * The category, in savera's own words — what its insight row would say.
   * Nullable because the column is: a rule without one is refused.
   */
  decisionLabel: string | null;
  /** Lower goes first, as in savera. */
  priority: number;
  shiftId: number | null;
  sleepType: string;
  /** "YYYY-MM-DD", or null for no bound. */
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

/** A rule set the engine has agreed to apply. */
export type RuleSet = { readonly rules: readonly SleepRule[] };

/** The metric the minute rules are written against. */
const MINUTES = "effective_sleep_minutes";

/**
 * The rules that judge minutes, or null when they cannot be honoured.
 *
 * Null is a refusal, and the caller falls back to savera's own category for the
 * pass — today's behaviour — rather than applying a half-understood table. It
 * refuses when there is nothing to apply; when any rule narrows itself to a
 * shift or a sleep type, since we have no way to match those and applying such
 * a rule to everybody would judge people by a rule written for someone else;
 * and when any rule names no category.
 *
 * Rules on other metrics — `NO_UPLOAD` is about presence — are set aside, not
 * refused: a row we hold is an upload by definition, so they never apply here.
 */
export function ruleSetOf(rows: readonly SleepRule[]): RuleSet | null {
  const minuteRules = rows.filter((r) => r.metricKey === MINUTES);
  if (!minuteRules.length) return null;
  if (minuteRules.some((r) => r.shiftId !== null || r.sleepType !== "all"))
    return null;
  /* A rule that matches and names nothing would answer "no category" for a
     person who has one, which every screen reads as "never uploaded". */
  if (minuteRules.some((r) => !r.decisionLabel?.trim())) return null;
  return {
    rules: [...minuteRules].sort((a, b) => a.priority - b.priority),
  };
}

function inForce(rule: SleepRule, date: string): boolean {
  if (rule.effectiveFrom && date < rule.effectiveFrom) return false;
  if (rule.effectiveTo && date > rule.effectiveTo) return false;
  return true;
}

function covers(rule: SleepRule, minutes: number): boolean {
  if (rule.minMinutes !== null) {
    const above = rule.minInclusive
      ? minutes >= rule.minMinutes
      : minutes > rule.minMinutes;
    if (!above) return false;
  }
  if (rule.maxMinutes !== null) {
    const below = rule.maxInclusive
      ? minutes <= rule.maxMinutes
      : minutes < rule.maxMinutes;
    if (!below) return false;
  }
  return true;
}

/**
 * The category these minutes earn on this date: the first rule in force, by
 * priority, whose range holds them.
 *
 * Null where no rule covers the minutes — a gap in savera's table is a gap,
 * and borrowing a neighbour's verdict would be inventing one. The caller
 * answers a null with savera's own word, never with an empty category: an
 * empty one reads as "never uploaded" on every screen.
 */
export function categoryOf(
  minutes: number,
  date: string,
  set: RuleSet
): string | null {
  const found = set.rules.find(
    (rule) => inForce(rule, date) && covers(rule, minutes)
  );
  return found?.decisionLabel ?? null;
}
