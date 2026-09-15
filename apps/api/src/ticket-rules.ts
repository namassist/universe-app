/**
 * Who gets a ticket, and what is printed on it.
 *
 * A pure decision, deliberately: the rules were settled one at a time with the
 * owner over 2026-09-12 and 13, every one of them is a sentence about a person
 * standing at a booth, and none should need a database or a printer to be
 * judged. The table in `docs/prd.md` under _Who gets a ticket_ is covered by
 * `ticket-rules.test.ts`, one test per row.
 *
 * Two rules carry the rest:
 *
 * 1. **Everyone who taps gets a ticket**, because attendance is what it
 *    proves. The one exception is a spare at
 *    the first finger, who is recorded and printed for at the second finger,
 *    once the allocation exists.
 * 2. **Allocation fields are filled only for somebody entitled to the seat.**
 *    Unit, bus, fleet and area appear together or not at all: half an
 *    allocation on paper sends a person to a unit that is not theirs.
 */

import type { Readiness } from "./readiness";

/** What the plan or the board gives a person for this shift. */
export type Seat = {
  unit: string;
  /** Null where the unit has no transport, fleet or area set — not an error. */
  bus: string | null;
  fleet: string | null;
  area: string | null;
};

/** Standing operators hold a unit in the plan; spares hold none. */
export type TicketRole = "standing" | "spare";

export type TicketInput = {
  role: TicketRole;
  /** Judged against the unit they would take, exactly as the board judges it. */
  readiness: Readiness;
  /** The seat the plan gives at the first finger, or the board gives later. */
  seat: Seat | null;
  /** Wall clock of the tap asking for this ticket, `"HH:MM:SS"`. */
  tappedAt: string;
  /**
   * The first tap of this shift for this person.
   *
   * What the ticket prints, always — a spare taps twice by design and the
   * arrival is the first one. Printing the second would date an arrival an
   * hour after it happened.
   */
  firstTapAt: string;
  /** When the second finger opens, `"HH:MM:SS"`, from the timeline. */
  secondFingerAt: string;
  /**
   * Whether the board could seat this person at all: `aktif`, in a position
   * that is allocated. Somebody it never considers — a mechanic, a standby
   * employee — waits for nothing, so nothing holds his slip (2026-09-15).
   */
  awaitsAllocation: boolean;
};

export type TicketDecision =
  | {
      print: false;
      /** A spare before the allocation exists: recorded, printed later. */
      reason: "spare-waits-for-allocation";
    }
  | {
      print: true;
      /** Null when they hold no seat, or one they are not entitled to. */
      seat: Seat | null;
      /** The arrival the ticket states — the first tap of the shift. */
      at: string;
      reason: "full" | "attendance-only";
    };

/**
 * Decide one ticket.
 *
 * Times compare as text because `"HH:MM:SS"` sorts correctly and every clock
 * here is the same day's wall clock — the same comparison `readiness.ts` makes
 * against the deadlines.
 */
export function ticketFor(input: TicketInput): TicketDecision {
  /*
   * A spare holds no unit until `spare-validate` has run, so a ticket at the
   * first finger could only say "no unit". The owner's rule is one ticket for
   * a spare, at the second finger, carrying the first tap's time. Until then
   * the tap is recorded and nothing prints.
   */
  /*
   * Unless his first finger was already late (owner, 2026-09-15). There is no
   * late tolerance, so the board will not seat him whatever he waits for, and
   * holding the slip only made him tap twice for the same "SPARE".
   */
  if (
    input.role === "spare" &&
    input.awaitsAllocation &&
    input.readiness.finger !== "late" &&
    input.tappedAt < input.secondFingerAt
  )
    return { print: false, reason: "spare-waits-for-allocation" };

  /*
   * `passed` is the board's own test — tapped in time, and FTW either passed
   * or was never asked for. Reusing it is deliberate: a second definition of
   * "entitled" would be a second answer to the same question, and the paper
   * would disagree with the board.
   */
  const seat = input.readiness.passed ? input.seat : null;

  return {
    print: true,
    seat,
    at: input.firstTapAt,
    reason: seat ? "full" : "attendance-only",
  };
}
