/**
 * When a tap the machine marked OUT is an arrival after all.
 *
 * The defect (2026-11-14): a holder tapped at 04:35 with the machine left on
 * *Pulang*. The live session, which hears no direction, printed his unit; the
 * pull then stored the tap as OUT, the reading went OUT-only (`missing`), and
 * the board gave his unit to a spare. A tap inside the muster window by
 * somebody rostered to that muster is an arrival, whatever the button said.
 *
 * Pure — no database.
 *   bun test src/arrival-window.test.ts
 */

import { describe, expect, test } from "bun:test";

import { outIsArrival, windowOf, type ArrivalWindows } from "./arrival-window";

/* The seeded schedule, with the default grace of thirty minutes. */
const windows: ArrivalWindows = {
  day: { from: "04:00:00", until: "06:00:00" },
  night: { from: "16:00:00", until: "18:00:00" },
};

describe("the window", () => {
  test("runs from shift-start to the bus plus the grace", () => {
    expect(windowOf("04:00:00", "05:30:00", 30)).toEqual({
      from: "04:00:00",
      until: "06:00:00",
    });
  });

  test("reads the timeline's short form too", () => {
    expect(windowOf("16:00", "17:30", 30)).toEqual({
      from: "16:00:00",
      until: "18:00:00",
    });
  });

  test("a missing stage is no window, never a default", () => {
    expect(windowOf(null, "05:30:00", 30)).toBeNull();
    expect(windowOf("04:00:00", null, 30)).toBeNull();
  });

  test("a window that would run past midnight stops at the end of the day", () => {
    expect(windowOf("22:00:00", "23:50:00", 30)).toEqual({
      from: "22:00:00",
      until: "24:00:00",
    });
  });

  test("a bus before the start is no window", () => {
    expect(windowOf("05:30:00", "04:00:00", 0)).toBeNull();
  });
});

describe("an OUT tap", () => {
  test("inside the day window, by somebody rostered D, is an arrival", () => {
    expect(outIsArrival("2026-11-14 04:35:00", "day", windows)).toBe(true);
  });

  test("inside the night window, by somebody rostered N, is an arrival", () => {
    expect(outIsArrival("2026-11-14 16:40:00", "night", windows)).toBe(true);
  });

  /* The day shift goes home inside the night window. */
  test("by somebody rostered to the other shift stays an OUT", () => {
    expect(outIsArrival("2026-11-14 17:55:00", "day", windows)).toBe(false);
    expect(outIsArrival("2026-11-14 05:45:00", "night", windows)).toBe(false);
  });

  test("by somebody not rostered at all stays an OUT", () => {
    expect(outIsArrival("2026-11-14 04:35:00", null, windows)).toBe(false);
  });

  test("outside the window stays an OUT", () => {
    expect(outIsArrival("2026-11-14 06:20:00", "day", windows)).toBe(false);
    expect(outIsArrival("2026-11-14 03:59:59", "day", windows)).toBe(false);
  });

  test("the window's end belongs to the time after it", () => {
    expect(outIsArrival("2026-11-14 05:59:59", "day", windows)).toBe(true);
    expect(outIsArrival("2026-11-14 06:00:00", "day", windows)).toBe(false);
  });

  test("with no window for the shift stays an OUT", () => {
    expect(outIsArrival("2026-11-14 04:35:00", "day", {})).toBe(false);
  });

  /* An arrival has to land in its own shift's column, or `shiftIn` would
     read it for the other shift. A window retimed across noon cannot do that. */
  test("never becomes an arrival on the wrong side of noon", () => {
    const wide: ArrivalWindows = {
      day: { from: "04:00:00", until: "13:00:00" },
    };
    expect(outIsArrival("2026-11-14 12:30:00", "day", wide)).toBe(false);
  });
});
