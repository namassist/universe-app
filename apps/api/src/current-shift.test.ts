import { describe, expect, test } from "bun:test";

import { currentShift, deskShift } from "./current-shift";

/** Local time, since the boundary is a fact about the site's clock. */
const at = (date: string, time: string) => new Date(`${date}T${time}`);

const GATES = { day: "05:15:00", night: "17:15:00" };

describe("currentShift", () => {
  test("is the day shift once the morning gate has closed", () => {
    expect(currentShift(at("2026-08-29", "05:15:00"), GATES)).toEqual({
      date: "2026-08-29",
      shift: "day",
    });
  });

  test("stays on the day shift through the working morning", () => {
    expect(currentShift(at("2026-08-29", "11:30:00"), GATES)).toEqual({
      date: "2026-08-29",
      shift: "day",
    });
  });

  test("turns over to the night shift at its own gate", () => {
    expect(currentShift(at("2026-08-29", "17:15:00"), GATES)).toEqual({
      date: "2026-08-29",
      shift: "night",
    });
  });

  test("a minute before the night gate is still the day shift", () => {
    expect(currentShift(at("2026-08-29", "17:14:00"), GATES)).toEqual({
      date: "2026-08-29",
      shift: "day",
    });
  });

  test("after midnight it is still yesterday's night shift", () => {
    expect(currentShift(at("2026-08-30", "01:00:00"), GATES)).toEqual({
      date: "2026-08-29",
      shift: "night",
    });
  });

  test("the small hours of the first of a month reach back into the last", () => {
    expect(currentShift(at("2026-09-01", "02:40:00"), GATES)).toEqual({
      date: "2026-08-31",
      shift: "night",
    });
  });

  test("follows the timeline rather than a hardcoded hour", () => {
    const moved = { day: "06:00:00", night: "18:00:00" };
    expect(currentShift(at("2026-08-29", "05:30:00"), moved)).toEqual({
      date: "2026-08-28",
      shift: "night",
    });
    expect(currentShift(at("2026-08-29", "06:00:00"), moved)).toEqual({
      date: "2026-08-29",
      shift: "day",
    });
  });

  test("refuses when a deadline is missing", () => {
    expect(
      currentShift(at("2026-08-29", "09:00:00"), {
        day: null,
        night: "17:15:00",
      })
    ).toBeNull();
    expect(
      currentShift(at("2026-08-29", "09:00:00"), {
        day: "05:15:00",
        night: null,
      })
    ).toBeNull();
  });

  test("refuses when the night gate does not follow the day gate", () => {
    expect(
      currentShift(at("2026-08-29", "09:00:00"), {
        day: "17:15:00",
        night: "05:15:00",
      })
    ).toBeNull();
  });
});

describe("deskShift", () => {
  test("is the day shift right through the morning", () => {
    for (const time of ["00:00:00", "06:20:00", "11:59:59"])
      expect(deskShift(at("2026-09-18", time))).toEqual({
        date: "2026-09-18",
        shift: "day",
      });
  });

  test("turns over at noon exactly, and stays over", () => {
    for (const time of ["12:00:00", "17:05:00", "23:59:59"])
      expect(deskShift(at("2026-09-18", time))).toEqual({
        date: "2026-09-18",
        shift: "night",
      });
  });

  test("the date is always today, never yesterday", () => {
    /* Where it parts company with `currentShift`, and on purpose. At 01:00 a
       wall in the yard is still showing the night board that started
       yesterday; an admin at a desk asking for "the dashboard" means today's
       figures, and reporting them under yesterday's date would be a quiet
       lie about which numbers they are reading. */
    expect(deskShift(at("2026-09-18", "01:00:00"))).toEqual({
      date: "2026-09-18",
      shift: "day",
    });
    expect(currentShift(at("2026-09-18", "01:00:00"), GATES)).toEqual({
      date: "2026-09-17",
      shift: "night",
    });
  });

  test("needs no timeline, so it cannot be half-configured", () => {
    // `currentShift` refuses on a missing gate; this one has nothing to miss,
    // and the dashboard is never left without a shift to count.
    expect(deskShift(at("2026-09-18", "09:00:00")).shift).toBe("day");
  });
});
