/**
 * What a scanned ID card says, beyond what the register stores verbatim.
 *
 * The two answers here are the ones the route works out rather than reads: the
 * place the muster sent this person today, and the qualifications line. Both
 * follow the rules the printed slip already follows, so a card held up at the
 * gate and the paper in the same hand cannot disagree.
 *
 * Pure, so the tests never have to arrange a board or a clock.
 */

import type { Seat } from "./ticket-rules";
import type { SpareRide } from "./spare-ride";

export type CardSeat = {
  /** A unit code, "SPARE", or null when allocation is not about this person. */
  unit: string | null;
  area: string | null;
  bus: string | null;
};

/**
 * Where the card sends somebody.
 *
 * A seat is its own unit, area and bus. Without one, an operator the board
 * could have used — active, in a position allocation is about — reads SPARE
 * with the pool's buses and where they wait, exactly as the slip prints it
 * (owner, 2026-09-15). Everybody else holds nothing: a mechanic was never in
 * the running for a unit, and calling him SPARE would say the muster had left
 * him over.
 */
export function cardSeat(input: {
  seat: Seat | null;
  spareEligible: boolean;
  ride: SpareRide | null;
}): CardSeat {
  if (input.seat)
    return {
      unit: input.seat.unit,
      area: input.seat.area,
      bus: input.seat.bus,
    };
  if (!input.spareEligible) return { unit: null, area: null, bus: null };
  return {
    unit: "SPARE",
    area: input.ride?.area ?? null,
    bus: input.ride?.buses.join(", ") || null,
  };
}

/**
 * The qualifications — the simper *codes* a person holds.
 *
 * Not the permit type (`F`/`P`): a card is read to see which machines this
 * person may be given, and that is what the codes say. A list rather than one
 * line, because the card shows them as chips and an operator holding ten of
 * them is the normal case; empty when the register holds none, which the
 * screen dashes like every other value it does not have.
 */
export function simperCodes(skills: { name: string }[]): string[] {
  return skills.map((s) => s.name);
}
