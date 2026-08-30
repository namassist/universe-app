/**
 * The pass rule: may this person take a unit on this shift?
 *
 * Two snapshots answer it — savera's FTW verdict and the fingerprint tap — and
 * the rule over them is the owner's (2026-08-29), not an inference:
 *
 *   FTW passes  ⟺  decision is "FTW aman" AND sleep category is "Dapat Bekerja"
 *   Finger passes ⟺  the first IN tap is before this shift's `finger-in`
 *                    deadline, read from the master timeline
 *
 * Both are required for a unit whose `ftw` flag is set; the tap alone for every
 * other unit.
 *
 * **The two FTW verdicts are separate axes and they disagree.** In seven days
 * of live data, 234 readings say `FTW aman` beside a sleep category that
 * forbids work — 105 of them "Tidak Boleh Bekerja". Reading the decision alone
 * is the obvious implementation and it puts all 234 on a machine. That is the
 * whole reason this rule is a named, tested thing rather than a `where` clause
 * inlined at the one place that needs it today.
 *
 * `judge` is pure. Only the deadline lookup touches the database.
 */

import type { ShiftKind } from "@universe/contracts";

import { stageTimeOf } from "./stage-time";

/**
 * savera's verdict strings, as they are actually written.
 *
 * `ftw_readings` stores these as text on purpose: savera's rules are
 * operator-configurable, so an enum here would break on *their* next edit
 * rather than ours. That flexibility has a cost — a reworded verdict stops
 * matching — and `unreadable` below is how the cost is made visible instead of
 * silently emptying a board.
 */
const FTW_PASS_DECISION = "ftw aman";
const FTW_PASS_CATEGORY = "dapat bekerja";

/** Every value observed in the source. A value outside these is unreadable. */
const KNOWN_DECISIONS = new Set([
  FTW_PASS_DECISION,
  "belum mengisi ftw",
  "ftw perlu tindak lanjut",
]);
const KNOWN_CATEGORIES = new Set([
  FTW_PASS_CATEGORY,
  "tidak boleh bekerja",
  "istirahat minimal 1 jam",
  "istirahat minimal 2 jam",
]);

/** Compared loosely: casing and padding are savera's presentation, not data. */
const key = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase();

export type FtwVerdict =
  | "pass"
  | "fail"
  /** No reading for this person and date — a failure, not an exemption. */
  | "missing"
  /** A verdict we cannot interpret: savera reworded it, or it is null. */
  | "unreadable"
  /** The unit does not require FTW, so none was asked for. */
  | "not-required";

export type FingerVerdict =
  | "pass"
  /** Tapped in, but not before the deadline. */
  | "late"
  /** No IN tap at all — including the 991 rows in seven days that carry only
   *  an OUT, which say nothing about arrival rather than denying it. */
  | "missing";

export type Readiness = {
  passed: boolean;
  ftw: FtwVerdict;
  finger: FingerVerdict;
  /** "HH:MM:SS" of the IN tap — what FCFS orders spares by. */
  tappedAt: string | null;
};

export type JudgeInput = {
  ftw: { ftwDecision: string | null; sleepCategory: string | null } | null;
  finger: { firstInAt: string | null } | null;
  /** `units.ftw` — some units need the FTW verdict, others the tap alone. */
  requiresFtw: boolean;
  /** "HH:MM:SS", from `fingerInDeadline` for the shift being generated. */
  deadline: string;
};

/** "2026-08-29 05:27:58" → "05:27:58". The source stores naive local times. */
const timeOf = (stamp: string) => stamp.slice(11, 19);

function judgeFtw(input: JudgeInput): FtwVerdict {
  if (!input.requiresFtw) return "not-required";
  if (!input.ftw) return "missing";

  const decision = key(input.ftw.ftwDecision);
  const category = key(input.ftw.sleepCategory);
  if (!KNOWN_DECISIONS.has(decision) || !KNOWN_CATEGORIES.has(category))
    return "unreadable";

  return decision === FTW_PASS_DECISION && category === FTW_PASS_CATEGORY
    ? "pass"
    : "fail";
}

function judgeFinger(input: JudgeInput): FingerVerdict {
  const at = input.finger?.firstInAt;
  if (!at) return "missing";
  // Strictly before: the deadline is the moment the gate closes, not the last
  // moment through it. "HH:MM:SS" compares correctly as text.
  return timeOf(at) < input.deadline ? "pass" : "late";
}

export function judge(input: JudgeInput): Readiness {
  const ftw = judgeFtw(input);
  const finger = judgeFinger(input);
  return {
    ftw,
    finger,
    passed: finger === "pass" && (ftw === "pass" || ftw === "not-required"),
    tappedAt: input.finger?.firstInAt ? timeOf(input.finger.firstInAt) : null,
  };
}

/**
 * The `finger-in` deadline for a shift, as the operator has it configured.
 *
 * A named wrapper rather than a bare `stageTimeOf` call at each site: this is
 * *the* gate the pass rule is defined against, and spelling it out here is
 * what keeps a future caller from reaching for a neighbouring stage that
 * happens to sit at the same minute.
 */
export async function fingerInDeadline(
  shift: ShiftKind
): Promise<string | null> {
  return stageTimeOf("finger-in", shift);
}
