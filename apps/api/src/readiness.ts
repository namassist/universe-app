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
  /**
   * Uploaded after this shift's `ftw-deadline`, whatever the verdict says.
   *
   * A separate value from `fail` because the two ask different things of a
   * supervisor: `fail` means savera judged the person unfit, `late` means
   * nobody judged them in time. The first is a medical answer, the second is
   * an administrative one — and only the second is worth escalating, which is
   * why the board refuses it automatically and a person may still override.
   */
  | "late"
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
  /** "HH:MM:SS" the FTW was uploaded, so a screen can show how late. */
  sentAt: string | null;
};

/**
 * A day's tap record, before anyone has decided which IN is the arrival.
 *
 * Both halves are here because both can be non-null on one date, and the
 * roster is the only thing that says which one the shift meant.
 */
export type FingerRecord = {
  firstInAt: string | null;
  firstInIp?: string | null;
  firstInPmAt: string | null;
  firstInPmIp?: string | null;
};

/**
 * The IN tap that belongs to a shift — noon-split, roster-decided.
 *
 * Never `firstInAt ?? firstInPmAt`: for a night shift that fallback is exactly
 * the bug this split exists to close, silently accepting a 06:20 wrong-button
 * tap as an arrival for a shift that starts at 17:00. A null result is the
 * honest answer that they were not seen at the start of *this* shift.
 */
export function shiftIn(
  reading: FingerRecord | null,
  shift: ShiftKind
): { firstInAt: string | null; firstInIp: string | null } | null {
  if (!reading) return null;
  return shift === "night"
    ? { firstInAt: reading.firstInPmAt, firstInIp: reading.firstInPmIp ?? null }
    : { firstInAt: reading.firstInAt, firstInIp: reading.firstInIp ?? null };
}

export type JudgeInput = {
  ftw: {
    ftwDecision: string | null;
    sleepCategory: string | null;
    /** When savera received it. Null in rows ingested before this was read. */
    sentAt: string | null;
  } | null;
  finger: { firstInAt: string | null } | null;
  /** `units.ftw` — some units need the FTW verdict, others the tap alone. */
  requiresFtw: boolean;
  /** "HH:MM:SS", from `fingerInDeadline` for the shift being generated. */
  deadline: string;
  /** "HH:MM:SS", the shift's `ftw-deadline` — the moment upload closes. */
  ftwDeadline: string;
};

/** "2026-08-29 05:27:58" → "05:27:58". The source stores naive local times. */
const timeOf = (stamp: string) => stamp.slice(11, 19);

function judgeFtw(input: JudgeInput): FtwVerdict {
  if (!input.requiresFtw) return "not-required";
  if (!input.ftw) return "missing";

  /*
   * Lateness is judged before the verdict is even read (owner, 2026-08-30).
   *
   * The ingest window closes minutes after `ftw-deadline`, but the *night*
   * pull covers today as well as yesterday, so a morning upload that missed
   * its window still lands in the table by the afternoon. Without this, the
   * same board regenerated at 17:00 would place people it refused at 05:25 —
   * a board whose answer depends on when the button was pressed. Reading the
   * upload time makes the answer a fact about the morning instead.
   *
   * A row with no `sent_at` is judged on its verdict alone: savera has always
   * sent one, and inventing lateness from a null would fail people for a gap
   * in our own record rather than for anything they did.
   */
  if (input.ftw.sentAt && timeOf(input.ftw.sentAt) >= input.ftwDeadline)
    return "late";

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
    sentAt: input.ftw?.sentAt ? timeOf(input.ftw.sentAt) : null,
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

/**
 * The `ftw-deadline` for a shift — the moment uploading closes.
 *
 * Until now this stage was a no-op marker on the timeline; it is what decides
 * `late`, so moving it moves the rule and nothing here has to be told.
 * `null` is a refusal for the same reason as above: with no configured
 * deadline there is no such thing as late, and quietly treating every upload
 * as punctual would re-open the hole this closes.
 */
export async function ftwDeadline(shift: ShiftKind): Promise<string | null> {
  return stageTimeOf("ftw-deadline", shift);
}
