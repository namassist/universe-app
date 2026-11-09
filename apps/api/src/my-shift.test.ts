/**
 * What the operator's own app says about the coming shift: a holder or a
 * spare, and why (docs/prd.md, Mobile app → Unit saya hari ini). Pure, so
 * every case is one line of facts; the facts themselves come from the same
 * rules the board and the slip apply.
 */

import { describe, expect, test } from "bun:test";

import {
  pickShift,
  standing,
  type PlanFacts,
  type StandingInput,
} from "./my-shift";

const seat = { unit: "DT101", area: "PIT A", bus: "BUS 1", fleet: "EX01" };

const plan = (over: Partial<NonNullable<PlanFacts>> = {}): PlanFacts => ({
  unit: "DT101",
  active: true,
  breakdown: false,
  inAllocation: true,
  refusal: null,
  partnerRostered: false,
  seat,
  ...over,
});

const before = (over: Partial<StandingInput> = {}): StandingInput => ({
  allocatable: true,
  rostered: true,
  plan: plan(),
  board: null,
  secondFingerOpen: false,
  ...over,
});

describe("before the board: the plan, provisional", () => {
  test("a holder of a unit the board is about", () => {
    expect(standing(before())).toEqual({
      phase: "plan",
      status: "holder",
      reason: null,
      refusal: null,
      planUnit: "DT101",
      seat,
    });
  });

  test("a holder whose unit is broken down is a spare, and is told so", () => {
    expect(standing(before({ plan: plan({ breakdown: true }) }))).toMatchObject(
      { status: "spare", reason: "breakdown", planUnit: "DT101", seat: null }
    );
  });

  test("a holder whose unit is in no formation and not support is a spare", () => {
    expect(
      standing(before({ plan: plan({ inAllocation: false }) }))
    ).toMatchObject({ status: "spare", reason: "not-in-fleet", seat: null });
  });

  test("an inactive unit reads as out of the fleet, before its breakdown flag", () => {
    expect(
      standing(before({ plan: plan({ active: false, breakdown: true }) }))
    ).toMatchObject({ status: "spare", reason: "not-in-fleet" });
  });

  test("a holder the unit refuses (SIMPER, department) is a spare, with the board's own sentence", () => {
    const refusal = 'Tidak punya SIMPER "A2B"';
    expect(standing(before({ plan: plan({ refusal }) }))).toMatchObject({
      status: "spare",
      reason: "ineligible",
      refusal,
      seat: null,
    });
  });

  test("a partner rostered to the same shift is a warning, not a verdict", () => {
    expect(
      standing(before({ plan: plan({ partnerRostered: true }) }))
    ).toMatchObject({ status: "holder", reason: "partner-rostered", seat });
  });

  test("no plan seat at all is a spare", () => {
    expect(standing(before({ plan: null }))).toMatchObject({
      status: "spare",
      reason: "no-plan-seat",
      planUnit: null,
      seat: null,
    });
  });
});

describe("whoever the shift is not about", () => {
  test("not rostered to it reads as off, whatever the plan says", () => {
    expect(standing(before({ rostered: false }))).toEqual({
      phase: "plan",
      status: "off",
      reason: null,
      refusal: null,
      planUnit: "DT101",
      seat: null,
    });
  });

  test("somebody allocation is not about holds nothing, not SPARE", () => {
    expect(standing(before({ allocatable: false }))).toMatchObject({
      status: "not-allocated",
      seat: null,
    });
  });
});

describe("after the board: what the slip would say", () => {
  const after = (over: Partial<StandingInput>) =>
    before({ board: { seat: null }, ...over });

  test("a holder the board kept shows the board's seat", () => {
    const boardSeat = { ...seat, area: "PIT B" };
    expect(
      standing(after({ board: { seat: { ...boardSeat, source: "plan" } } }))
    ).toMatchObject({ phase: "board", status: "holder", seat: boardSeat });
  });

  test("a spare's seat is held until the second finger, as the slip is", () => {
    const spareSeat = { ...seat, unit: "DT202" };
    expect(
      standing(after({ board: { seat: { ...spareSeat, source: "spare" } } }))
    ).toMatchObject({
      status: "spare",
      reason: "awaiting-second-finger",
      seat: null,
    });
    expect(
      standing(
        after({
          board: { seat: { ...spareSeat, source: "spare" } },
          secondFingerOpen: true,
        })
      )
    ).toMatchObject({ status: "spare", reason: null, seat: spareSeat });
  });

  test("a hand placement waits for the second finger too", () => {
    expect(
      standing(
        after({ board: { seat: { ...seat, unit: "DT303", source: "manual" } } })
      )
    ).toMatchObject({ reason: "awaiting-second-finger", seat: null });
  });

  test("placed by hand on their own unit, after the second finger, they hold it", () => {
    expect(
      standing(
        after({
          board: { seat: { ...seat, source: "manual" } },
          secondFingerOpen: true,
        })
      )
    ).toMatchObject({ status: "holder", seat });
  });

  test("not on the board: waiting before the second finger, then told", () => {
    expect(standing(after({}))).toMatchObject({
      status: "spare",
      reason: "awaiting-second-finger",
      seat: null,
    });
    expect(standing(after({ secondFingerOpen: true }))).toMatchObject({
      status: "spare",
      reason: "not-seated",
      seat: null,
    });
  });

  test("the plan no longer speaks once the board exists", () => {
    // A broken-down plan unit is the board's business now: the answer is
    // the board's, not the plan's reason.
    expect(
      standing(
        after({
          plan: plan({ breakdown: true }),
          board: { seat: { ...seat, unit: "DT202", source: "spare" } },
          secondFingerOpen: true,
        })
      )
    ).toMatchObject({ phase: "board", reason: null, seat: { unit: "DT202" } });
  });
});

describe("which shift the app is about", () => {
  test("the running shift, when rostered to it", () => {
    expect(
      pickShift({ date: "2026-10-17", shift: "day" }, (s) => s.shift === "day")
    ).toEqual({ date: "2026-10-17", shift: "day" });
  });

  test("the night after a day shift the person is not on", () => {
    expect(
      pickShift(
        { date: "2026-10-17", shift: "day" },
        (s) => s.shift === "night"
      )
    ).toEqual({ date: "2026-10-17", shift: "night" });
  });

  test("the next morning, read the evening before", () => {
    expect(
      pickShift(
        { date: "2026-10-17", shift: "night" },
        (s) => s.date === "2026-10-18" && s.shift === "day"
      )
    ).toEqual({ date: "2026-10-18", shift: "day" });
  });

  test("rostered to neither: the running shift, which will read as off", () => {
    expect(
      pickShift({ date: "2026-10-31", shift: "night" }, () => false)
    ).toEqual({ date: "2026-10-31", shift: "night" });
  });

  test("the next day crosses a month end", () => {
    expect(
      pickShift(
        { date: "2026-10-31", shift: "night" },
        (s) => s.date === "2026-11-01"
      )
    ).toEqual({ date: "2026-11-01", shift: "day" });
  });
});

describe("a seat on the board outranks the roster", () => {
  test("placed by hand on a shift they are not rostered to, they see the seat", async () => {
    // A late arrival or a call-in reaches a unit only by hand (domain map,
    // Tickets); the app must not say "off" while the board says otherwise.
    expect(
      standing(
        before({
          rostered: false,
          board: { seat: { ...seat, unit: "DT404", source: "manual" } },
          secondFingerOpen: true,
        })
      )
    ).toMatchObject({ status: "spare", seat: { unit: "DT404" } });
  });

  test("not rostered and not on the board is still off", () => {
    expect(
      standing(before({ rostered: false, board: { seat: null } }))
    ).toMatchObject({ status: "off", seat: null });
  });
});
