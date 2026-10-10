import { describe, expect, test } from "bun:test";

import { shiftClash } from "./data";

/*
 * Two holders of one unit on the same shift today (owner, 2026-10-11). The
 * pair is checked against the roster only on the day it is made; a roster
 * that changes later can put both on one shift, and then whoever taps second
 * becomes a spare. The PLAN tab says so before the muster does.
 */
describe("two holders of one unit on the same shift", () => {
  const day = { rosterCode: "D" as const };
  const night = { rosterCode: "N" as const };
  const off = { rosterCode: "CR" as const };

  test("both on the day shift is a clash on the day shift", () => {
    expect(shiftClash([day, day], "day")).toBe("day");
    expect(shiftClash([day, day], "all")).toBe("day");
  });

  test("the pair as intended — one day, one night — is no clash", () => {
    expect(shiftClash([day, night], "day")).toBeNull();
    expect(shiftClash([day, night], "night")).toBeNull();
    expect(shiftClash([day, night], "all")).toBeNull();
  });

  test("a clash on the other shift is not shown while one shift is chosen", () => {
    expect(shiftClash([night, night], "day")).toBeNull();
    expect(shiftClash([night, night], "night")).toBe("night");
    expect(shiftClash([night, night], "all")).toBe("night");
  });

  test("somebody off today, or with no roster yet, clashes with nobody", () => {
    expect(shiftClash([day, off], "day")).toBeNull();
    expect(shiftClash([day, { rosterCode: null }], "all")).toBeNull();
    expect(shiftClash([day], "day")).toBeNull();
    expect(shiftClash([], "all")).toBeNull();
  });

  /* The engine never seats a standby holder, so he takes nobody's turn. */
  test("a standby holder does not count", () => {
    expect(shiftClash([day, { ...day, standby: true }], "day")).toBeNull();
  });
});
