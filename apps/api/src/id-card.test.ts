/**
 * The ID card's own decisions, without a database.
 *
 * Where the card sends somebody, and what the simper line reads — the two
 * answers the route assembles rather than reads.
 *
 *   bun --env-file=.env test src/id-card.test.ts
 */

import { describe, expect, test } from "bun:test";

import { cardSeat, simperCodes } from "./id-card";

const seat = {
  unit: "RD5061",
  bus: "UD BU 04",
  fleet: "KU2",
  area: "PONDOK KASTURI",
};

describe("where the card sends somebody", () => {
  test("a seat reads as its unit, area and bus", () => {
    expect(cardSeat({ seat, spareEligible: true, ride: null })).toEqual({
      unit: "RD5061",
      area: "PONDOK KASTURI",
      bus: "UD BU 04",
    });
  });

  test("an operator the board could have used reads SPARE, with the pool's ride", () => {
    expect(
      cardSeat({
        seat: null,
        spareEligible: true,
        ride: { buses: ["BU 01", "BU 02"], area: "POOL" },
      })
    ).toEqual({ unit: "SPARE", area: "POOL", bus: "BU 01, BU 02" });
  });

  test("SPARE stands even when nobody has set where the pool waits", () => {
    expect(cardSeat({ seat: null, spareEligible: true, ride: null })).toEqual({
      unit: "SPARE",
      area: null,
      bus: null,
    });
  });

  /* A mechanic or a payroll officer holds no unit and is not a spare: the
     board never considers them, and calling them SPARE would say the muster
     had left them over. */
  test("somebody allocation is not about holds nothing", () => {
    expect(
      cardSeat({
        seat: null,
        spareEligible: false,
        ride: { buses: ["BU 01"], area: "POOL" },
      })
    ).toEqual({ unit: null, area: null, bus: null });
  });
});

describe("the simper codes", () => {
  test("every qualification the register holds, in its own words", () => {
    expect(simperCodes([{ name: "EXC 2600" }, { name: "OHT 777" }])).toEqual([
      "EXC 2600",
      "OHT 777",
    ]);
  });

  /* A list rather than one line: the card shows them as chips, and an
     operator holding ten of them is the normal case. */
  test("no qualification at all is an empty list, for the card to dash", () => {
    expect(simperCodes([])).toEqual([]);
  });
});
